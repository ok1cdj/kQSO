// Assemble a committed Qso from the accumulator + sticky + log header.

import type { LogMeta, LogProfile, PartialQso, Qso, Signal, StickyState } from './model'
import { PROFILES, defaultReport } from './model'

/** Apply an HHMM manual time override onto a base UTC instant. */
function applyTimeOverride(base: Date, hhmm: string): Date {
  const h = Number(hhmm.slice(0, 2))
  const m = Number(hhmm.slice(2, 4))
  const d = new Date(base.getTime())
  d.setUTCHours(h, m, 0, 0)
  return d
}

/** Exchange parts the profile requires before a QSO can be saved, still missing
 *  from the accumulator. VKV contest: the received number and the locator. */
export function missingParts(partial: PartialQso, profile: LogProfile): ('NR' | 'LOC')[] {
  const missing: ('NR' | 'LOC')[] = []
  if (profile.serialAfterCall && partial.serial === undefined) missing.push('NR')
  if (profile.requiresGrid && partial.grid === undefined) missing.push('LOC')
  return missing
}

/**
 * Build a committable Qso, or null when there is no callsign or a required
 * exchange part is missing (missingParts; VKV: number + locator). Reports default from the log header; time,
 * signal and my-* come from the accumulator/sticky/meta.
 *
 * Precondition: `partial.timeOn` is set — the reducer stamps it at the first
 * keystroke. Without it there is nothing to commit.
 */
export function buildQso(partial: PartialQso, sticky: StickyState, meta: LogMeta): Qso | null {
  if (!partial.call || !partial.timeOn) return null
  // VKV contest: no number or locator → no QSO (the preview already flags NR / LOC as missing).
  if (missingParts(partial, PROFILES[meta.profile]).length > 0) return null

  const timeOn = partial.timeOverride ? applyTimeOverride(partial.timeOn, partial.timeOverride) : partial.timeOn

  const signal: Signal = { band: sticky.band, mode: sticky.mode }
  if (sticky.bandRx !== undefined) (signal as { bandRx?: string }).bandRx = sticky.bandRx
  if (sticky.modeRx !== undefined) (signal as { modeRx?: string }).modeRx = sticky.modeRx

  const qso: { -readonly [K in keyof Qso]: Qso[K] } = {
    call: partial.call,
    timeOn,
    signal,
    report: {
      sent: partial.reportSent ?? defaultReport(sticky.mode),
      rcvd: partial.reportRcvd ?? defaultReport(sticky.mode),
    },
    stationCall: meta.myCall,
    myGrid: meta.myGrid,
  }
  if (partial.grid !== undefined) qso.grid = partial.grid
  if (partial.theirRef !== undefined) qso.theirRef = partial.theirRef
  if (meta.myRef !== undefined) qso.myRef = meta.myRef
  if (partial.name !== undefined) qso.name = partial.name
  if (partial.serial !== undefined) qso.serial = partial.serial
  if (sticky.satName !== undefined) qso.satName = sticky.satName
  if (sticky.satMode !== undefined) qso.satMode = sticky.satMode

  return qso
}
