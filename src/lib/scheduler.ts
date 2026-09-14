/**
 * Pure scheduling engine. No DOM, no storage.
 *
 * Facts in: attendees (arrived / left / resting), venue court count, the
 * rounds that already exist (some frozen), a seed. Facts out: a full list of
 * rounds where every frozen round is untouched and every pending, unlocked
 * round is recomputed with the history of the frozen ones carried forward.
 */
import type { Attendee, CourtFixture, Round } from './types'
import { mulberry32, shuffle, type Rng } from './rng'

export const PARTNER_REPEAT_PENALTY = 10
export const OPPONENT_REPEAT_PENALTY = 3
/** Applied per existing pair split up when a round is re-solved after a removal. */
export const PAIR_BREAK_PENALTY = 4
/** Court slot left empty by a removal when nobody is available to fill it. */
export const OPEN_SLOT = ''
const ARRANGEMENT_STARTS = 12
const SCHEDULE_RESTARTS = 6

export interface ScheduleInput {
  venueCourts: number
  roundCount: number
  attendees: Attendee[]
  /** Existing rounds; those with status !== 'pending' or locked are frozen. */
  rounds: Round[]
  seed: number
  /** Extra round indexes to keep as-is for this rebuild (a just-substituted current round). */
  freeze?: number[]
}

/** Mutable tallies carried across rounds. */
export interface History {
  games: Map<string, number>
  /** Round index the player last sat out (while active). Absent = never sat out. */
  lastSat: Map<string, number>
  partners: Map<string, number>
  opponents: Map<string, number>
}

