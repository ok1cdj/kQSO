// CW decoder: the tuning indicator. From the per-bin CW SNR (dsp.ts) it picks the signal
// the decoder should listen to: the one at the pitch if there is one, else the strongest.
// The log shows where it is against the pitch; a tap moves the decoder's pitch onto it.

import { BIN_RESOLUTION, DECODABLE_MAX_FREQ_HZ, DECODABLE_MIN_FREQ_HZ, estimateCwBinSnr } from './dsp'

/** Pure noise scores ~5 dB (estimateCwBinSnr); a keyed signal clearly above that. */
export const CW_LOCK_SNR_DB = 12
/** The narrow model hears its 3 bins (±1 bin): within this the station is tuned in. */
export const TUNED_HZ = 1.5 * BIN_RESOLUTION
/** Where to look for signals: the pitches the decoder can be set to (and the wide model hears). */
export const SEARCH_MIN_HZ = DECODABLE_MIN_FREQ_HZ
export const SEARCH_MAX_HZ = DECODABLE_MAX_FREQ_HZ

export interface CwSignal {
  hz: number
  snrDb: number
}

/** The signal to tune to in the last few seconds of audio, or undefined (no CW there).
 *  A signal at the pitch wins over a stronger one elsewhere: you are on your station. */
export function findCw(audio: Float32Array, pitchHz: number): CwSignal | undefined {
  const est = estimateCwBinSnr(audio, SEARCH_MIN_HZ, SEARCH_MAX_HZ)
  if (!est) return undefined
  let best: CwSignal | undefined
  let atPitch: CwSignal | undefined
  est.frequencies.forEach((hz, i) => {
    const snrDb = est.snrDb[i]!
    if (snrDb < CW_LOCK_SNR_DB) return
    if (!best || snrDb > best.snrDb) best = { hz, snrDb }
    if (Math.abs(hz - pitchHz) <= TUNED_HZ && (!atPitch || snrDb > atPitch.snrDb)) atPitch = { hz, snrDb }
  })
  return atPitch ?? best
}

/** -1 = the signal is below the pitch, 1 = above, 0 = tuned in. */
export function tuneDirection(signalHz: number, pitchHz: number): -1 | 0 | 1 {
  const d = signalHz - pitchHz
  return Math.abs(d) <= TUNED_HZ ? 0 : d < 0 ? -1 : 1
}
