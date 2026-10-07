// Anonymous usage statistics for the WEB build only (Umami on stats.ok1cdj.com).
// Sent with a plain fetch to Umami's collect API — no third-party script in the
// bundle (no runtime deps / CDN). Never in the apps (Android, iOS), never in dev, never
// offline-queued; only screen names and a few action names, NEVER log content
// (no calls, locators, QSOs). Switchable in Settings.

import { inNativeShell } from '../platform/index'
import type { KQSOPlatform } from '../platform/index'

const ENDPOINT = 'https://stats.ok1cdj.com/api/send'
const WEBSITE = 'c0350ba6-419e-465a-99f9-6a9af30a783d'

/** Settings key; '0' = off. Default on. */
export const STATS_SETTING = 'stats'

let enabled = false
let referrer = typeof document !== 'undefined' ? document.referrer : ''
let current = '/' // last screen, so an event is attributed to where it happened

/** Read the switch once at start-up. Off inside the APK and in dev builds. */
export async function initStats(platform: KQSOPlatform): Promise<void> {
  enabled = import.meta.env.PROD && !inNativeShell() && (await platform.getSetting(STATS_SETTING)) !== '0'
}

/** The Settings switch — takes effect immediately. */
export function setStatsEnabled(on: boolean): void {
  enabled = on && import.meta.env.PROD && !inNativeShell()
}

/** A screen view, e.g. "logging" → /logging. */
export function trackScreen(screen: string): void {
  current = `/${screen}`
  send({ title: `kQSO ${screen}` })
}

/** A named action with a few non-personal properties, e.g. export {format: 'edi'}. */
export function trackEvent(name: string, data?: Record<string, string | number>): void {
  send(data ? { name, data } : { name })
}

function send(extra: Record<string, unknown>): void {
  if (!enabled || !navigator.onLine) return
  const payload = {
    website: WEBSITE,
    hostname: location.hostname,
    language: navigator.language,
    screen: `${window.screen.width}x${window.screen.height}`,
    url: current,
    title: 'kQSO',
    referrer,
    ...extra,
  }
  referrer = '' // only the first hit carries where the visitor came from
  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'event', payload }),
    keepalive: true,
  }).catch(() => {}) // offline / blocked → dropped, never retried
}