export function emptyHistory(): History {
  return { games: new Map(), lastSat: new Map(), partners: new Map(), opponents: new Map() }
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function slotPlayers(c: CourtFixture): string[] {
  return [...c.teamA, ...c.teamB].filter((p) => p !== OPEN_SLOT)
}

function addPairFacts(history: History, c: CourtFixture): void {
  if (c.teamA[0] !== OPEN_SLOT && c.teamA[1] !== OPEN_SLOT) bump(history.partners, pairKey(c.teamA[0], c.teamA[1]))
  if (c.teamB[0] !== OPEN_SLOT && c.teamB[1] !== OPEN_SLOT) bump(history.partners, pairKey(c.teamB[0], c.teamB[1]))
  for (const a of c.teamA)
    for (const b of c.teamB) if (a !== OPEN_SLOT && b !== OPEN_SLOT) bump(history.opponents, pairKey(a, b))
}

export function courtsUsed(venueCourts: number, activePlayers: number): number {
  return Math.max(0, Math.min(venueCourts, Math.floor(activePlayers / 4)))
}

export function isFrozen(round: Round): boolean {
  return round.status !== 'pending' || round.locked
}

/** Players who are present and available for a given round index. */
export function activePlayersForRound(attendees: Attendee[], roundIndex: number): string[] {
  return attendees
    .filter((a) => a.arrived)
    .filter((a) => a.leftAfterRound === undefined || roundIndex <= a.leftAfterRound)
    .filter((a) => a.restingRound !== roundIndex)
    .map((a) => a.playerId)
}

/** Everyone present for the round, including anyone resting by request. */
export function presentPlayersForRound(attendees: Attendee[], roundIndex: number): string[] {
  return attendees
    .filter((a) => a.arrived)
    .filter((a) => a.leftAfterRound === undefined || roundIndex <= a.leftAfterRound)
    .map((a) => a.playerId)
}

export function playersOnCourt(round: Round): string[] {
  return round.courts.flatMap(slotPlayers)
}

/** Add one round's facts to the history tallies. Open slots carry no facts. */
export function applyRound(history: History, round: Round): void {
  for (const c of round.courts) {
    for (const p of slotPlayers(c)) bump(history.games, p)
    addPairFacts(history, c)
  }
  for (const p of round.sitting) history.lastSat.set(p, round.index)
}

/** Tallies from every round before `index` (they are all frozen by then). */
export function historyBefore(rounds: Round[], index: number): History {
  const h = emptyHistory()
  for (const r of rounds) if (r.index < index) applyRound(h, r)
  return h
}

/**
 * Choose who plays. Sit-out priority (who sits first): most games played,
 * then the player who has gone longest without sitting out (never sat out
 * counts as longest), then random. Equivalently the players who play are
 * those with fewest games, then those who sat out most recently.
 */
export function selectPlayers(
  active: string[],
  playingCount: number,
  history: History,
  rng: Rng,
): { playing: string[]; sitting: string[] } {
  const tiebreak = new Map<string, number>()
  for (const p of active) tiebreak.set(p, rng())
  const ranked = active.slice().sort((a, b) => {
    const ga = history.games.get(a) ?? 0
    const gb = history.games.get(b) ?? 0
    if (ga !== gb) return ga - gb
    // Higher lastSat = sat out more recently = plays first.
    const sa = history.lastSat.get(a) ?? -1
    const sb = history.lastSat.get(b) ?? -1
    if (sa !== sb) return sb - sa
    return (tiebreak.get(a) ?? 0) - (tiebreak.get(b) ?? 0)
  })
  return { playing: ranked.slice(0, playingCount), sitting: ranked.slice(playingCount).sort() }
}

/**
 * Penalty for an arrangement. `keepPairs` (pair keys of teams that already
 * exist in the round being re-solved) adds PAIR_BREAK_PENALTY for each such
 * pair whose two players are both playing but no longer partnered.
 */
export function scoreCourts(courts: CourtFixture[], history: History, keepPairs?: Set<string>): number {
  let score = 0
  const teams = keepPairs ? new Set<string>() : undefined
  for (const c of courts) {
    const ka = pairKey(c.teamA[0], c.teamA[1])
    const kb = pairKey(c.teamB[0], c.teamB[1])
    score += PARTNER_REPEAT_PENALTY * (history.partners.get(ka) ?? 0)
    score += PARTNER_REPEAT_PENALTY * (history.partners.get(kb) ?? 0)
    for (const a of c.teamA)
      for (const b of c.teamB) score += OPPONENT_REPEAT_PENALTY * (history.opponents.get(pairKey(a, b)) ?? 0)
    teams?.add(ka).add(kb)
  }
  if (keepPairs && teams) {
    const playing = new Set(courts.flatMap((c) => [...c.teamA, ...c.teamB]))
    for (const k of keepPairs) {
      const [a, b] = k.split('|')
      if (playing.has(a) && playing.has(b) && !teams.has(k)) score += PAIR_BREAK_PENALTY
    }
  }
  return score
}

function toCourts(order: string[]): CourtFixture[] {
  const courts: CourtFixture[] = []
  for (let i = 0; i + 3 < order.length; i += 4) {
    courts.push({
      court: courts.length + 1,
      teamA: [order[i], order[i + 1]],
      teamB: [order[i + 2], order[i + 3]],
    })
  }
  return courts
}

/**
 * Search for a low-penalty arrangement of the playing set into courts and
 * pairs: several random starts, each hill-climbed by swapping two positions
 * whenever that lowers the penalty. Keeps the best found. Deterministic for a
 * given RNG.
 */
export function bestArrangement(
  playing: string[],
  history: History,
  rng: Rng,
  starts = ARRANGEMENT_STARTS,
  keepPairs?: Set<string>,
): { courts: CourtFixture[]; score: number } {
  let best = toCourts(playing)
  let bestScore = scoreCourts(best, history, keepPairs)
  const n = playing.length
  for (let s = 0; s < starts && bestScore > 0; s++) {
    const order = shuffle(playing, rng)
    let score = scoreCourts(toCourts(order), history, keepPairs)
    let improved = true
    while (improved && score > 0) {
      improved = false
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          ;[order[i], order[j]] = [order[j], order[i]]
          const candidate = scoreCourts(toCourts(order), history, keepPairs)
          if (candidate < score) {
            score = candidate
            improved = true
          } else {
            ;[order[i], order[j]] = [order[j], order[i]]
          }
        }
      }
    }
    if (score < bestScore) {
      bestScore = score
      best = toCourts(order)
    }
  }
  return { courts: best, score: bestScore }
}

