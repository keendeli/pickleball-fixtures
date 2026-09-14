/**
 * Application state as a single Svelte 5 $state document persisted to
 * localStorage. All mutations go through the exported actions so that the
 * schedule is regenerated exactly when attendance facts change.
 */
import type { AppState, Attendee, Player, Round, Session, TodayEntry } from './types'
import { loadState, saveState } from './storage'
import { newId, newSeed } from './ids'
import { venueById } from './venues'
import {
  rebuildSchedule,
  swapPlayers,
  activePlayersForRound,
  courtsUsed,
  historyBefore,
  isFrozen,
  substituteInRound,
} from './scheduler'
import { mulberry32 } from './rng'

export const app = $state<AppState>(loadState())

export function persist(): void {
  saveState($state.snapshot(app))
}

// ---------- roster ----------

export function playerName(id: string): string {
  return app.roster.find((p) => p.id === id)?.name ?? 'Unknown'
}

export function findPlayerByName(name: string): Player | undefined {
  const needle = name.trim().toLowerCase()
  return app.roster.find((p) => p.name.trim().toLowerCase() === needle)
}

export function addPlayer(name: string): Player {
  const trimmed = name.trim()
  const existing = findPlayerByName(trimmed)
  if (existing) return existing
  const player: Player = { id: newId('p'), name: trimmed, createdAt: new Date().toISOString() }
  app.roster.push(player)
  app.roster.sort((a, b) => a.name.localeCompare(b.name))
  persist()
  return player
}

export function renamePlayer(id: string, name: string): void {
  const p = app.roster.find((x) => x.id === id)
  if (!p || !name.trim()) return
  p.name = name.trim()
  app.roster.sort((a, b) => a.name.localeCompare(b.name))
  persist()
}

export function playerInSession(id: string): boolean {
  return app.session?.attendees.some((a) => a.playerId === id) ?? false
}

export function removePlayer(id: string): boolean {
  if (playerInSession(id)) return false
  app.roster = app.roster.filter((p) => p.id !== id)
  persist()
  return true
}

// ---------- today's list (draft attendance before a session starts) ----------

export function addToday(playerId: string): void {
  if (!app.roster.some((p) => p.id === playerId)) return
  if (app.today.some((t) => t.playerId === playerId)) return
  app.today.push({ playerId, arrived: false })
  persist()
}

export function removeToday(playerId: string): void {
  app.today = app.today.filter((t) => t.playerId !== playerId)
  persist()
}

export function setTodayArrived(playerId: string, arrived: boolean): void {
  const t = app.today.find((x) => x.playerId === playerId)
  if (!t) return
  t.arrived = arrived
  if (arrived) t.arrivedAt = new Date().toISOString()
  else delete t.arrivedAt
  persist()
}

export function clearToday(): void {
  app.today = []
  persist()
}

// ---------- session lifecycle ----------

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function hasSessionForToday(): boolean {
  return app.session !== null && todayKey(new Date(app.session.startedAt)) === todayKey()
}

/**
 * Create a new session from today's list. Each entry becomes an attendee
 * carrying its arrived flag (and arrivedAt), so the Check-in screen lists the
 * not-yet-arrived under Expected and round 1 is built from those who have
 * arrived. Unknown or duplicate ids are ignored. Today's list is consumed.
 * The schedule is generated once at the end.
 */
export function startSession(
  venueId: string,
  roundCount: number,
  roundMinutes: number,
  today: TodayEntry[] = app.today,
): Session {
  venueById(venueId) // throws on bad id
  const rosterIds = new Set(app.roster.map((p) => p.id))
  const attendees: Attendee[] = []
  for (const t of today) {
    if (!rosterIds.has(t.playerId) || attendees.some((a) => a.playerId === t.playerId)) continue
    const attendee: Attendee = { playerId: t.playerId, arrived: t.arrived }
    if (t.arrived) attendee.arrivedAt = t.arrivedAt ?? new Date().toISOString()
    attendees.push(attendee)
  }
  const session: Session = {
    id: newId('s'),
    venueId,
    startedAt: new Date().toISOString(),
    roundCount: Math.max(1, Math.floor(roundCount)),
    roundMinutes: Math.max(1, Math.floor(roundMinutes)),
    attendees,
    rounds: [],
    currentRound: 0,
    seed: newSeed(),
  }
  app.session = session
  app.today = []
  regenerate()
  return app.session
}

