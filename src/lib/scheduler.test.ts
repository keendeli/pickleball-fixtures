import { describe, expect, it } from 'vitest'
import type { Attendee, Round } from './types'
import {
  OPEN_SLOT,
  activePlayersForRound,
  courtsUsed,
  emptyHistory,
  gamesPlayed,
  historyBefore,
  pairKey,
  playersOnCourt,
  rebuildSchedule,
  substituteInRound,
  swapPlayers,
} from './scheduler'
import { mulberry32 } from './rng'

function attendees(n: number, opts: Partial<Attendee> = {}): Attendee[] {
  return Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, arrived: true, ...opts }))
}

function schedule(players: Attendee[], venueCourts: number, roundCount = 12, rounds: Round[] = [], seed = 1) {
  return rebuildSchedule({ venueCourts, roundCount, attendees: players, rounds, seed })
}

function assertWellFormed(rounds: Round[], expectedCourts: number, active: string[]) {
  for (const r of rounds) {
    expect(r.courts.length).toBe(expectedCourts)
    const onCourt = playersOnCourt(r)
    const all = [...onCourt, ...r.sitting].sort()
    expect(all).toEqual(active.slice().sort())
    expect(new Set(all).size).toBe(all.length)
    r.courts.forEach((c, i) => expect(c.court).toBe(i + 1))
  }
}

function partnerRepeats(rounds: Round[]): number {
  const seen = new Map<string, number>()
  for (const r of rounds)
    for (const c of r.courts) {
      for (const k of [pairKey(...c.teamA), pairKey(...c.teamB)]) seen.set(k, (seen.get(k) ?? 0) + 1)
    }
  let repeats = 0
  for (const n of seen.values()) repeats += Math.max(0, n - 1)
  return repeats
}

function spread(counts: Map<string, number>, ids: string[]): number {
  const values = ids.map((id) => counts.get(id) ?? 0)
  return Math.max(...values) - Math.min(...values)
}

describe('courtsUsed', () => {
  it('uses fewer courts than available when the player count requires it', () => {
    expect(courtsUsed(3, 11)).toBe(2)
    expect(courtsUsed(3, 7)).toBe(1)
    expect(courtsUsed(3, 16)).toBe(3)
    expect(courtsUsed(2, 16)).toBe(2)
    expect(courtsUsed(2, 3)).toBe(0)
    expect(courtsUsed(2, 8)).toBe(2)
  })
})

