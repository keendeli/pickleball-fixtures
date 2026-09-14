/** Domain types. Everything stored is a fact; derived values are recomputed. */

export interface Player {
  id: string
  name: string
  createdAt: string // ISO
}

export interface Venue {
  id: string
  name: string
  courts: number
}

export interface Attendee {
  playerId: string
  arrived: boolean
  arrivedAt?: string // ISO
  /** Zero-based index of the last round this player took part in. Absent = never left. */
  leftAfterRound?: number
  /** Zero-based round index this player sits out by request. Cleared once that round starts. */
  restingRound?: number
}

export type RoundStatus = 'pending' | 'active' | 'done'

export interface CourtFixture {
  court: number // 1-based court number
  teamA: [string, string]
  teamB: [string, string]
}

export interface Round {
  index: number // zero-based
  status: RoundStatus
  locked: boolean
  courts: CourtFixture[]
  sitting: string[]
  /**
   * Players on court now who were put there by a substitution after the round
   * was generated (someone left, un-arrived or rested mid-round). Cleared when
   * the round finishes or a full regeneration replaces the round.
   */
  substituted: string[]
  startedAt?: string // ISO
  endsAt?: string // ISO
  /** Remaining ms captured when paused; absent when running or not started. */
  pausedRemainingMs?: number
}

export interface Session {
  id: string
  venueId: string
  startedAt: string // ISO
  roundCount: number
  roundMinutes: number
  attendees: Attendee[]
  rounds: Round[]
  currentRound: number
  /** Rounds regenerated from this index onward when attendance changes. */
  seed: number
}

/** A player on today's list, built on the Start screen before the session begins. */
export interface TodayEntry {
  playerId: string
  arrived: boolean
  arrivedAt?: string // ISO
}

export interface AppState {
  schemaVersion: number
  roster: Player[]
  session: Session | null
  /** Draft attendance for the next session. Persists until a session is started or ended. */
  today: TodayEntry[]
}
