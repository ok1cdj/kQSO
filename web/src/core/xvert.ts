// Which bands the IC-705 itself works, and transverters for the others: the radio
// tunes the IF, the log gets the real (RF) frequency. Pure; the settings UI stores the
// table, ui/rig.ts applies it.

import { BANDS, bandForFreq } from './dictionaries'

/** Bands the IC-705 transmits on (1.8–50 MHz, 144, 430; 4 m only receives). */
const RADIO_BANDS: ReadonlySet<string> = new Set(['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'])

export function radioBand(band: string): boolean {
  return RADIO_BANDS.has(band)
}

/** Bands a transverter can be set for: all the radio doesn't do itself. */
export const XVERT_BANDS: readonly string[] = BANDS.filter((b) => !RADIO_BANDS.has(b))

/** One transverter: `rfHz` on the band is `ifHz` on the radio (e.g. 3 cm 10368.000 = 145.000).
 *  Used only when `on` — each one is switched on by itself, so a filled-in row for a
 *  transverter you don't have never retunes the radio. */
export interface Xvert {
  readonly band: string
  readonly rfHz: number
  readonly ifHz: number
  readonly on: boolean
}

const MHz = (n: number): number => Math.round(n * 1e6)

/** Until the table is edited: the usual narrowband RF frequencies on a 145.000 IF
 *  (4 m: 70.000 on 28.000). */
export const DEFAULT_XVERTS: readonly Xvert[] = [
  { band: '4m', rfHz: MHz(70), ifHz: MHz(28), on: false },
  ...(
    [
      ['23cm', 1296],
      ['13cm', 2320],
      ['9cm', 3400],
      ['6cm', 5760],
      ['3cm', 10368],
      ['1.25cm', 24048],
      ['6mm', 47088],
      ['4mm', 76032],
    ] as const
  ).map(([band, rf]) => ({ band, rfHz: MHz(rf), ifHz: MHz(145), on: false })),
]

/** "10368.000" / "10368,000" MHz → Hz; undefined when not a number. */
export function parseMHz(text: string): number | undefined {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined
  return Math.round(Number(t) * 1e6)
}

/** Stored table (JSON) → valid transverters: RF on its band, IF on a radio band. Never
 *  saved yet → DEFAULT_XVERTS. */
export function parseXverts(json: string | null): Xvert[] {
  if (json === null) return [...DEFAULT_XVERTS]
  let raw: unknown
  try {
    raw = JSON.parse(json ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .map((x: unknown) => (typeof x === 'object' && x !== null ? { ...(x as Xvert), on: (x as Xvert).on === true } : x))
    .filter(
    (x): x is Xvert =>
      typeof x === 'object' &&
      x !== null &&
      typeof (x as Xvert).band === 'string' &&
      typeof (x as Xvert).rfHz === 'number' &&
      typeof (x as Xvert).ifHz === 'number' &&
      bandForFreq((x as Xvert).rfHz) === (x as Xvert).band &&
      radioBand(bandForFreq((x as Xvert).ifHz) ?? ''),
  )
}

export const toIf = (x: Xvert, rfHz: number): number => x.ifHz + (rfHz - x.rfHz)
export const toRf = (x: Xvert, ifHz: number): number => x.rfHz + (ifHz - x.ifHz)

/** The radio band a transverter's IF sits on (2m for 145.000). */
export const ifBand = (x: Xvert): string | undefined => bandForFreq(x.ifHz)
