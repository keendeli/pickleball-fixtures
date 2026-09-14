import { beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, STORAGE_KEY, loadState } from './storage'
import { playersOnCourt } from './scheduler'
import {
  addPlayer,
  addToday,
  app,
  clearToday,
  endSession,
  markLeft,
  nextRound,
  removeToday,
  setTodayArrived,
  startRound,
  startSession,
} from './store.svelte'

function fakeStorage(raw: string | null): Storage {
  return { getItem: () => raw } as unknown as Storage
}

function reset() {
  if (app.session) endSession()
  app.roster = []
  app.today = []
}

describe('schema migration', () => {
  it('a v1 document loads with today: [] and substituted: [] on its rounds', () => {
    const v1 = {
      schemaVersion: 1,
      roster: [{ id: 'p_1', name: 'Ann', createdAt: '2026-09-01T00:00:00Z' }],
      session: {
        id: 's_1',
        venueId: 'vyc',
        startedAt: '2026-09-14T09:00:00Z',
        roundCount: 2,
        roundMinutes: 10,
        attendees: [{ playerId: 'p_1', arrived: true }],
        rounds: [
          { index: 0, status: 'done', locked: false, courts: [], sitting: ['p_1'] },
          { index: 1, status: 'pending', locked: false, courts: [], sitting: ['p_1'] },
        ],
        currentRound: 1,
        seed: 7,
      },
    }
    const state = loadState(fakeStorage(JSON.stringify(v1)))
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
    expect(state.today).toEqual([])
    expect(state.roster).toHaveLength(1)
    expect(state.session?.rounds.map((r) => r.substituted)).toEqual([[], []])
  })

  it('an empty store is v2 with an empty today list', () => {
    const state = loadState(fakeStorage(null))
    expect(state).toEqual({ schemaVersion: 2, roster: [], session: null, today: [] })
    expect(STORAGE_KEY).toBe('pickleball-fixtures')
  })
})

describe("today's list", () => {
  beforeEach(reset)

  it('adds, toggles arrived, removes and clears', () => {
    const a = addPlayer('Ann')
    const b = addPlayer('Bob')
    addToday(a.id)
    addToday(a.id) // no duplicate
    addToday(b.id)
    addToday('nope') // not in the roster
    expect(app.today.map((t) => t.playerId)).toEqual([a.id, b.id])

    setTodayArrived(a.id, true)
    expect(app.today[0].arrived).toBe(true)
    expect(app.today[0].arrivedAt).toBeTruthy()
    setTodayArrived(a.id, false)
    expect(app.today[0].arrived).toBe(false)
    expect(app.today[0].arrivedAt).toBeUndefined()

    removeToday(b.id)
    expect(app.today.map((t) => t.playerId)).toEqual([a.id])
    expect(app.roster).toHaveLength(2) // roster untouched

    clearToday()
    expect(app.today).toEqual([])
  })

  it('start session from a list of 6 with 4 arrived: 6 attendees, 4 arrived, round 1 is 1 court with 0 sitting', () => {
    const ids = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'].map((n) => addPlayer(n).id)
    for (const id of ids) addToday(id)
    for (const id of ids.slice(0, 4)) setTodayArrived(id, true)

    const s = startSession('vyc', 12, 10)
    expect(s.attendees).toHaveLength(6)
    expect(s.attendees.filter((a) => a.arrived)).toHaveLength(4)
    for (const a of s.attendees.filter((x) => x.arrived)) expect(a.arrivedAt).toBeTruthy()
    expect(s.rounds[0].courts).toHaveLength(1)
    expect(s.rounds[0].sitting).toEqual([])
    expect(playersOnCourt(s.rounds[0]).sort()).toEqual(ids.slice(0, 4).sort())
    expect(app.today).toEqual([]) // consumed
  })

  it('ending a session clears the list', () => {
    addToday(addPlayer('Ann').id)
    startSession('vyc', 3, 5)
    addToday(addPlayer('Bob').id)
    expect(app.today).toHaveLength(1)
    endSession()
    expect(app.today).toEqual([])
    expect(app.session).toBeNull()
  })
})

describe('substitution in the store', () => {
  beforeEach(reset)

  function begin(n: number) {
    const ids = Array.from({ length: n }, (_, i) => addPlayer(`P${i + 1}`).id)
    for (const id of ids) {
      addToday(id)
      setTodayArrived(id, true)
    }
    return startSession('vyc', 4, 10)
  }

  it('a leaver mid-round comes off court now, the filler is marked, and the mark clears on the next round', () => {
    const s = begin(9)
    startRound(0)
    const before = s.rounds[0]
    const leaver = before.courts[0].teamA[1]
    const sitter = before.sitting[0]

    markLeft(leaver)
    const after = app.session!.rounds[0]
    expect(after.status).toBe('active')
    expect(playersOnCourt(after)).not.toContain(leaver)
    expect(after.courts[0].teamA).toEqual([before.courts[0].teamA[0], sitter])
    expect(after.courts[1]).toEqual(before.courts[1])
    expect(after.sitting).toEqual([])
    expect(after.substituted).toEqual([sitter])
    expect(app.session!.attendees.find((a) => a.playerId === leaver)?.leftAfterRound).toBe(-1)

    nextRound()
    expect(app.session!.rounds[0].substituted).toEqual([])
    expect(app.session!.rounds[1].status).toBe('active')
    expect(app.session!.rounds[1].substituted).toEqual([])
    for (const r of app.session!.rounds.slice(1)) expect([...playersOnCourt(r), ...r.sitting]).not.toContain(leaver)
  })

  it('a removal from the current pending round is kept through the rebuild', () => {
    const s = begin(9)
    const before = s.rounds[0]
    const leaver = before.courts[1].teamB[0]
    markLeft(leaver)
    const after = app.session!.rounds[0]
    expect(after.status).toBe('pending')
    expect(after.courts[0]).toEqual(before.courts[0])
    expect(after.substituted).toEqual([before.sitting[0]])
  })
})
