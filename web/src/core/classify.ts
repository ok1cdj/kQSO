// Per-token classification in strict priority order, first match wins.
// Each rule is an isolated predicate so it can be unit-tested alone.

import type { ClassifiedToken, LogProfile, TokenClass } from './model'
import { matchBand, matchMode } from './dictionaries'
import { matchReference } from './reference'

/** Positional context threaded left→right across a line. */
export interface TokenContext {
  readonly isFirstToken: boolean // time only as the first token
  readonly callSeen: boolean // number & locator only AFTER a callsign (VKV: a full locator anywhere)
  readonly profile: LogProfile // name (#9); serial vs report (#7)
}

const TIME = /^\d{4}$/
// optional prefix, 1–3 char + digit + 1–4 letters core, optional suffix.
const CALL = /^([A-Z0-9]+\/)?[A-Z0-9]{1,3}\d[A-Z]{1,4}(\/[A-Z0-9]+)?$/
// the TX report is given explicitly with a T prefix (T56) because it
// rarely changes; \d{2,3} covers 59 and 599. The RX report is just a
// bare number after the call (rule #7) — no prefix, faster to type.
const REPORT_SENT = /^T\d{2,3}$/
const DIGITS = /^\d+$/ // length bound applied per profile (see below)
const LOCATOR_FULL = /^[A-R]{2}\d{2}([A-X]{2})?$/
const LOCATOR_SHORT = /^\d{2}[A-X]{2}$/ // shortened form

/** A full 6-character locator (e.g. JO70FD) — what a VKV contest needs for QRB. */
export function isFullLocator(s: string): boolean {
  return /^[A-R]{2}\d{2}[A-X]{2}$/.test(s)
}

function isLocatorShaped(s: string): boolean {
  return LOCATOR_FULL.test(s) || LOCATOR_SHORT.test(s)
}

/**
 * Classify a single raw token. The order of checks is the priority table;
 * the first match wins.
 */
export function classifyToken(raw: string, ctx: TokenContext): TokenClass {
  // #1 band — closed dictionary beats the callsign regex (defeats 20M/2M)
  const band = matchBand(raw)
  if (band) return { type: 'band', value: band }

  // #2 mode
  const mode = matchMode(raw)
  if (mode) return { type: 'mode', value: mode }

  // #3 time — only as the first token of the line
  if (ctx.isFirstToken && TIME.test(raw)) return { type: 'time', value: raw }

  // #4 reference — token with a slash whose last part is 3–4 digits
  const ref = matchReference(raw)
  if (ref) return { type: 'reference', value: ref }

  // #5 callsign. Once a call has been seen, a locator-shaped token (JN79US, 79US)
  // falls through to the locator rule below (locator recognized only
  // after the callsign). Any other call-shaped token is a new call that replaces
  // the earlier one — the way to fix a mistyped call (OK1ND ↵ OK1NP ↵).
  // VHF contest: a full locator is a locator even before the call — the locator is
  // often heard first and the call only at the end of the QSO.
  const locatorFirst = ctx.profile.requiresGrid && isFullLocator(raw)
  if (CALL.test(raw) && !(ctx.callSeen && isLocatorShaped(raw)) && !locatorFirst) return { type: 'call', value: raw }

  // #6 explicit TX report override (T56)
  if (REPORT_SENT.test(raw)) return { type: 'reportSent', value: raw.slice(1) }

  // #7 bare number after the callsign — RX report (or, in a contest, the combined
  // report+serial like 59002). Position defeats a stray number before
  // the call. A contest exchange is longer (report + up to 4-digit serial), so
  // VKV allows up to 7 digits; other profiles keep the spec's \d{1,4}.
  if (ctx.callSeen && DIGITS.test(raw)) {
    const max = ctx.profile.serialAfterCall ? 7 : 4
    if (raw.length <= max) return { type: 'number', value: raw }
  }

  // #8 locator — only after the callsign (defeats JN79US); VHF contest: a full one anywhere
  if ((ctx.callSeen && isLocatorShaped(raw)) || locatorFirst) {
    return { type: 'locator', value: raw }
  }

  // #9 name — anything left, only in the Obecný profile
  if (ctx.profile.parsesName) return { type: 'name', value: raw }

  return { type: 'unknown', raw }
}

/**
 * Classify a whole line, threading positional context forward so that #7/#8
 * see whether a callsign has already appeared. Drives the parse
 * preview.
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
