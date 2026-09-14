import type { Venue } from './types'

export const VENUES: readonly Venue[] = [
  { id: 'vyc', name: 'Vonda Youngman Centre', courts: 2 },
  { id: 'tmshs', name: 'Tamborine Mountain State High School', courts: 3 },
] as const

export function venueById(id: string): Venue {
  const v = VENUES.find((x) => x.id === id)
  if (!v) throw new Error(`Unknown venue: ${id}`)
  return v
}
