// Display-mode resolution and switching. The ONLY module that knows the
// mode names — everything else reads CSS tokens. Kept out of components so the
// "no isEink in components" rule holds.

import type { KQSOPlatform } from '../platform/index'

export type DisplayMode = 'eink' | 'standard'

const SETTING_KEY = 'displayMode'

function isMode(v: string | null | undefined): v is DisplayMode {
  return v === 'eink' || v === 'standard'
}

/** Apply a mode instantly by flipping the root attribute — no reload. */
export function applyDisplayMode(mode: DisplayMode): void {
  document.documentElement.dataset.display = mode
}

export function currentDisplayMode(): DisplayMode {
  return document.documentElement.dataset.display === 'eink' ? 'eink' : 'standard'
}

/**
 * Resolve the initial mode by priority:
 *   1. saved user choice, 2. host-forced (APK → eink), 3. default standard.
 * (The @media (update: slow) hint is intentionally not trusted — WebView on the
 * Kompakt reports "fast" — so it is omitted.)
 */
export async function initDisplayMode(platform: KQSOPlatform): Promise<void> {
  const saved = await platform.getSetting(SETTING_KEY)
  const mode: DisplayMode = isMode(saved) ? saved : isMode(platform.displayMode) ? platform.displayMode : 'standard'
  applyDisplayMode(mode)
}

/** Switch mode and persist the choice. Takes effect immediately. */
export async function setDisplayMode(platform: KQSOPlatform, mode: DisplayMode): Promise<void> {
  applyDisplayMode(mode)
  await platform.setSetting(SETTING_KEY, mode)
}
