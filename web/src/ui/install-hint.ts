// iOS add-to-home hint. Safari can't prompt programmatically, and only a
// home-screen app escapes WebKit's 7-day data eviction — so we say it in words.
// Shown once per load, dismissible.

import { el, button } from './dom'
import { t } from './i18n'
import { inNativeShell } from '../platform/index'
import { APP_STORE_URL } from './stores'

export function showInstallHintIfNeeded(): void {
  const nav = navigator as unknown as { standalone?: boolean }
  const isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS reports as Mac
  const standalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
  if (!isIos || standalone || inNativeShell()) return // the iOS app keeps its data anyway
  if (APP_STORE_URL) return // the log list offers the App Store instead (stores.ts)

  const bar = el('div', 'install-hint')
  bar.append(
    el('span', undefined, t('install.text')),
    button('×', () => bar.remove(), 'btn btn--small'),
  )
  document.body.append(bar)
}
