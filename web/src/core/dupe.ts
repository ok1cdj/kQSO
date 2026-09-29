// DUPE detection: a QSO with the same call + band + mode already exists
// in the CURRENT log. VHF contest: call + band only (IARU R1: each station once per
// band) — pass no mode. Pure; the UI decides how to warn (invert the input line).

import type { Qso } from './model'

export function isDupe(
  qsos: readonly Qso[],
  call: string,
  band: string,
  mode?: string, // undefined = any mode (VHF contest)
): boolean {
  const c = call.toUpperCase()
  return qsos.some((q) => q.call.toUpperCase() === c && q.signal.band === band && (mode === undefined || q.signal.mode === mode))
}
