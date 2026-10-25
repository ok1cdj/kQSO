// Hardware-keyboard shortcuts on the logging screen, as in Tučňák: macros from F5 (F1–F4
// belong to the browser / system), PgUp / PgDn the CW speed, Alt+letter the line commands
// and navigation (Alt+O the ON4KST chat), Ctrl+Enter save now, Ctrl+M ESM. Pure — DOM-free, so it can be unit-tested; the
// logging screen decides whether a shortcut applies (keyer, radio) and lets the key
// through when it doesn't.

/** The macro memories F5 F6 F7 F8 F11 F12 (F9 / F10 stay free); the first four are also
 *  the radio's voice memories T1–T4 in SSB / FM. */
export const F_KEYS = ['F5', 'F6', 'F7', 'F8', 'F11', 'F12'] as const

export type Shortcut =
  | { readonly type: 'memory'; readonly index: number } // F_KEYS index
  | { readonly type: 'speed'; readonly delta: number }
  | { readonly type: 'line'; readonly letter: 'W' | 'D' | 'H' | 'E' } // the line command
  | { readonly type: 'keyer'; readonly letter: 'R' | 'S' | 'C' | 'K' } // the keyer command
  | { readonly type: 'loc' } // take the locator the database offers
  | { readonly type: 'mode' } // CW → SSB → FM
  | { readonly type: 'list' }
  | { readonly type: 'back' }
  | { readonly type: 'save' }
  | { readonly type: 'esm' } // ESM on / off
  | { readonly type: 'chat' } // the ON4KST chat

export interface KeyInput {
  readonly key: string
  readonly code: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

const ALT: Readonly<Record<string, Shortcut>> = {
  KeyW: { type: 'line', letter: 'W' },
  KeyD: { type: 'line', letter: 'D' },
  KeyH: { type: 'line', letter: 'H' },
  KeyE: { type: 'line', letter: 'E' },
  KeyR: { type: 'keyer', letter: 'R' },
  KeyS: { type: 'keyer', letter: 'S' },
  KeyC: { type: 'keyer', letter: 'C' },
  KeyK: { type: 'keyer', letter: 'K' },
  KeyX: { type: 'loc' },
  KeyM: { type: 'mode' },
  KeyL: { type: 'list' },
  KeyQ: { type: 'back' },
  KeyO: { type: 'chat' },
}

/** The shortcut a key press stands for, or undefined (ordinary typing, or the browser's).
 *  Alt goes by the physical key (`code`): macOS Option gives other characters in `key`. */
export function matchShortcut(e: KeyInput): Shortcut | undefined {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey) return { type: 'save' }
  // Ctrl, not Cmd: Cmd+M minimizes the window on macOS. (Firefox mutes the tab on Ctrl+M —
  // the screen takes the key only while CW keying is on.)
  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM') return { type: 'esm' }
  if (e.altKey && !e.ctrlKey && !e.metaKey) return ALT[e.code]
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return undefined
  const f = (F_KEYS as readonly string[]).indexOf(e.key)
  if (f >= 0) return { type: 'memory', index: f }
  if (e.key === 'PageUp') return { type: 'speed', delta: 2 }
  if (e.key === 'PageDown') return { type: 'speed', delta: -2 }
  return undefined
}

/** Alt+M: the next mode in CW → SSB → FM (anything else starts at CW). */
export function nextMode(mode: string): string {
  const cycle = ['CW', 'SSB', 'FM']
  return cycle[(cycle.indexOf(mode) + 1) % cycle.length]!
}
