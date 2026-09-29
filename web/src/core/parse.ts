// Parse one input line: tokenize → classify → fold into (sticky, partial).
// Pure: returns new objects, mutates nothing.

import type { ClassifiedToken, LogProfile, PartialQso, StickyState } from './model'
import { tokenize } from './tokenize'
import { classifyLine } from './classify'
import { applyBand, applyMode } from './sticky'

export interface ParseResult {
  readonly tokens: ClassifiedToken[] // for the parse preview
  readonly partial: PartialQso // accumulator after applying this line
  readonly sticky: StickyState // sticky after applying band/mode from this line
}

/**
 * Fold `line` into the running `(sticky, partial)`. Band/mode update sticky
 * (carrying the RX variant untouched); other recognized tokens update the
 * partial QSO. Unknown tokens appear in `tokens` for the preview only.
 */
export function parseLine(
  line: string,
  sticky: StickyState,
  partial: PartialQso,
  profile: LogProfile,
): ParseResult {
  // Seed callSeen from the accumulator so a locator/name typed on a later line
  // is not mistaken for a callsign (piecewise entry).
  const tokens = classifyLine(tokenize(line), profile, partial.call !== undefined)

  let nextSticky = sticky
  const next: { -readonly [K in keyof PartialQso]: PartialQso[K] } = { ...partial }

  for (const { cls } of tokens) {
    switch (cls.type) {
      case 'band':
        // Satellite: bands come from the bird — ignore typed band tokens (ch. F3).
        if (!profile.fixedBand) nextSticky = applyBand(nextSticky, cls.value)
        break
      case 'mode':
        nextSticky = applyMode(nextSticky, cls.value)
        break
      case 'time':
        next.timeOverride = cls.value
        break
      case 'call':
        next.call = cls.value
        break
      case 'reference':
        next.theirRef = cls.value
        break
      case 'reportSent':
        next.reportSent = cls.value
        break
      case 'number': {
        // VKV contest exchange is report + serial, in one token (59001)
        // or two (59 001), and the serial can stand alone (001 → report defaults).
        // Disambiguation: contest serials are zero-padded (001), RST reports never
        // are (59/599). The report width is the mode's RST width.
        if (profile.serialAfterCall) {
          // A bare number is the SERIAL by default (so 123 is serial 123, not 12+3).
          // To send a report other than 59, join it with a 3-digit serial: 58123 →
          // report 58 + serial 123. A spaced report+serial (59 001) also works, and a
          // leading zero always means "this is the serial" (reports never start with 0).
          const reportLen = nextSticky.mode === 'CW' ? 3 : 2
          const prev = next.serial
          if (next.reportRcvd === undefined && prev !== undefined && prev.length === reportLen && !prev.startsWith('0')) {
            next.reportRcvd = prev // an earlier report-shaped number was the report…
            next.serial = cls.value //   …and this token is the serial
          } else if (cls.value.startsWith('0')) {
            next.serial = cls.value // 002 → serial; report stays default
          } else if (next.reportRcvd === undefined && cls.value.length === reportLen + 3) {
            next.reportRcvd = cls.value.slice(0, reportLen) // 58123 → report 58
            next.serial = cls.value.slice(reportLen) //         + serial 123
          } else {
            next.serial = cls.value // 123, 1234 → serial
          }
        } else {
          next.reportRcvd = cls.value
        }
        break
      }
      case 'locator':
        next.grid = cls.value
        break
      case 'name':
        next.name = cls.value
        break
      case 'unknown':
        break
    }
  }

  return { tokens, partial: next, sticky: nextSticky }
}
