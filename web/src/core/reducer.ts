// Two-phase Enter state machine. Core exposes the reducer; the UI owns
// the raw input string and keystroke/DOM handling and dispatches these events.

import type { ClassifiedToken, CoreState, LogMeta, Qso } from './model'
import { PROFILES } from './model'
import { initialSticky } from './sticky'
import { parseLine } from './parse'
import { buildQso } from './qso'
import { hasContent, matchCommand } from './command'

export type CoreEvent =
  | { readonly type: 'firstKeystroke'; readonly at: Date } // stamp start-of-QSO time
  | { readonly type: 'enter'; readonly line: string } // an Enter press with the current line

export interface ReduceResult {
  readonly state: CoreState
  readonly committed?: Qso // present only when this Enter committed a QSO (phase 2)
  readonly preview: ClassifiedToken[] // parse preview of the line just processed
  readonly clearInput: boolean // UI hint: empty the input line (phase 1)
  // A line command the UI must act on. 'deleteLastBlocked' = D typed while a
  // QSO is unfinished — refused so D never silently mixes with typed data.
  readonly command?: 'wipe' | 'deleteLast' | 'deleteLastBlocked' | 'help'
}

/** `last` = the log's last QSO, whose band / mode the new one starts from. */
export function initialState(meta: LogMeta, last?: Qso): CoreState {
  return { sticky: initialSticky(meta, last), partial: {}, hasStarted: false }
}

export function reduce(state: CoreState, ev: CoreEvent, meta: LogMeta): ReduceResult {
  const profile = PROFILES[meta.profile]

  if (ev.type === 'firstKeystroke') {
    // Stamp the QSO start time once, at the first keystroke after a commit.
    const partial = state.partial.timeOn ? state.partial : { ...state.partial, timeOn: ev.at }
    return { state: { ...state, partial, hasStarted: true }, preview: [], clearInput: false }
  }

  // Line commands — checked before parsing, so a lone W is never a name.
  const cmd = matchCommand(ev.line)
  if (cmd) {
    const empty: CoreState = { sticky: state.sticky, partial: {}, hasStarted: false }
    if (cmd === 'wipe') return { state: empty, command: 'wipe', preview: [], clearInput: true }
    // H opens the help; an unfinished QSO stays, the time the H stamped alone goes.
    if (cmd === 'help') return { state: hasContent(state.partial) ? state : empty, command: 'help', preview: [], clearInput: true }
    if (hasContent(state.partial)) return { state, command: 'deleteLastBlocked', preview: [], clearInput: true }
    // Drop the time the D keystroke stamped; nothing else was typed.
    return { state: empty, command: 'deleteLast', preview: [], clearInput: true }
  }

  const trimmed = ev.line.trim()

  if (trimmed.length > 0) {
    // Phase 1: parse the line and fold it into the accumulator; clear the input.
    const { tokens, partial, sticky } = parseLine(ev.line, state.sticky, state.partial, profile)
    return {
      state: { sticky, partial, hasStarted: true },
      preview: tokens,
      clearInput: true,
    }
  }

  // Empty line.
  if (state.hasStarted) {
    // Phase 2: try to commit. Requires a callsign — plus a locator in VKV.
    const committed = buildQso(state.partial, state.sticky, meta)
    if (committed) {
      return {
        state: { sticky: state.sticky, partial: {}, hasStarted: false },
        committed,
        preview: [],
        clearInput: false,
      }
    }
  }

  // Phase 3: empty line with nothing committable → ignore.
  return { state, preview: [], clearInput: false }
}
