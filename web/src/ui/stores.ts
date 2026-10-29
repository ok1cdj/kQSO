// The kQSO apps in the stores, for people on the web: one quiet line on the log list
// (Android: Google Play; iPhone / iPad: the App Store) and the links
// in Settings → About. Nothing inside the apps themselves.

import { inNativeShell } from '../platform/index'
import type { KQSOPlatform } from '../platform/index'

export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.ok1cdj.kqso'
/** Unset, iOS keeps the add-to-home hint (install-hint.ts) instead of the App Store line. */
export const APP_STORE_URL: string | undefined = 'https://apps.apple.com/app/kqso/id6820009297'

const HIDDEN = 'appPromoHidden' // '1' = the log list line was hidden

export type Store = 'play' | 'appstore'

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS reports as Mac
}

/** The store app for this device on the web, if there is one to offer. */
export function storeForDevice(): { store: Store; url: string } | undefined {
  if (inNativeShell()) return undefined
  if (/android/i.test(navigator.userAgent)) return { store: 'play', url: PLAY_URL }
  if (isIos() && APP_STORE_URL) return { store: 'appstore', url: APP_STORE_URL }
  return undefined
}

/** The log list line, unless hidden before. */
export async function appPromo(platform: KQSOPlatform): Promise<{ store: Store; url: string } | undefined> {
  const s = storeForDevice()
  if (!s || (await platform.getSetting(HIDDEN)) === '1') return undefined
  return s
}

export async function hideAppPromo(platform: KQSOPlatform): Promise<void> {
  await platform.setSetting(HIDDEN, '1')
}
