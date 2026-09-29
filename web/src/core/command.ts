// Line commands: a single letter alone on the line, confirmed with Enter.
// Band/mode are bare words too, but they are values mixed into a line; a command is
// an action, so it only counts when it is the WHOLE line (OK1ABC W stays a token).
// A lone letter has no digit, so it can never be a callsign.

import type { PartialQso } from './model'

export type LineCommand =
  | 'wipe' // W — discard the unfinished QSO
  | 'deleteLast' // D — delete the last saved QSO

const COMMANDS: Readonly<Record<string, LineCommand>> = { W: 'wipe', D: 'deleteLast' }

/** The command a line stands for, or undefined when it is ordinary input. */
export function matchCommand(line: string): LineCommand | undefined {
  return COMMANDS[line.trim().toUpperCase()]
}

/** True when the accumulator holds anything typed — not just the first-keystroke time. */
export function hasContent(p: PartialQso): boolean {
  return Object.entries(p).some(([k, v]) => k !== 'timeOn' && v !== undefined)
}