/** Build one round from scratch for the given active players. */
export function buildRound(
  index: number,
  active: string[],
  venueCourts: number,
  history: History,
  rng: Rng,
): { round: Round; score: number } {
  const courts = courtsUsed(venueCourts, active.length)
  const { playing, sitting } = selectPlayers(active, courts * 4, history, rng)
  const { courts: fixtures, score } = bestArrangement(playing, history, rng)
  return {
    round: { index, status: 'pending', locked: false, courts: fixtures, sitting, substituted: [] },
    score,
  }
}

function emptyRound(index: number): Round {
  return { index, status: 'pending', locked: false, courts: [], sitting: [], substituted: [] }
}

/**
 * Recompute every pending, unlocked round. Frozen rounds are returned as the
 * same object references so callers can check they were untouched.
 */
export function rebuildSchedule(input: ScheduleInput): Round[] {
  const existing = new Map<number, Round>()
  for (const r of input.rounds) existing.set(r.index, r)
  const extraFrozen = new Set(input.freeze ?? [])
  const keep = (r: Round): boolean => isFrozen(r) || extraFrozen.has(r.index)

  const frozen: Round[] = []
  for (let i = 0; i < input.roundCount; i++) {
    const r = existing.get(i)
    if (r && keep(r)) frozen.push(r)
  }

  let bestRounds: Round[] | null = null
  let bestTotal = Infinity

  for (let restart = 0; restart < SCHEDULE_RESTARTS && bestTotal > 0; restart++) {
    const rng = mulberry32(input.seed + restart * 7919)
    const history = emptyHistory()
    // Partner/opponent facts are order-independent: seed them from every frozen
    // round so a locked later round steers earlier recomputed rounds too.
    for (const r of frozen) for (const c of r.courts) addPairFacts(history, c)
    const rounds: Round[] = []
    let total = 0
    for (let i = 0; i < input.roundCount; i++) {
      const r = existing.get(i)
      if (r && keep(r)) {
        rounds.push(r)
        // Games / sit-outs are ordered facts: count them as we pass the round.
        for (const c of r.courts) for (const p of slotPlayers(c)) bump(history.games, p)
        for (const p of r.sitting) history.lastSat.set(p, r.index)
        continue
      }
      const active = activePlayersForRound(input.attendees, i)
      if (courtsUsed(input.venueCourts, active.length) === 0) {
        rounds.push({ ...emptyRound(i), sitting: active.slice().sort() })
        continue
      }
      const built = buildRound(i, active, input.venueCourts, history, rng)
      total += built.score
      rounds.push(built.round)
      applyRound(history, built.round)
    }
    if (total < bestTotal) {
      bestTotal = total
      bestRounds = rounds
    }
  }
  return bestRounds ?? []
}

type Slot = { court: number; side: 'A' | 'B' }

function slotMap(round: Round): Map<string, Slot> {
  const m = new Map<string, Slot>()
  for (const c of round.courts) {
    for (const p of c.teamA) if (p !== OPEN_SLOT) m.set(p, { court: c.court, side: 'A' })
    for (const p of c.teamB) if (p !== OPEN_SLOT) m.set(p, { court: c.court, side: 'B' })
  }
  return m
}

function sameTeam(a: Slot | undefined, b: Slot): boolean {
  return a !== undefined && a.court === b.court && a.side === b.side
}

