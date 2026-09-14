/**
 * "Add to home screen" support. Imported from main.ts before the app mounts so
 * Chrome's `beforeinstallprompt` is captured even if it fires before the
 * Start screen renders. All state is in memory; nothing is persisted.
 */

/** Chrome / Edge / Android non-standard event. Not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui'] as const

export const install = $state({
  /** The deferred Chrome prompt, or null when the browser has not offered one. */
  prompt: null as BeforeInstallPromptEvent | null,
  /** True when running as an installed app (standalone, fullscreen, minimal-ui, or iOS home screen). */
  installed: false,
})

/** True when the page is displayed as an installed app rather than in a browser tab. */
export function isInstalledDisplay(): boolean {
  if (typeof window === 'undefined') return false
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true
  return DISPLAY_MODES.some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches)
}

/** iPhone / iPad / iPod Safari, including iPadOS which reports itself as a Mac with touch. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
}

let listening = false

/** Register the window listeners once. Safe to call more than once. */
export function listenForInstall(): void {
  if (listening || typeof window === 'undefined') return
  listening = true

  install.installed = isInstalledDisplay()

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    install.prompt = e as BeforeInstallPromptEvent
  })

  window.addEventListener('appinstalled', () => {
    install.prompt = null
    install.installed = true
  })

  for (const m of DISPLAY_MODES) {
    const mq = window.matchMedia?.(`(display-mode: ${m})`)
    mq?.addEventListener?.('change', () => {
      install.installed = isInstalledDisplay()
    })
  }
}

/**
 * Show Chrome's install dialog. Resolves true when the user accepted.
 * The prompt is single-use, so it is cleared either way.
 */
export async function promptInstall(): Promise<boolean> {
  const p = install.prompt
  if (!p) return false
  install.prompt = null
  try {
    await p.prompt()
    const { outcome } = await p.userChoice
    if (outcome === 'accepted') install.installed = true
    return outcome === 'accepted'
  } catch {
    return false
  }
}
