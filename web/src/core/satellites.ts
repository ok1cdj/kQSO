// Active amateur satellites (F3). Picking one sets the QSO's uplink/downlink band,
// mode and SAT_NAME automatically. `band` (BAND) = uplink/TX, `down` (BAND_RX) =
// downlink/RX. A satellite with two modes (AO-7 A/B) is two rows with the same
// `name` (SAT_NAME) but distinct `label` and `satMode`.

import type { Qso, Signal } from './model'

export interface Satellite {
  readonly label: string // dropdown text, e.g. "AO-7 A"
  readonly name: string // ADIF SAT_NAME, e.g. "AO-7"
  readonly satMode: string // ADIF SAT_MODE, e.g. "V/U"
  readonly up: string // uplink band → ADIF BAND (canonical dict key)
  readonly down: string // downlink band → ADIF BAND_RX
  readonly fm: boolean // FM repeater (MODE fixed FM) vs linear (SSB default, CW selectable)
  // Transponder centre (linear) or repeater channel (FM), MHz → ADIF FREQ / FREQ_RX.
  // Logbooks (Wavelog, LoTW) want the frequencies, not just the bands; the exact dial
  // frequency of a linear QSO is not known, the centre is the usual stand-in.
  readonly upMHz: string
  readonly downMHz: string
}

export const SATELLITES: readonly Satellite[] = [
  { label: 'RS-44', name: 'RS-44', satMode: 'V/U', up: '2m', down: '70cm', fm: false, upMHz: '145.965', downMHz: '435.640' },
  { label: 'FO-29', name: 'FO-29', satMode: 'V/U', up: '2m', down: '70cm', fm: false, upMHz: '145.950', downMHz: '435.850' },
  { label: 'AO-7 A', name: 'AO-7', satMode: 'A', up: '2m', down: '10m', fm: false, upMHz: '145.900', downMHz: '29.450' },
  { label: 'AO-7 B', name: 'AO-7', satMode: 'B', up: '70cm', down: '2m', fm: false, upMHz: '432.150', downMHz: '145.950' },
  { label: 'AO-73', name: 'AO-73', satMode: 'U/V', up: '70cm', down: '2m', fm: false, upMHz: '435.140', downMHz: '145.960' },
  { label: 'SO-50', name: 'SO-50', satMode: 'V/U', up: '2m', down: '70cm', fm: true, upMHz: '145.850', downMHz: '436.795' },
  { label: 'JO-97', name: 'JO-97', satMode: 'U/V', up: '70cm', down: '2m', fm: false, upMHz: '435.110', downMHz: '145.865' },
  { label: 'ISS', name: 'ISS', satMode: 'V/U', up: '2m', down: '70cm', fm: true, upMHz: '145.990', downMHz: '437.800' },
  { label: 'QO-100', name: 'QO-100', satMode: 'S/X', up: '13cm', down: '3cm', fm: false, upMHz: '2400.175', downMHz: '10489.675' },
  { label: 'AO-123', name: 'AO-123', satMode: 'V/U', up: '2m', down: '70cm', fm: true, upMHz: '145.850', downMHz: '435.400' },
]

/** Look up a satellite by its dropdown label. */
export function satelliteByLabel(label: string): Satellite | undefined {
  return SATELLITES.find((s) => s.label === label)
}

/**
 * The Signal for a satellite. Mode is forced FM for FM birds; for linear birds the
 * caller passes the current mode (default SSB, or CW). Satellites use one MODE, so
 * `modeRx` is left unset.
 */
export function satelliteSignal(sat: Satellite, mode: string): Signal {
  return { band: sat.up, bandRx: sat.down, mode: sat.fm ? 'FM' : mode }
}

/**
 * QSOs logged before FREQ / FREQ_RX were stored: fill them from the satellite table
 * (SAT_NAME + SAT_MODE, and only when the bands still match the satellite's).
 * Returns undefined when nothing changed, so the caller can skip the rewrite.
 */
export function fillSatFrequencies(qsos: readonly Qso[]): Qso[] | undefined {
  let changed = false
  const out = qsos.map((q) => {
    if (q.satName === undefined || (q.signal.freq !== undefined && q.signal.freqRx !== undefined)) return q
    const sat = SATELLITES.find((s) => s.name === q.satName && s.satMode === q.satMode)
    if (!sat || q.signal.band !== sat.up || q.signal.bandRx !== sat.down) return q
    changed = true
    return { ...q, signal: { ...q.signal, freq: q.signal.freq ?? sat.upMHz, freqRx: q.signal.freqRx ?? sat.downMHz } }
  })
  return changed ? out : undefined
}
