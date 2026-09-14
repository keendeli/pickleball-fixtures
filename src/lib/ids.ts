export function newId(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return prefix ? `${prefix}_${rand}` : rand
}

export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}