describe('rebuildSchedule', () => {
  it('8 players on 2 courts: nobody sits', () => {
    const a = attendees(8)
    const rounds = schedule(a, 2)
    expect(rounds).toHaveLength(12)
    assertWellFormed(rounds, 2, a.map((x) => x.playerId))
    for (const r of rounds) expect(r.sitting).toEqual([])
  })

  it('9 players on 2 courts: one sits each round, sit-outs spread evenly', () => {
    const a = attendees(9)
    const ids = a.map((x) => x.playerId)
    const rounds = schedule(a, 2)
    assertWellFormed(rounds, 2, ids)
    for (const r of rounds) expect(r.sitting).toHaveLength(1)
    const games = gamesPlayed(rounds)
    expect(spread(games, ids)).toBeLessThanOrEqual(1)
    // 12 sit-outs across 9 players: nobody sits more than twice, nobody sits twice in a row.
    const sits = new Map<string, number[]>()
    rounds.forEach((r) => r.sitting.forEach((p) => sits.set(p, [...(sits.get(p) ?? []), r.index])))
    for (const [, idx] of sits) {
      expect(idx.length).toBeLessThanOrEqual(2)
      for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThan(1)
    }
  })

  it('11 players at the 3-court venue uses 2 courts', () => {
    const a = attendees(11)
    const rounds = schedule(a, 3)
    assertWellFormed(rounds, 2, a.map((x) => x.playerId))
    for (const r of rounds) expect(r.sitting).toHaveLength(3)
    expect(spread(gamesPlayed(rounds), a.map((x) => x.playerId))).toBeLessThanOrEqual(1)
  })

  it('7 players at the 3-court venue uses 1 court', () => {
    const a = attendees(7)
    const rounds = schedule(a, 3)
    assertWellFormed(rounds, 1, a.map((x) => x.playerId))
    for (const r of rounds) expect(r.sitting).toHaveLength(3)
    expect(spread(gamesPlayed(rounds), a.map((x) => x.playerId))).toBeLessThanOrEqual(1)
  })

  it('16 players at the 3-court venue uses 3 courts with 4 sitting', () => {
    const a = attendees(16)
    const rounds = schedule(a, 3)
    assertWellFormed(rounds, 3, a.map((x) => x.playerId))
    for (const r of rounds) expect(r.sitting).toHaveLength(4)
    expect(spread(gamesPlayed(rounds), a.map((x) => x.playerId))).toBeLessThanOrEqual(1)
  })

  it('3 players uses 0 courts and everyone sits', () => {
    const a = attendees(3)
    const rounds = schedule(a, 2)
    expect(rounds).toHaveLength(12)
    for (const r of rounds) {
      expect(r.courts).toEqual([])
      expect(r.sitting).toEqual(['p1', 'p2', 'p3'])
    }
  })

  it('a player arriving before round 3 is scheduled from round 3; rounds 1 and 2 unchanged', () => {
    const a = attendees(8)
    const first = schedule(a, 2)
    // Rounds 1 and 2 have been played.
    const played = first.map((r, i) => (i < 2 ? { ...r, status: 'done' as const } : r))
    const late: Attendee = { playerId: 'p9', arrived: true, arrivedAt: '2026-09-14T09:25:00Z' }
    const rebuilt = schedule([...a, late], 2, 12, played)

    expect(rebuilt[0]).toBe(played[0])
    expect(rebuilt[1]).toBe(played[1])
    for (const r of rebuilt.slice(0, 2)) expect([...playersOnCourt(r), ...r.sitting]).not.toContain('p9')
    // Fewest games played, so p9 is on court in round 3.
    expect(playersOnCourt(rebuilt[2])).toContain('p9')
    for (const r of rebuilt.slice(2)) expect([...playersOnCourt(r), ...r.sitting]).toContain('p9')
    assertWellFormed(rebuilt.slice(2), 2, [...a.map((x) => x.playerId), 'p9'])
  })

  it('a player leaving after round 8 is absent from round 9 onward; earlier rounds unchanged', () => {
    const a = attendees(9)
    const first = schedule(a, 2)
    const played = first.map((r, i) => (i < 8 ? { ...r, status: 'done' as const } : r))
    const withLeaver = a.map((x) => (x.playerId === 'p5' ? { ...x, leftAfterRound: 7 } : x))
    const rebuilt = schedule(withLeaver, 2, 12, played)

    for (let i = 0; i < 8; i++) expect(rebuilt[i]).toBe(played[i])
    for (const r of rebuilt.slice(8)) {
      expect([...playersOnCourt(r), ...r.sitting]).not.toContain('p5')
      expect(r.courts).toHaveLength(2)
      expect(r.sitting).toEqual([])
    }
  })

  it('partner repeats are zero for 8 players over 7 rounds', () => {
    const a = attendees(8)
    const rounds = schedule(a, 2, 7)
    assertWellFormed(rounds, 2, a.map((x) => x.playerId))
    expect(partnerRepeats(rounds)).toBe(0)
  })

  it('a locked round survives regeneration', () => {
    const a = attendees(9)
    const first = schedule(a, 2)
    const locked = first.map((r, i) => (i === 5 ? { ...r, locked: true } : r))
    // Attendance changes: a tenth player arrives.
    const rebuilt = schedule([...a, { playerId: 'p10', arrived: true }], 2, 12, locked, 99)
    expect(rebuilt[5]).toBe(locked[5])
    expect([...playersOnCourt(rebuilt[5]), ...rebuilt[5].sitting]).not.toContain('p10')
    for (const r of rebuilt) if (r.index !== 5) expect([...playersOnCourt(r), ...r.sitting]).toContain('p10')
  })

  it('is deterministic for a given seed', () => {
    const a = attendees(11)
    expect(schedule(a, 3, 12, [], 42)).toEqual(schedule(a, 3, 12, [], 42))
  })

  it('a resting player sits out only that round', () => {
    const a = attendees(8).map((x) => (x.playerId === 'p3' ? { ...x, restingRound: 4 } : x))
    const rounds = schedule(a, 2)
    expect(rounds[4].courts).toHaveLength(1)
    expect([...playersOnCourt(rounds[4]), ...rounds[4].sitting]).not.toContain('p3')
    expect(playersOnCourt(rounds[3])).toContain('p3')
    expect(playersOnCourt(rounds[5])).toContain('p3')
  })

  it('active players exclude those who have left or are resting', () => {
    const a: Attendee[] = [
      { playerId: 'a', arrived: true },
      { playerId: 'b', arrived: false },
      { playerId: 'c', arrived: true, leftAfterRound: 3 },
      { playerId: 'd', arrived: true, restingRound: 4 },
    ]
    expect(activePlayersForRound(a, 3)).toEqual(['a', 'c', 'd'])
    expect(activePlayersForRound(a, 4)).toEqual(['a'])
    expect(activePlayersForRound(a, 5)).toEqual(['a', 'd'])
  })
})