export function endSession(): void {
  app.session = null
  app.today = []
  persist()
}

function requireSession(): Session {
  if (!app.session) throw new Error('No active session')
  return app.session
}

// ---------- attendance ----------

export function addAttendee(playerId: string, arrived = false): void {
  const s = requireSession()
  if (s.attendees.some((a) => a.playerId === playerId)) return
  const attendee: Attendee = { playerId, arrived }
  if (arrived) attendee.arrivedAt = new Date().toISOString()
  s.attendees.push(attendee)
  regenerate()
}

export function removeAttendee(playerId: string): void {
  const s = requireSession()
  s.attendees = s.attendees.filter((a) => a.playerId !== playerId)
  regenerate()
}

export function setArrived(playerId: string, arrived: boolean): void {
  const s = requireSession()
  const a = s.attendees.find((x) => x.playerId === playerId)
  if (!a) return
  a.arrived = arrived
  if (arrived) {
    a.arrivedAt = new Date().toISOString()
    delete a.leftAfterRound
  } else {
    delete a.arrivedAt
    delete a.leftAfterRound
    delete a.restingRound
  }
  regenerate()
}

/**
 * Index of the last round the player took part in when they leave now. A
 * round in play does not count: the leaver comes off court immediately and a
 * substitute fills the spot (see regenerate). Only a finished current round
 * (end of session) counts as played.
 */
export function leavingAfterRound(): number {
  const s = requireSession()
  const current = s.rounds[s.currentRound]
  if (current && current.status === 'done') return s.currentRound
  return s.currentRound - 1
}

export function markLeft(playerId: string): void {
  const s = requireSession()
  const a = s.attendees.find((x) => x.playerId === playerId)
  if (!a) return
  a.leftAfterRound = leavingAfterRound()
  delete a.restingRound
  regenerate()
}

export function unmarkLeft(playerId: string): void {
  const s = requireSession()
  const a = s.attendees.find((x) => x.playerId === playerId)
  if (!a) return
  delete a.leftAfterRound
  regenerate()
}

export function setResting(playerId: string, roundIndex: number | undefined): void {
  const s = requireSession()
  const a = s.attendees.find((x) => x.playerId === playerId)
  if (!a) return
  if (roundIndex === undefined) delete a.restingRound
  else a.restingRound = roundIndex
  regenerate()
}

/** The round a "rest" request applies to: this one if not started, else the next. */
export function restTargetRound(): number | undefined {
  const s = requireSession()
  const current = s.rounds[s.currentRound]
  if (!current) return undefined
  const target = current.status === 'pending' ? s.currentRound : s.currentRound + 1
  return target < s.roundCount ? target : undefined
}

// ---------- rounds ----------

/**
 * Bring the schedule back in line with the attendance facts.
 *
 * Rounds that are frozen (in play, done or locked) and the current round are
 * never rebuilt from scratch when a player drops out of them: the round is
 * re-solved with minimal disruption (substituteInRound) and the fillers are
 * recorded in `substituted`. The current round is then kept for this rebuild
 * even if it is pending and unlocked, so the substitution is what the
 * convenor sees; a later arrival regenerates a pending round as before.
 * Every other pending, unlocked round is recomputed by rebuildSchedule.
 */
