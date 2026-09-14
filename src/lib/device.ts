/** Browser device helpers: audio beep, vibration, wake lock. All optional. */

let ctx: AudioContext | null = null

/** Call from a user gesture so the audio context is allowed to run. */
export function primeAudio(): void {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

/** Three short rising beeps, synthesised; no asset file. */
export function beep(): void {
  try {
    if (!ctx) primeAudio()
    if (!ctx) return
    const t0 = ctx.currentTime
    const notes = [880, 1108, 1318]
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'square'
      osc.frequency.value = freq
      const start = t0 + i * 0.22
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(start)
      osc.stop(start + 0.21)
    })
  } catch {
    // Audio is a nicety; ignore failures.
  }
}

export function vibrate(pattern: number | number[] = [200, 100, 200, 100, 400]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // ignore
  }
}

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener?: (t: string, cb: () => void) => void }

let sentinel: WakeLockSentinelLike | null = null

export async function requestWakeLock(): Promise<boolean> {
  const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock
  if (!wl) return false
  try {
    sentinel = await wl.request('screen')
    sentinel.addEventListener?.('release', () => {
      sentinel = null
    })
    return true
  } catch {
    sentinel = null
    return false
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release()
  } finally {
    sentinel = null
  }
}

export function wakeLockHeld(): boolean {
  return sentinel !== null
}
