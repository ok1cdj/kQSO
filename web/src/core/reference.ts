// Award-reference detection. Recognition is by SHAPE, not by profile.
// The user has no dash on the keyboard, so references are typed with slashes and
// the last slash is normalized to a dash.

import type { AwardReference, ReferenceKind } from './model'
import { isGmaAssociation } from './gma'

/**
 * The discriminator against a portable callsign: a reference's last `/`-part is
 * purely numeric and 3–5 characters long (US POTA parks go past US-9999).
 * Callsign suffixes are letters (`/P`) or a single digit (`/5`).
 */
const REF_LAST_PART = /^\d{3,5}$/

/**
 * Two-part kind by prefix. POTA prefixes are all 2-letter ISO codes (CZ, DE, US);
 * TOTA (lookout towers, rozhledny.eu) is the call prefix + R, 3+ characters
 * (OKR, OMR, DLR, GBR, 9MR, 4XR). WWFF ends with FF (OKFF).
 */
function twoPartKind(prefix: string): ReferenceKind {
  if (prefix.endsWith('FF')) return 'WWFF'
  if (prefix.length >= 3 && prefix.endsWith('R')) return 'TOTA'
  return 'POTA'
}

/** Three-part kind by association: GMA-only summits have their own (OL, OM0, DA). */
function summitKind(association: string): ReferenceKind {
  return isGmaAssociation(association) ? 'GMA' : 'SOTA'
}

/**
 * Classify a token as an award reference, or return null if it is not one
 * (in particular, if it is a portable callsign).
 *
 * Kind is decided by shape (SOTA/GMA three parts, told apart by the association;
 * POTA, WWFF, TOTA two, told apart by the prefix):
 *   OK/ZC/001  → SOTA (three parts)   → "OK/ZC-001"
 *   OL/LI/001  → GMA (GMA-only association) → "OL/LI-001"
 *   CZ/0001    → POTA (two parts)     → "CZ-0001"
 *   OKFF/0001  → WWFF (prefix ends FF)→ "OKFF-0001"
 *   OKR/1001   → TOTA (3+ chars, ends R) → "OKR-1001"
 */
export function matchReference(raw: string): AwardReference | null {
  if (!raw.includes('/')) return null

  const parts = raw.split('/')
  const last = parts[parts.length - 1]!
  // Gate: last part must be purely numeric, 3–4 digits. Otherwise it is a
  // callsign (OK1ABC/P, HB0/OK1MCS/P, OK1ABC/5) — not a reference.
  if (!REF_LAST_PART.test(last)) return null

  let kind: ReferenceKind
  if (parts.length === 2) {
    kind = twoPartKind(parts[0]!)
  } else if (parts.length === 3) {
    kind = summitKind(parts[0]!)
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
 * the already-canonical dash form (OK/ZC-001, CZ-0001, OKFF-0001, OKR-1001). Returns null if
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
  if (!REF_LAST_PART.test(num)) return null

  const kind: ReferenceKind = head.includes('/') ? summitKind(head.split('/')[0]!) : twoPartKind(head)
  return { kind, value: `${head}-${num}` }
}
