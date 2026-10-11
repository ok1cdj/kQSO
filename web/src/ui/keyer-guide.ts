// The M5 keyer's build guide (parts, schematics, flasher) lives with the keyer, on
// keyer.ok1cdj.com. Opened from kQSO it takes kQSO's language and look.

import { lang } from './i18n'

const GUIDE = 'https://keyer.ok1cdj.com/build.html'

/** The guide in this app's language, display mode (e-ink / standard) and theme. */
export function keyerGuideUrl(): string {
  const root = document.documentElement
  const display = root.dataset.display === 'eink' ? 'eink' : 'standard'
  const t = root.dataset.theme
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const q = new URLSearchParams({ lang, app: 'kqso', display, theme: dark ? 'dark' : 'light' })
  return `${GUIDE}?${q.toString()}`
}

/** A link to the guide; external, so it opens in the browser (APK / iOS: the system one). */
export function keyerGuideLink(label: string, cls?: string): HTMLAnchorElement {
  const a = document.createElement('a')
  if (cls) a.className = cls
  a.textContent = label
  a.href = keyerGuideUrl()
  a.target = '_blank'
  a.rel = 'noopener'
  return a
}
