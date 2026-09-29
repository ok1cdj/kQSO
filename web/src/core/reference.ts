// Award-reference detection. Recognition is by SHAPE, not by profile.
// The user has no dash on the keyboard, so references are typed with slashes and
// the last slash is normalized to a dash.

import type { AwardReference, ReferenceKind } from './model'

/**
 * The discriminator against a portable callsign: a reference's last `/`-part is
 * purely numeric and 3–4 characters long. Callsign suffixes are letters (`/P`)
 * or a single digit (`/5`).
 */
const REF_LAST_PART = /^\d{3,4}$/

/**
 * Classify a token as an award reference, or return null if it is not one
 * (in particular, if it is a portable callsign).
 *
 * Kind is decided by shape ("WWFF má sufix FF v prefixové části,
 * SOTA tři části, POTA dvě"):
 *   OK/ZC/001  → SOTA (three parts)   → "OK/ZC-001"
 *   OK/0001    → POTA (two parts)     → "OK-0001"
 *   OKFF/0001  → WWFF (prefix ends FF)→ "OKFF-0001"
 */
export function matchReference(raw: string): AwardReference | null {
  if (!raw.includes('/')) return null

  const parts = raw.split('/')
  const last = parts[parts.length - 1]!
  // Gate: last part must be purely numeric, 3–4 digits. Otherwise it is a
  // callsign (OK1ABC/P, HB0/OK1MCS/P, OK1ABC/5) — not a reference.
  if (!REF_LAST_PART.test(last)) return null

  const prefix = parts[0]!
  let kind: ReferenceKind
  if (prefix.endsWith('FF')) {
    // WWFF is two parts and would otherwise collide with POTA — check first.
    kind = 'WWFF'
  } else if (parts.length === 3) {
    kind = 'SOTA'
  } else if (parts.length === 2) {
    kind = 'POTA'
  } else {
    // Exotic shapes (GMA/HEMA) are out of scope.
    return null
  }

  // Normalize: replace only the LAST slash with a dash.
  const value = parts.slice(0, -1).join('/') + '-' + last
  return { kind, value }
}

/**
 * Lenient reference parser for the classic forms (new log, QSO edit), where a full
 * keyboard is available. Accepts BOTH the parser's slash convention (OK/ZC/001) and
 * the already-canonical dash form (OK/ZC-001, OK-0001, OKFF-0001). Returns null if
 * it is not a recognizable reference.
 */
export function parseReferenceInput(raw: string): AwardReference | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null

  const viaSlash = matchReference(s)
  if (viaSlash) return viaSlash

  const dash = s.lastIndexOf('-')
  if (dash < 1) return null
  const head = s.slice(0, dash)
  const num = s.slice(dash + 1)
  if (!/^\d{3,4}$/.test(num)) return null

  const kind: ReferenceKind = head.includes('/') ? 'SOTA' : head.endsWith('FF') ? 'WWFF' : 'POTA'
  return { kind, value: `${head}-${num}` }
}
