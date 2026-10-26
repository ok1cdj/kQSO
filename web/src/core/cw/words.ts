// CW decoder: what a decoded word is worth to the log line. The panel highlights calls,
// reports / serials and locators and inserts them on a tap; everything else (CQ, TU, DE,
// TEST…) is plain text. CW exchanges use cut numbers (5NN = 599, T = 0, N = 9…), which
// are turned back into digits so the log line parser sees a normal number.

import { isFullLocator } from '../classify'

export type CwWordKind = 'call' | 'number' | 'locator' | 'other'

export interface CwWord {
  kind: CwWordKind
  /** What goes into the log line (cut numbers already turned into digits). */
  value: string
}

// Same shape as the log line's callsign rule (classify.ts): letters after the digits,
// so 5NN or 73 don't qualify.
const CALL = /^([A-Z0-9]+\/)?[A-Z0-9]{1,3}\d{1,4}[A-Z]{1,4}(\/[A-Z0-9]+)?$/
// Cut numbers in common use. O stands for 0 too; E for 5 only in the report (5NN / ENN).
const CUT: Record<string, string> = { T: '0', O: '0', A: '1', E: '5', N: '9' }
const CUT_NUMBER = /^[0-9TOAEN]+$/
const SQUARE = /^[A-R]{2}\d{2}$/
// Sign-offs, not an exchange.
const GREETINGS = new Set(['73', '88'])

/** Cut-number word → digits, or undefined when it's an ordinary word. Needs a real digit
 *  or the report's NN, so plain words (TO, ON, TEN) stay words. */
export function cutToDigits(word: string): string | undefined {
  if (!CUT_NUMBER.test(word)) return undefined
  if (!/\d/.test(word) && !/NN/.test(word)) return undefined
  return word.replace(/[TOAEN]/g, (c) => CUT[c]!)
}

export function cwWord(raw: string): CwWord {
  const word = raw.toUpperCase()
  // A locator first: JO70FD is call-shaped too. HF uses the 4-character square (JO70).
  if (isFullLocator(word) || SQUARE.test(word)) return { kind: 'locator', value: word }
  if (CALL.test(word)) return { kind: 'call', value: word }
  if (GREETINGS.has(word)) return { kind: 'other', value: word }
  const digits = cutToDigits(word)
  if (digits !== undefined) return { kind: 'number', value: digits }
  return { kind: 'other', value: word }
}

/** Decoded text → words with their meaning, in order. */
export function cwWords(text: string): CwWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(cwWord)
}
