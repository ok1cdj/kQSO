// Closed dictionaries for band and mode. Being closed sets is what
// lets `20M`/`2M` win as bands over the callsign regex.

/** Amateur bands recognized as sticky tokens, canonical lowercase form. */
export const BANDS: readonly string[] = [
  '160m',
  '80m',
  '60m',
  '40m',
  '30m',
  '20m',
  '17m',
  '15m',
  '12m',
  '10m',
  '6m',
  '4m',
  '2m',
  '70cm',
  '23cm',
  '13cm', // also the QO-100 uplink (2.4 GHz)
  '9cm',
  '6cm',
  '3cm', // also the QO-100 downlink (10 GHz)
  '1.25cm', // ADIF name for 24 GHz; typed as 24G (no dot on the keyboard)
  '6mm',
  '4mm',
]

/** Microwave bands can also be typed in GHz (24G → 1.25cm); the canonical ADIF name is stored. */
const BAND_ALIASES: Readonly<Record<string, string>> = {
  '1g': '23cm',
  '2g': '13cm',
  '3g': '9cm',
  '5g': '6cm',
  '10g': '3cm',
  '24g': '1.25cm',
  '47g': '6mm',
  '76g': '4mm',
}

/** Modes recognized as sticky tokens, canonical uppercase form. */
export const MODES: readonly string[] = ['CW', 'SSB', 'FM']

const BAND_SET = new Set(BANDS)
const MODE_SET = new Set(MODES)

/**
 * Return the canonical band key for a raw token, or null if it is not a band.
 * Case-insensitive; canonical form is lowercase (e.g. `20M` → `20m`, `24G` → `1.25cm`).
 */
export function matchBand(raw: string): string | null {
  const canon = raw.toLowerCase()
  return BAND_SET.has(canon) ? canon : (BAND_ALIASES[canon] ?? null)
}

/**
 * Return the canonical mode key for a raw token, or null if it is not a mode.
 * Case-insensitive; canonical form is uppercase (e.g. `cw` → `CW`).
 */
export function matchMode(raw: string): string | null {
  const canon = raw.toUpperCase()
  return MODE_SET.has(canon) ? canon : null
}
