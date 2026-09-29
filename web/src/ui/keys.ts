// The 6×7, 40-key on-screen keyboard layout. Alphabetical, NOT QWERTY:
// on a 6-column grid muscle memory doesn't help, and the alphabet is faster to
// scan. Only slash as a special char; no long-press. Pure data — DOM-free so it
// can be unit-tested under the core tsconfig.

export type KeyAction =
  | { readonly type: 'char'; readonly value: string }
  | { readonly type: 'space' }
  | { readonly type: 'backspace' }
  | { readonly type: 'enter' }

export interface KeyDef {
  readonly label: string
  readonly action: KeyAction
  readonly wide?: boolean // spans two grid columns (Space, Enter)
}

const char = (c: string): KeyDef => ({ label: c, action: { type: 'char', value: c } })
const letters = (s: string): KeyDef[] => [...s].map(char)

export const KEY_ROWS: readonly (readonly KeyDef[])[] = [
  letters('ABCDEF'),
  letters('GHIJKL'),
  letters('MNOPQR'),
  letters('STUVWX'),
  // Backspace is double-width (used far more than space); space is single.
  [...letters('YZ'), char('/'), { label: '␣', action: { type: 'space' } }, { label: '⌫', action: { type: 'backspace' }, wide: true }],
  letters('123456'),
  [...letters('7890'), { label: '↵', action: { type: 'enter' }, wide: true }],
]

/** All keys flattened, in visual order. */
export const KEYS: readonly KeyDef[] = KEY_ROWS.flat()
