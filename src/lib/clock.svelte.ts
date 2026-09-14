/** A shared ticking clock. Screens call `useClock()` inside $effect to keep it running. */
export const clock = $state({ now: Date.now() })

let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

function tick() {
  clock.now = Date.now()
}

function onVisible() {
  if (document.visibilityState === 'visible') tick()
}

/** Returns a cleanup function. Use as: $effect(() => useClock()) */
export function useClock(): () => void {
  subscribers++
  if (!timer) {
    tick()
    timer = setInterval(tick, 250)
    document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    subscribers--
    if (subscribers <= 0 && timer) {
      clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}
