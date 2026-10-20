// Which band a multi-band log shows in the QSO list and the map (no DOM — tested):
// first the band of the last QSO (the one being worked), then the session's choice,
// kept per log — the list and the map of a log show the same band.

import { BANDS } from '../core/index'
import type { Qso } from '../core/index'

/** "All bands" in the filter. */
export const ALL_BANDS = ''

const chosen = new Map<string, string>() // logId → band or ALL_BANDS, this session only

/** The log's bands in band-plan order (160m … 4mm). */
export function logBands(qsos: readonly Qso[]): string[] {
  const present = new Set(qsos.map((q) => q.signal.band))
  return [...present].sort((a, b) => order(a) - order(b))
}

const order = (band: string): number => {
  const i = BANDS.indexOf(band)
  return i < 0 ? BANDS.length : i
}

/** The band to show: the session's choice, else the last QSO's; all for a one-band log. */
export function shownBand(logId: string, qsos: readonly Qso[]): string {
  const bands = logBands(qsos)
  if (bands.length < 2) return ALL_BANDS
  const c = chosen.get(logId)
  if (c !== undefined && (c === ALL_BANDS || bands.includes(c))) return c
  return qsos[qsos.length - 1]!.signal.band
}

/** Remember the band picked for a log, for the rest of the session. */
export function chooseBand(logId: string, band: string): void {
  chosen.set(logId, band)
}
