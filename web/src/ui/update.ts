// APK only: is there a newer release on GitHub? Checked at most once a day from the
// log list, silently (offline / rate limit = just no notice). The web app updates
// itself through the service worker, so it never asks. Off in Settings = no request.
// Not at all when Google Play installed the app: Play updates it (and forbids pointing
// at another download).

import { announceUpdate, checksGitHub, parseVersion } from '../core/index'
import type { KQSOPlatform } from '../platform/index'
import { switchOn } from './dom'

export const UPDATE_SETTINGS = {
  enabled: 'updateCheck', // '1' / '0', default on
  checkedAt: 'updateCheckedAt', // ms of the last successful check
  latest: 'updateLatest', // newest released version seen, e.g. "1.6.5"
  dismissed: 'updateDismissed', // the version whose notice was hidden
} as const

const LATEST_API = 'https://api.github.com/repos/ok1cdj/kQSO/releases/latest'
export const RELEASES_PAGE = 'https://github.com/ok1cdj/kQSO/releases/latest'
const DAY_MS = 24 * 60 * 60 * 1000

/** The APK came from GitHub (sideloaded): the only case the check runs and shows. */
export function checksUpdates(platform: KQSOPlatform): boolean {
  return checksGitHub(platform.nativeVersion, platform.installSource)
}

/** The newer version to announce, or undefined (not the APK, off, up to date, hidden). */
export async function availableUpdate(platform: KQSOPlatform, now = Date.now()): Promise<string | undefined> {
  const installed = platform.nativeVersion
  if (!installed || !checksUpdates(platform) || !switchOn(await platform.getSetting(UPDATE_SETTINGS.enabled), true)) return undefined
  let latest = await platform.getSetting(UPDATE_SETTINGS.latest)
  const checkedAt = Number(await platform.getSetting(UPDATE_SETTINGS.checkedAt)) || 0
  if (now - checkedAt > DAY_MS) {
    const fetched = await fetchLatest()
    if (fetched) {
      latest = fetched
      await platform.setSetting(UPDATE_SETTINGS.latest, fetched)
      await platform.setSetting(UPDATE_SETTINGS.checkedAt, String(now))
    }
  }
  return announceUpdate(installed, latest, await platform.getSetting(UPDATE_SETTINGS.dismissed))
}

export async function dismissUpdate(platform: KQSOPlatform, version: string): Promise<void> {
  await platform.setSetting(UPDATE_SETTINGS.dismissed, version)
}

async function fetchLatest(): Promise<string | undefined> {
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return undefined
    const tag = ((await res.json()) as { tag_name?: unknown }).tag_name
    return typeof tag === 'string' ? parseVersion(tag) : undefined
  } catch {
    return undefined
  }
}
