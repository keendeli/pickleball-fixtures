import type { AppState } from './types'

export const STORAGE_KEY = 'pickleball-fixtures'
export const SCHEMA_VERSION = 1

export function emptyState(): AppState {
  return { schemaVersion: SCHEMA_VERSION, roster: [], session: null }
}

/** Upgrade older documents in place. Add a case per schema bump. */
function migrate(doc: Record<string, unknown>): AppState {
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0
  if (version > SCHEMA_VERSION) {
    // Written by a newer build; keep what we understand.
    return { ...emptyState(), ...doc, schemaVersion: SCHEMA_VERSION } as AppState
  }
  return { ...emptyState(), ...doc, schemaVersion: SCHEMA_VERSION } as AppState
}

export function loadState(storage: Storage | undefined = globalThis.localStorage): AppState {
  if (!storage) return emptyState()
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const doc = JSON.parse(raw)
    if (!doc || typeof doc !== 'object') return emptyState()
    return migrate(doc)
  } catch {
    return emptyState()
  }
}

export function saveState(state: AppState, storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota or private mode: nothing sensible to do at the venue.
  }
}