describe('swapPlayers', () => {
  it('swaps a court player with a sitting player', () => {
    const round: Round = {
      index: 0,
      status: 'pending',
      locked: false,
      courts: [{ court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] }],
      sitting: ['e'],
      substituted: [],
    }
    const swapped = swapPlayers(round, 'b', 'e')
    expect(swapped.courts[0].teamA).toEqual(['a', 'e'])
    expect(swapped.sitting).toEqual(['b'])
    expect(round.courts[0].teamA).toEqual(['a', 'b'])
  })

  it('swaps two players across courts', () => {
    const round: Round = {
      index: 0,
      status: 'pending',
      locked: false,
      courts: [
        { court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] },
        { court: 2, teamA: ['e', 'f'], teamB: ['g', 'h'] },
      ],
      sitting: [],
      substituted: [],
    }
    const swapped = swapPlayers(round, 'a', 'h')
    expect(swapped.courts[0].teamA).toEqual(['h', 'b'])
    expect(swapped.courts[1].teamB).toEqual(['g', 'a'])
  })
})

describe('substituteInRound', () => {
  function without(ids: string[], gone: string): string[] {
    return ids.filter((p) => p !== gone)
  }

  it('removing a sitting-out player leaves every court unchanged and substituted empty', () => {
    const a = attendees(11)
    const ids = a.map((x) => x.playerId)
    const round = { ...schedule(a, 2)[0], status: 'active' as const }
    const gone = round.sitting[0]
    const out = substituteInRound(round, without(ids, gone), 2, emptyHistory(), mulberry32(1))
    expect(out.courts).toEqual(round.courts)
    expect(out.sitting).toEqual(round.sitting.filter((p) => p !== gone))
    expect(out.substituted).toEqual([])
  })

  it('returns the same object when nobody has been removed', () => {
    const a = attendees(9)
    const round = schedule(a, 2)[0]
    expect(substituteInRound(round, a.map((x) => x.playerId), 2, emptyHistory(), mulberry32(1))).toBe(round)
  })

  it('removing an on-court player when players sit: one sitter fills that exact slot, all else identical', () => {
    const a = attendees(11)
    const ids = a.map((x) => x.playerId)
    const rounds = schedule(a, 2)
    // Round 3 is in play; rounds 1 and 2 are history.
    const round = { ...rounds[2], status: 'active' as const }
    const history = historyBefore(rounds, 2)
    const gone = round.courts[1].teamB[0]
    const out = substituteInRound(round, without(ids, gone), 2, history, mulberry32(1))

    expect(out.courts).toHaveLength(2)
    expect(out.courts[0]).toEqual(round.courts[0])
    expect(out.courts[1].teamA).toEqual(round.courts[1].teamA)
    expect(out.courts[1].teamB[1]).toBe(round.courts[1].teamB[1])
    const filler = out.courts[1].teamB[0]
    expect(round.sitting).toContain(filler)
    expect(out.sitting).toEqual(round.sitting.filter((p) => p !== filler))
    expect(out.substituted).toEqual([filler])
    expect([...playersOnCourt(out), ...out.sitting]).not.toContain(gone)
  })

  it('the filler is the sitter with fewest games, then who sat most recently', () => {
    const round: Round = {
      index: 5,
      status: 'active',
      locked: false,
      courts: [{ court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] }],
      sitting: ['x', 'y', 'z'],
      substituted: [],
    }
    const h = emptyHistory()
    h.games.set('x', 4).set('y', 3).set('z', 3)
    h.lastSat.set('y', 1).set('z', 4)
    const out = substituteInRound(round, ['a', 'b', 'c', 'x', 'y', 'z'], 1, h, mulberry32(1))
    expect(out.courts[0].teamB).toEqual(['c', 'z'])
    expect(out.sitting).toEqual(['x', 'y'])
    expect(out.substituted).toEqual(['z'])
  })

  it('nobody sits and the court count drops (8 to 7 on 2 courts): 1 court, 3 sitting, changed players marked', () => {
    const a = attendees(8)
    const ids = a.map((x) => x.playerId)
    const round = { ...schedule(a, 2)[0], status: 'active' as const }
    const gone = 'p3'
    const out = substituteInRound(round, without(ids, gone), 2, emptyHistory(), mulberry32(1))

    expect(out.courts).toHaveLength(1)
    expect(out.sitting).toHaveLength(3)
    const all = [...playersOnCourt(out), ...out.sitting].sort()
    expect(all).toEqual(without(ids, gone).sort())

    const slotBefore = new Map<string, string>()
    for (const c of round.courts) {
      for (const p of c.teamA) slotBefore.set(p, `${c.court}A`)
      for (const p of c.teamB) slotBefore.set(p, `${c.court}B`)
    }
    const changed: string[] = []
    for (const c of out.courts) {
      for (const p of c.teamA) if (slotBefore.get(p) !== `${c.court}A`) changed.push(p)
      for (const p of c.teamB) if (slotBefore.get(p) !== `${c.court}B`) changed.push(p)
    }
    expect(out.substituted).toEqual(changed.sort())
    expect(out.substituted).not.toContain(gone)
  })

  it('a re-solve keeps an existing pair together when it can', () => {
    const round: Round = {
      index: 0,
      status: 'active',
      locked: false,
      courts: [
        { court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] },
        { court: 2, teamA: ['e', 'f'], teamB: ['g', 'h'] },
      ],
      sitting: [],
      substituted: [],
    }
    // Everyone equal on games; pin who plays via the history so only the pairing is free.
    const h = emptyHistory()
    for (const p of ['e', 'f', 'g']) h.games.set(p, 1)
    const out = substituteInRound(round, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 2, h, mulberry32(3))
    expect(out.courts).toHaveLength(1)
    expect(playersOnCourt(out).sort()).toEqual(['a', 'b', 'c', 'd'])
    const teams = out.courts[0]
    expect([pairKey(...teams.teamA), pairKey(...teams.teamB)].sort()).toEqual([pairKey('a', 'b'), pairKey('c', 'd')].sort())
    expect(out.substituted).toEqual([])
  })

  it('a late arrival during the round (not yet in it) is a substitution candidate', () => {
    const round: Round = {
      index: 0,
      status: 'active',
      locked: false,
      courts: [
        { court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] },
        { court: 2, teamA: ['e', 'f'], teamB: ['g', 'h'] },
      ],
      sitting: [],
      substituted: [],
    }
    // h left, m arrived after the round started: 8 active on 2 courts, m fills h's slot.
    const out = substituteInRound(round, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'm'], 2, emptyHistory(), mulberry32(1))
    expect(out.courts[0]).toEqual(round.courts[0])
    expect(out.courts[1]).toEqual({ court: 2, teamA: ['e', 'f'], teamB: ['g', 'm'] })
    expect(out.sitting).toEqual([])
    expect(out.substituted).toEqual(['m'])
    expect(playersOnCourt(out)).not.toContain(OPEN_SLOT)
  })

  it('accumulates marks across successive removals and drops marks for players no longer on court', () => {
    const a = attendees(12)
    const ids = a.map((x) => x.playerId)
    const round = { ...schedule(a, 2)[0], status: 'active' as const }
    const first = substituteInRound(round, without(ids, round.courts[0].teamA[0]), 2, emptyHistory(), mulberry32(1))
    expect(first.substituted).toHaveLength(1)
    const second = substituteInRound(first, without(without(ids, round.courts[0].teamA[0]), first.courts[1].teamB[1]), 2, emptyHistory(), mulberry32(2))
    expect(second.substituted).toHaveLength(2)
    expect(second.substituted).toContain(first.substituted[0])
  })
})

describe('rebuildSchedule with freeze', () => {
  it('keeps a frozen index as-is even when pending and unlocked', () => {
    const a = attendees(9)
    const first = schedule(a, 2)
    const rebuilt = rebuildSchedule({
      venueCourts: 2,
      roundCount: 12,
      attendees: [...a, { playerId: 'p10', arrived: true }],
      rounds: first,
      seed: 5,
      freeze: [0],
    })
    expect(rebuilt[0]).toBe(first[0])
    expect([...playersOnCourt(rebuilt[1]), ...rebuilt[1].sitting]).toContain('p10')
  })
})
