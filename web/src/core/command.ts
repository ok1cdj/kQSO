// Line commands: a single letter alone on the line, confirmed with Enter.
// Band/mode are bare words too, but they are values mixed into a line; a command is
// an action, so it only counts when it is the WHOLE line (OK1ABC W stays a token).
// A lone letter has no digit, so it can never be a callsign.

import type { PartialQso } from './model'
import { WPM_MAX, WPM_MIN } from './keyer'

export type LineCommand =
  | 'wipe' // W — discard the unfinished QSO
  | 'deleteLast' // D — delete the last saved QSO
  | 'help' // H — open the help

const COMMANDS: Readonly<Record<string, LineCommand>> = { W: 'wipe', D: 'deleteLast', H: 'help' }

/** The command a line stands for, or undefined when it is ordinary input. */
export function matchCommand(line: string): LineCommand | undefined {
  return COMMANDS[line.trim().toUpperCase()]
}

/** True when the accumulator holds anything typed — not just the first-keystroke time. */
export function hasContent(p: PartialQso): boolean {
  return Object.entries(p).some(([k, v]) => k !== 'timeOn' && v !== undefined)
}

/** F<kHz> — tune the radio there (F28300 = 28.300 MHz, F10368100 = 10368.100 MHz on a
 *  transverter). The keyboard has no dot, so kHz. Returns Hz. A callsign never has only
 *  digits after F. */
export function matchTuneCommand(line: string): number | undefined {
  const m = /^F(\d{3,8})$/.exec(line.trim().toUpperCase())
  return m ? Number(m[1]) * 1000 : undefined
}

/** Keyer line commands (only while CW keying is on — otherwise R / S stay a name):
 *  R = RUN, S = S&P, S<n> = speed n WPM until disconnect, C = connect the keyer again,
 *  K = keyboard mode (typed words go out as CW), K <text> = send that text once,
 *  E = ESM on / off. `inRange` is false for
 *  S4 / S51 so the preview can say why nothing will be sent. */
export type KeyerCommand =
  | { readonly type: 'run' }
  | { readonly type: 'sp' }
  | { readonly type: 'connect' }
  | { readonly type: 'keyboard' }
  | { readonly type: 'esm' }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'speed'; readonly wpm: number; readonly inRange: boolean }

export function matchKeyerCommand(line: string): KeyerCommand | undefined {
  const l = line.trim().toUpperCase()
  if (l === 'R') return { type: 'run' }
  if (l === 'S') return { type: 'sp' }
  if (l === 'C') return { type: 'connect' }
  if (l === 'K') return { type: 'keyboard' }
  if (l === 'E') return { type: 'esm' }
  const text = /^K\s+(.+)$/.exec(l)
  if (text) return { type: 'text', text: text[1]! }
  const m = /^S(\d{1,2})$/.exec(l)
  if (m) {
    const wpm = Number(m[1])
    return { type: 'speed', wpm, inRange: wpm >= WPM_MIN && wpm <= WPM_MAX }
  }
  return undefined
}