/**
 * Re-solve a round after one or more of its players stopped being active
 * (left, un-arrived, resting), with minimal disruption. Returns the same
 * object when nothing in the round needs to change.
 *
 * - Court count unchanged: every other assignment is kept and each vacated
 *   slot is filled by the best available non-court player (fewest games,
 *   then sat out most recently, then seeded random — the same ranking that
 *   picks who plays each round). With nobody available the slot stays open.
 * - Court count changed: the round is rebuilt for the remaining players,
 *   preferring arrangements that keep existing pairs together.
 *
 * `substituted` lists everyone on court afterwards who was not on that same
 * court and team before, unioned with any earlier marks still on court.
 */
export function substituteInRound(
  round: Round,
  active: string[],
  venueCourts: number,
  history: History,
  rng: Rng,
): Round {
  const activeSet = new Set(active)
  const before = slotMap(round)
  const removed = [...before.keys(), ...round.sitting].filter((p) => !activeSet.has(p))
  if (removed.length === 0) return round

  const removedSet = new Set(removed)
  const onCourtNow = [...before.keys()].filter((p) => !removedSet.has(p))
  const pool = active.filter((p) => !before.has(p)) // sitting, or arrived mid-round
  const courts = courtsUsed(venueCourts, active.length)

  let fixtures: CourtFixture[]
  let sitting: string[]
  if (courts === round.courts.length) {
    const ranked = selectPlayers(pool, pool.length, history, rng).playing
    let next = 0
    fixtures = round.courts.map((c) => {
      // courtsUsed only holds the court count when active >= 4 * courts, so the
      // pool always covers the vacated slots; OPEN_SLOT is a guard, not a path.
      const fill = (p: string): string => (removedSet.has(p) ? (ranked[next++] ?? OPEN_SLOT) : p)
      return { court: c.court, teamA: [fill(c.teamA[0]), fill(c.teamA[1])], teamB: [fill(c.teamB[0]), fill(c.teamB[1])] }
    })
    sitting = ranked.slice(next).sort()
  } else {
    const keepPairs = new Set<string>()
    for (const c of round.courts)
      for (const t of [c.teamA, c.teamB]) if (!t.some((p) => removedSet.has(p) || p === OPEN_SLOT)) keepPairs.add(pairKey(t[0], t[1]))
    const remaining = [...onCourtNow, ...pool]
    const picked = selectPlayers(remaining, courts * 4, history, rng)
    fixtures = bestArrangement(picked.playing, history, rng, ARRANGEMENT_STARTS, keepPairs).courts
    sitting = picked.sitting
    // Team sides carry no meaning: orient each court so the most players keep their side.
    fixtures = fixtures.map((c) => {
      const stay = (side: 'A' | 'B', team: [string, string]) => team.filter((p) => sameTeam(before.get(p), { court: c.court, side })).length
      const asIs = stay('A', c.teamA) + stay('B', c.teamB)
      const flipped = stay('B', c.teamA) + stay('A', c.teamB)
      return flipped > asIs ? { court: c.court, teamA: c.teamB, teamB: c.teamA } : c
    })
  }

  const result: Round = { ...round, courts: fixtures, sitting, substituted: [] }
  const after = slotMap(result)
  const marks = new Set(round.substituted.filter((p) => after.has(p)))
  for (const [p, slot] of after) if (!sameTeam(before.get(p), slot)) marks.add(p)
  result.substituted = [...marks].sort()
  return result
}

/** Games played per player across the given rounds. */
export function gamesPlayed(rounds: Round[]): Map<string, number> {
  const h = emptyHistory()
  for (const r of rounds) applyRound(h, r)
  return h.games
}

/** Swap two players within a round; either may be on a court or sitting. */
export function swapPlayers(round: Round, a: string, b: string): Round {
  if (a === b) return round
  const sub = (id: string): string => (id === a ? b : id === b ? a : id)
  return {
    ...round,
    courts: round.courts.map((c) => ({
      court: c.court,
      teamA: [sub(c.teamA[0]), sub(c.teamA[1])],
      teamB: [sub(c.teamB[0]), sub(c.teamB[1])],
    })),
    sitting: round.sitting.map(sub).sort(),
  }
}
