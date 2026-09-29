// Sticky-state seed and threading helpers. All pure; nothing mutated.

import type { LogMeta, StickyState } from './model'
import type { Satellite } from './satellites'

/** Seed sticky band/mode from the log header's default signal. */
export function initialSticky(meta: LogMeta): StickyState {
  const s = meta.defaultSignal
  const out: { -readonly [K in keyof StickyState]: StickyState[K] } = {
    band: s.band,
    mode: s.mode,
  }
  if (s.bandRx !== undefined) out.bandRx = s.bandRx
  if (s.modeRx !== undefined) out.modeRx = s.modeRx
  return out
}

export function applyBand(s: StickyState, band: string): StickyState {
  return { ...s, band }
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
  }
}
