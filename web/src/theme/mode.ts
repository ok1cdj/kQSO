// Display-mode resolution and switching. The ONLY module that knows the
// mode names — everything else reads CSS tokens. Kept out of components so the
// "no isEink in components" rule holds.

import type { KQSOPlatform } from '../platform/index'

export type DisplayMode = 'eink' | 'standard'
/** Colour theme of the standard mode; e-ink ignores it. */
export type ThemeMode = 'system' | 'light' | 'dark'

const SETTING_KEY = 'displayMode'
const THEME_KEY = 'themeMode'

function isMode(v: string | null | undefined): v is DisplayMode {
  return v === 'eink' || v === 'standard'
}

function isTheme(v: string | null | undefined): v is ThemeMode {
  return v === 'system' || v === 'light' || v === 'dark'
}

let host: KQSOPlatform | undefined
const systemDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined

/** Is the page dark right now? (standard + dark theme, or + system theme on a dark OS) */
function isDark(): boolean {
  const root = document.documentElement
  if (root.dataset.display !== 'standard') return false
  const theme = root.dataset.theme
  return theme === 'dark' || (theme !== 'light' && !!systemDark?.matches)
}

/** Follow the page colours outside it: browser / PWA bar, APK system bars. */
function syncChrome(): void {
  const dark = isDark()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131313' : '#ffffff')
  host?.setDarkBars?.(dark)
}

/** Apply a mode instantly by flipping the root attribute — no reload. */
export function applyDisplayMode(mode: DisplayMode): void {
  document.documentElement.dataset.display = mode
  syncChrome()
}

export function currentDisplayMode(): DisplayMode {
  return document.documentElement.dataset.display === 'eink' ? 'eink' : 'standard'
}

export function applyThemeMode(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
  syncChrome()
}

export function currentThemeMode(): ThemeMode {
  const t = document.documentElement.dataset.theme
  return isTheme(t) ? t : 'system'
}

/**
 * Resolve the initial mode by priority:
 *   1. saved user choice, 2. host-forced (APK → eink), 3. default standard.
 * (The @media (update: slow) hint is intentionally not trusted — WebView on the
 * Kompakt reports "fast" — so it is omitted.) Theme: saved choice, else system.
 */
export async function initDisplayMode(platform: KQSOPlatform): Promise<void> {
  host = platform
  const saved = await platform.getSetting(SETTING_KEY)
  const theme = await platform.getSetting(THEME_KEY)
  const mode: DisplayMode = isMode(saved) ? saved : isMode(platform.displayMode) ? platform.displayMode : 'standard'
  document.documentElement.dataset.theme = isTheme(theme) ? theme : 'system'
  applyDisplayMode(mode)
  systemDark?.addEventListener('change', syncChrome)
}

/** Switch mode and persist the choice. Takes effect immediately. */
export async function setDisplayMode(platform: KQSOPlatform, mode: DisplayMode): Promise<void> {
  applyDisplayMode(mode)
  await platform.setSetting(SETTING_KEY, mode)
}

/** Switch the standard-mode theme and persist it. Takes effect immediately. */
export async function setThemeMode(platform: KQSOPlatform, theme: ThemeMode): Promise<void> {
  applyThemeMode(theme)
  await platform.setSetting(THEME_KEY, theme)
}
