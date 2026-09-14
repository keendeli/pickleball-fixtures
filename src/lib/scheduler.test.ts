import { describe, expect, it } from 'vitest'
import type { Attendee, Round } from './types'
import {
  activePlayersForRound,
  courtsUsed,
  gamesPlayed,
  pairKey,
  playersOnCourt,
  rebuildSchedule,
  swapPlayers,
} from './scheduler'

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
    }
    const swapped = swapPlayers(round, 'a', 'h')
    expect(swapped.courts[0].teamA).toEqual(['h', 'b'])
    expect(swapped.courts[1].teamB).toEqual(['g', 'a'])
  })
})