export function regenerate(): void {
  const s = requireSession()
  const venue = venueById(s.venueId)
  // Resting flags only matter for pending rounds; clear stale ones.
  for (const a of s.attendees) {
    if (a.restingRound !== undefined) {
      const r = s.rounds[a.restingRound]
      if (r && r.status !== 'pending') delete a.restingRound
    }
  }
  const attendees = $state.snapshot(s.attendees)
  const rounds: Round[] = $state.snapshot(s.rounds)
  const freeze: number[] = []
  for (const r of rounds) {
    if (r.index < s.currentRound || r.status === 'done') continue
    if (r.index !== s.currentRound && !isFrozen(r)) continue
    const active = activePlayersForRound(attendees, r.index)
    const sub = substituteInRound(r, active, venue.courts, historyBefore(rounds, r.index), mulberry32(s.seed ^ (r.index * 2654435761)))
    if (sub === r) continue
    rounds[r.index] = sub
    if (r.index === s.currentRound) freeze.push(r.index)
  }
  s.rounds = rebuildSchedule({
    venueCourts: venue.courts,
    roundCount: s.roundCount,
    attendees,
    rounds,
    seed: s.seed,
    freeze,
  })
  persist()
}

export function reshuffle(): void {
  const s = requireSession()
  s.seed = newSeed()
  regenerate()
}

export function swapInRound(roundIndex: number, a: string, b: string): void {
  const s = requireSession()
  const r = s.rounds[roundIndex]
  if (!r || r.status === 'done') return
  s.rounds[roundIndex] = swapPlayers($state.snapshot(r), a, b)
  persist()
}

export function toggleLock(roundIndex: number): void {
  const s = requireSession()
  const r = s.rounds[roundIndex]
  if (!r) return
  r.locked = !r.locked
  // Unlocking lets the round regenerate again; locking freezes it as shown.
  regenerate()
}

function roundMs(s: Session): number {
  return s.roundMinutes * 60_000
}

export function startRound(roundIndex: number): void {
  const s = requireSession()
  const r = s.rounds[roundIndex]
  if (!r || r.status !== 'pending') return
  const now = Date.now()
  r.status = 'active'
  r.startedAt = new Date(now).toISOString()
  r.endsAt = new Date(now + roundMs(s)).toISOString()
  delete r.pausedRemainingMs
  s.currentRound = roundIndex
  regenerate() // clears resting flags that have now been consumed
}

export function pauseRound(roundIndex: number): void {
  const s = requireSession()
  const r = s.rounds[roundIndex]
  if (!r || r.status !== 'active' || !r.endsAt) return
  r.pausedRemainingMs = Math.max(0, new Date(r.endsAt).getTime() - Date.now())
  delete r.endsAt
  persist()
}

export function resumeRound(roundIndex: number): void {
  const s = requireSession()
  const r = s.rounds[roundIndex]
  if (!r || r.status !== 'active' || r.pausedRemainingMs === undefined) return
  r.endsAt = new Date(Date.now() + r.pausedRemainingMs).toISOString()
  delete r.pausedRemainingMs
  persist()
}

export function finishRound(roundIndex: number): void {
  const s = requireSession()
  const r = s.rounds[roundIndex]
  if (!r || r.status === 'done') return
  r.status = 'done'
  r.substituted = []
  delete r.endsAt
  delete r.pausedRemainingMs
  if (roundIndex + 1 < s.roundCount) s.currentRound = roundIndex + 1
  regenerate()
}

/** Finish the current round and immediately start the next one. */
export function nextRound(): void {
  const s = requireSession()
  const idx = s.currentRound
  finishRound(idx)
  if (idx + 1 < s.roundCount) startRound(idx + 1)
}

/** Remaining milliseconds for a round at a given instant. */
export function remainingMs(r: Round, now: number): number {
  if (r.pausedRemainingMs !== undefined) return r.pausedRemainingMs
  if (r.endsAt) return Math.max(0, new Date(r.endsAt).getTime() - now)
  return 0
}

// ---------- derived helpers for the UI ----------

export function roundSummary(roundIndex: number): { active: number; onCourt: number; sitting: number; courts: number } {
  const s = requireSession()
  const venue = venueById(s.venueId)
  const active = activePlayersForRound(s.attendees, roundIndex)
  const courts = courtsUsed(venue.courts, active.length)
  return { active: active.length, onCourt: courts * 4, sitting: active.length - courts * 4, courts }
}

export function arrivedCount(): number {
  return app.session?.attendees.filter((a) => a.arrived && a.leftAfterRound === undefined).length ?? 0
}
