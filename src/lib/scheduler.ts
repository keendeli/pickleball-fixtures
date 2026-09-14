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
const ARRANGEMENT_STARTS = 12
const SCHEDULE_RESTARTS = 6

export interface ScheduleInput {
  venueCourts: number
  roundCount: number
  attendees: Attendee[]
  /** Existing rounds; those with status !== 'pending' or locked are frozen. */
  rounds: Round[]
  seed: number
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
  return round.courts.flatMap((c) => [...c.teamA, ...c.teamB])
}

/** Add one round's facts to the history tallies. */
export function applyRound(history: History, round: Round): void {
  for (const c of round.courts) {
    for (const p of [...c.teamA, ...c.teamB]) bump(history.games, p)
    bump(history.partners, pairKey(c.teamA[0], c.teamA[1]))
    bump(history.partners, pairKey(c.teamB[0], c.teamB[1]))
    for (const a of c.teamA) for (const b of c.teamB) bump(history.opponents, pairKey(a, b))
  }
  for (const p of round.sitting) history.lastSat.set(p, round.index)
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

export function scoreCourts(courts: CourtFixture[], history: History): number {
  let score = 0
  for (const c of courts) {
    score += PARTNER_REPEAT_PENALTY * (history.partners.get(pairKey(c.teamA[0], c.teamA[1])) ?? 0)
    score += PARTNER_REPEAT_PENALTY * (history.partners.get(pairKey(c.teamB[0], c.teamB[1])) ?? 0)
    for (const a of c.teamA)
      for (const b of c.teamB) score += OPPONENT_REPEAT_PENALTY * (history.opponents.get(pairKey(a, b)) ?? 0)
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
): { courts: CourtFixture[]; score: number } {
  let best = toCourts(playing)
  let bestScore = scoreCourts(best, history)
  const n = playing.length
  for (let s = 0; s < starts && bestScore > 0; s++) {
    const order = shuffle(playing, rng)
    let score = scoreCourts(toCourts(order), history)
    let improved = true
    while (improved && score > 0) {
      improved = false
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          ;[order[i], order[j]] = [order[j], order[i]]
          const candidate = scoreCourts(toCourts(order), history)
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
    round: { index, status: 'pending', locked: false, courts: fixtures, sitting },
    score,
  }
}

function emptyRound(index: number): Round {
  return { index, status: 'pending', locked: false, courts: [], sitting: [] }
}

/**
 * Recompute every pending, unlocked round. Frozen rounds are returned as the
 * same object references so callers can check they were untouched.
 */
export function rebuildSchedule(input: ScheduleInput): Round[] {
  const existing = new Map<number, Round>()
  for (const r of input.rounds) existing.set(r.index, r)

  const frozen: Round[] = []
  for (let i = 0; i < input.roundCount; i++) {
    const r = existing.get(i)
    if (r && isFrozen(r)) frozen.push(r)
  }

  let bestRounds: Round[] | null = null
  let bestTotal = Infinity

  for (let restart = 0; restart < SCHEDULE_RESTARTS && bestTotal > 0; restart++) {
    const rng = mulberry32(input.seed + restart * 7919)
    const history = emptyHistory()
    // Partner/opponent facts are order-independent: seed them from every frozen
    // round so a locked later round steers earlier recomputed rounds too.
    for (const r of frozen) {
      for (const c of r.courts) {
        bump(history.partners, pairKey(c.teamA[0], c.teamA[1]))
        bump(history.partners, pairKey(c.teamB[0], c.teamB[1]))
        for (const a of c.teamA) for (const b of c.teamB) bump(history.opponents, pairKey(a, b))
      }
    }
    const rounds: Round[] = []
    let total = 0
    for (let i = 0; i < input.roundCount; i++) {
      const r = existing.get(i)
      if (r && isFrozen(r)) {
        rounds.push(r)
        // Games / sit-outs are ordered facts: count them as we pass the round.
        for (const c of r.courts) for (const p of [...c.teamA, ...c.teamB]) bump(history.games, p)
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
