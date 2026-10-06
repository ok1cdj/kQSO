// Sticky-state seed and threading helpers. All pure; nothing mutated.

import type { LogMeta, Qso, StickyState } from './model'
import type { Satellite } from './satellites'

/** Seed sticky band/mode: from the last QSO when the log has one (reopening a log
 *  carries on where it stopped), else from the log header's default signal. */
export function initialSticky(meta: LogMeta, last?: Qso): StickyState {
  const s = last?.signal ?? meta.defaultSignal
  const out: { -readonly [K in keyof StickyState]: StickyState[K] } = {
    band: s.band,
    mode: s.mode,
  }
  if (s.bandRx !== undefined) out.bandRx = s.bandRx
  if (s.modeRx !== undefined) out.modeRx = s.modeRx
  return out
}

export function applyBand(s: StickyState, band: string): StickyState {
  // Another band → a satellite's uplink frequency no longer applies.
  if (band === s.band) return s
  const { freq: _drop, ...rest } = s
  return { ...rest, band }
}

export function applyMode(s: StickyState, mode: string): StickyState {
  return { ...s, mode }
}

/** Select a satellite: sets uplink/downlink band, mode and SAT_NAME/SAT_MODE (F3). */
export function applySatellite(s: StickyState, sat: Satellite, mode: string): StickyState {
  return {
    ...s,
    band: sat.up, // BAND = uplink
    bandRx: sat.down, // BAND_RX = downlink
    mode: sat.fm ? 'FM' : mode,
    satName: sat.name,
    satMode: sat.satMode,
    freq: sat.upMHz, // FREQ = uplink centre
    freqRx: sat.downMHz, // FREQ_RX = downlink centre
  }
}
