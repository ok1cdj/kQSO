// Per-token classification in strict priority order, first match wins (ch. 9).
// Each rule is an isolated predicate so it can be unit-tested alone (ch. 17).

import type { ClassifiedToken, LogProfile, TokenClass } from './model'
import { matchBand, matchMode } from './dictionaries'
import { matchReference } from './reference'

/** Positional context threaded left→right across a line (ch. 9.2). */
export interface TokenContext {
  readonly isFirstToken: boolean // ch. 9 #3: time only as the first token
  readonly callSeen: boolean // ch. 9 #7/#8: number & locator only AFTER a callsign
  readonly profile: LogProfile // ch. 9 #9 name; ch. 9 #7 serial vs report
}

const TIME = /^\d{4}$/
// ch. 9 #5: optional prefix, 1–3 char + digit + 1–4 letters core, optional suffix.
const CALL = /^([A-Z0-9]+\/)?[A-Z0-9]{1,3}\d[A-Z]{1,4}(\/[A-Z0-9]+)?$/
// ch. 9 #6: the TX report is given explicitly with a T prefix (T56) because it
// rarely changes; \d{2,3} covers 59 and 599 (ch. 8). The RX report is just a
// bare number after the call (rule #7) — no prefix, faster to type.
const REPORT_SENT = /^T\d{2,3}$/
const DIGITS = /^\d+$/ // ch. 9 #7; length bound applied per profile (see below)
const LOCATOR_FULL = /^[A-R]{2}\d{2}([A-X]{2})?$/ // ch. 9 #8
const LOCATOR_SHORT = /^\d{2}[A-X]{2}$/ // ch. 9 #8 shortened form

/** A full 6-character locator (e.g. JO70FD) — what a VKV contest needs for QRB. */
export function isFullLocator(s: string): boolean {
  return /^[A-R]{2}\d{2}[A-X]{2}$/.test(s)
}

function isLocatorShaped(s: string): boolean {
  return LOCATOR_FULL.test(s) || LOCATOR_SHORT.test(s)
}

/**
 * Classify a single raw token. The order of checks is the ch. 9 priority table;
 * the first match wins.
 */
export function classifyToken(raw: string, ctx: TokenContext): TokenClass {
  // #1 band — closed dictionary beats the callsign regex (defeats 20M/2M, ch. 9.2)
  const band = matchBand(raw)
  if (band) return { type: 'band', value: band }

  // #2 mode
  const mode = matchMode(raw)
  if (mode) return { type: 'mode', value: mode }

  // #3 time — only as the first token of the line
  if (ctx.isFirstToken && TIME.test(raw)) return { type: 'time', value: raw }

  // #4 reference — token with a slash whose last part is 3–4 digits (ch. 9.1)
  const ref = matchReference(raw)
  if (ref) return { type: 'reference', value: ref }

  // #5 callsign. Once a call has been seen, a locator-shaped token (JN79US, 79US)
  // falls through to the locator rule below (ch. 9.2: locator recognized only
  // after the callsign). Any other call-shaped token is a new call that replaces
  // the earlier one — the way to fix a mistyped call (OK1ND ↵ OK1NP ↵).
  if (CALL.test(raw) && !(ctx.callSeen && isLocatorShaped(raw))) return { type: 'call', value: raw }

  // #6 explicit TX report override (T56)
  if (REPORT_SENT.test(raw)) return { type: 'reportSent', value: raw.slice(1) }

  // #7 bare number after the callsign — RX report (or, in a contest, the combined
  // report+serial like 59002, ch. 9 #7). Position defeats a stray number before
  // the call. A contest exchange is longer (report + up to 4-digit serial), so
  // VKV allows up to 7 digits; other profiles keep the spec's \d{1,4}.
  if (ctx.callSeen && DIGITS.test(raw)) {
    const max = ctx.profile.serialAfterCall ? 7 : 4
    if (raw.length <= max) return { type: 'number', value: raw }
  }

  // #8 locator — only after the callsign (defeats JN79US, ch. 9.2)
  if (ctx.callSeen && isLocatorShaped(raw)) {
    return { type: 'locator', value: raw }
  }

  // #9 name — anything left, only in the Obecný profile
  if (ctx.profile.parsesName) return { type: 'name', value: raw }

  return { type: 'unknown', raw }
}

/**
 * Classify a whole line, threading positional context forward so that #7/#8
 * see whether a callsign has already appeared (ch. 9.2). Drives the parse
 * preview (ch. 10).
 */
export function classifyLine(
  tokens: string[],
  profile: LogProfile,
  callAlreadySeen = false,
): ClassifiedToken[] {
  const out: ClassifiedToken[] = []
  let callSeen = callAlreadySeen
  tokens.forEach((raw, index) => {
    const cls = classifyToken(raw, { isFirstToken: index === 0, callSeen, profile })
    if (cls.type === 'call') callSeen = true
    out.push({ raw, cls })
  })
  return out
}
