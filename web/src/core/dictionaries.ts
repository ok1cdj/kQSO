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

/** Band edges in Hz (ADIF band table), for a radio's frequency → band. */
const BAND_EDGES: readonly (readonly [string, number, number])[] = [
  ['160m', 1_800_000, 2_000_000],
  ['80m', 3_500_000, 4_000_000],
  ['60m', 5_060_000, 5_450_000],
  ['40m', 7_000_000, 7_300_000],
  ['30m', 10_100_000, 10_150_000],
  ['20m', 14_000_000, 14_350_000],
  ['17m', 18_068_000, 18_168_000],
  ['15m', 21_000_000, 21_450_000],
  ['12m', 24_890_000, 24_990_000],
  ['10m', 28_000_000, 29_700_000],
  ['6m', 50_000_000, 54_000_000],
  ['4m', 70_000_000, 71_000_000],
  ['2m', 144_000_000, 148_000_000],
  ['70cm', 420_000_000, 450_000_000],
  ['23cm', 1_240_000_000, 1_300_000_000],
  ['13cm', 2_300_000_000, 2_450_000_000],
  ['9cm', 3_300_000_000, 3_500_000_000],
  ['6cm', 5_650_000_000, 5_925_000_000],
  ['3cm', 10_000_000_000, 10_500_000_000],
  ['1.25cm', 24_000_000_000, 24_250_000_000],
  ['6mm', 47_000_000_000, 47_200_000_000],
  ['4mm', 75_500_000_000, 81_000_000_000],
]

/** Band for a frequency in Hz, or undefined outside the amateur bands we know. */
export function bandForFreq(hz: number): string | undefined {
  return BAND_EDGES.find(([, lo, hi]) => hz >= lo && hz <= hi)?.[0]
}

/** Where typing a band tunes a radio when it has no frequency of its own for that band
 *  yet: the usual CW / SSB / FM spot (Hz), or undefined (not an HF–UHF band, no FM there). */
const BAND_SPOTS: Readonly<Record<string, Partial<Record<string, number>>>> = {
  '160m': { CW: 1_830_000, SSB: 1_843_000 },
  '80m': { CW: 3_530_000, SSB: 3_700_000 },
  '60m': { CW: 5_352_000, SSB: 5_360_000 },
  '40m': { CW: 7_020_000, SSB: 7_100_000 },
  '30m': { CW: 10_115_000 },
  '20m': { CW: 14_030_000, SSB: 14_200_000 },
  '17m': { CW: 18_080_000, SSB: 18_130_000 },
  '15m': { CW: 21_030_000, SSB: 21_250_000 },
  '12m': { CW: 24_900_000, SSB: 24_950_000 },
  '10m': { CW: 28_030_000, SSB: 28_500_000, FM: 29_600_000 },
  '6m': { CW: 50_090_000, SSB: 50_150_000, FM: 51_510_000 },
  '4m': { CW: 70_050_000, SSB: 70_200_000, FM: 70_450_000 },
  '2m': { CW: 144_050_000, SSB: 144_300_000, FM: 145_500_000 },
  '70cm': { CW: 432_050_000, SSB: 432_200_000, FM: 433_500_000 },
}

export function bandSpot(band: string, mode: string): number | undefined {
  return BAND_SPOTS[band]?.[mode]
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
