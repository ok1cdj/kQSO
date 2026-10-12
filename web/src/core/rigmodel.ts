// Icom radio definitions: which bands a radio transmits on, what it tunes, and which
// CI-V functions it has. The IC-705 over its own Bluetooth and any Icom on the keyer's
// CI-V bus (M5-ESP32-keyer tunnel) go through the same table. Pure.

import { BANDS } from './dictionaries'

export interface RigModel {
  readonly id: string
  /** Shown in Settings ("IC-7300"). */
  readonly label: string
  /** Header badge ("7300"). */
  readonly short: string
  /** Default CI-V address. */
  readonly addr: number
  /** Bands the radio transmits on. */
  readonly bands: readonly string[]
  /** Bands of optional units, used only when switched on in Settings (IC-910 23 cm). */
  readonly optional?: readonly string[]
  /** What it tunes at all (MHz): an F… frequency outside is refused before sending. */
  readonly coverage: readonly (readonly [number, number])[]
  /** CW text over CI-V (17), key speed (14 0C), TX state (1C 00). */
  readonly cwCiv?: boolean
  /** Voice TX memories T1–T8 (28 00). */
  readonly voice?: boolean
  /** Band codes of the band stacking register (1A 01 <band> 01), per model. */
  readonly bandStack?: Readonly<Record<string, number>>
  /** "CI-V Transceive" menu item on; only where the item number is known. */
  readonly transceiveOn?: readonly number[]
}

const HF = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'] as const
const HF_CODES = { '160m': 0x01, '80m': 0x02, '40m': 0x03, '30m': 0x04, '20m': 0x05, '17m': 0x06, '15m': 0x07, '12m': 0x08, '10m': 0x09 }

// Facts from the radios' CI-V reference guides. Band stack codes other than the
// IC-705's are still to be checked on the radio — a wrong one is harmless (RigController
// uses a register only when its frequency lies on the band asked for).
export const RIG_MODELS: readonly RigModel[] = [
  {
    id: 'ic705',
    label: 'IC-705',
    short: '705',
    addr: 0xa4,
    bands: [...HF, '6m', '2m', '70cm'], // 4 m only receives
    coverage: [
      [0.03, 199.999],
      [400, 470],
    ],
    cwCiv: true,
    voice: true,
    // 60 m and 4 m have no register (GENE).
    bandStack: { ...HF_CODES, '6m': 0x10, '2m': 0x13, '70cm': 0x14 },
    transceiveOn: [0x1a, 0x05, 0x01, 0x31, 0x01], // menu 0131
  },
  {
    id: 'ic706',
    label: 'IC-706',
    short: '706',
    addr: 0x48,
    bands: [...HF, '6m'],
    coverage: [[0.03, 199.999]],
  },
  {
    id: 'ic706mk2',
    label: 'IC-706MkII',
    short: '706',
    addr: 0x4e,
    bands: [...HF, '6m', '2m'],
    coverage: [[0.03, 199.999]],
  },
  {
    id: 'ic706mk2g',
    label: 'IC-706MkIIG',
    short: '706',
    addr: 0x58,
    bands: [...HF, '6m', '2m', '70cm'],
    coverage: [
      [0.03, 199.999],
      [400, 470],
    ],
  },
  {
    id: 'ic910',
    label: 'IC-910',
    short: '910',
    addr: 0x60,
    bands: ['2m', '70cm'],
    optional: ['23cm'], // UX-910
    coverage: [
      [136, 174],
      [420, 480],
      [1240, 1320],
    ],
  },
  {
    id: 'ic9700',
    label: 'IC-9700',
    short: '9700',
    addr: 0xa2,
    bands: ['2m', '70cm', '23cm'],
    coverage: [
      [136, 174],
      [420, 480],
      [1240, 1320],
    ],
    cwCiv: true,
    voice: true,
    bandStack: { '2m': 0x01, '70cm': 0x02, '23cm': 0x03 },
  },
  {
    id: 'ic7300',
    label: 'IC-7300',
    short: '7300',
    addr: 0x94,
    bands: [...HF, '6m', '4m'],
    coverage: [[0.03, 74.8]],
    cwCiv: true,
    voice: true,
    bandStack: { ...HF_CODES, '6m': 0x10, '4m': 0x11 },
  },
  {
    id: 'ic7610',
    label: 'IC-7610',
    short: '7610',
    addr: 0x98,
    bands: [...HF, '6m'],
    coverage: [[0.03, 60]],
    cwCiv: true,
    voice: true,
    bandStack: { ...HF_CODES, '6m': 0x10 },
  },
  {
    id: 'ic7100',
    label: 'IC-7100',
    short: '7100',
    addr: 0x88,
    bands: [...HF, '6m', '2m', '70cm'],
    coverage: [
      [0.03, 199.999],
      [400, 470],
    ],
    cwCiv: true,
    bandStack: { ...HF_CODES, '6m': 0x10, '2m': 0x11, '70cm': 0x12 },
  },
]

export const IC705: RigModel = RIG_MODELS[0]!

/** A radio at an address the table doesn't know: every band is tried, CW goes by wire. */
export function genericModel(addr: number | undefined): RigModel {
  const a = addr === undefined ? '' : ` ${addr.toString(16).toUpperCase().padStart(2, '0')}`
  return { id: 'generic', label: `CI-V${a}`, short: 'CIV', addr: addr ?? 0, bands: [], coverage: [] }
}

export function modelById(id: string): RigModel | undefined {
  return RIG_MODELS.find((m) => m.id === id)
}

/** The model at its default address, else a generic one. */
export function modelForAddr(addr: number | undefined): RigModel {
  return RIG_MODELS.find((m) => m.addr === addr) ?? genericModel(addr)
}

/** A generic model knows no bands: everything is worth a try. */
export const knowsBands = (m: RigModel): boolean => m.bands.length > 0

/** Bands the radio transmits on, with the optional units switched on. */
export function modelBands(m: RigModel, options: readonly string[] = []): readonly string[] {
  return [...m.bands, ...(m.optional ?? []).filter((b) => options.includes(b))]
}

/** Whether the radio works `band` (a generic model: assumed yes). */
export function rigHasBand(m: RigModel, band: string, options: readonly string[] = []): boolean {
  return !knowsBands(m) || modelBands(m, options).includes(band)
}

/** Whether the radio tunes `hz` at all (a generic model: assumed yes). */
export function rigTunes(m: RigModel, hz: number): boolean {
  return m.coverage.length === 0 || m.coverage.some(([lo, hi]) => hz >= lo * 1e6 && hz <= hi * 1e6)
}

/** Bands a transverter can be set for: 4 m and up, those the radio doesn't do itself. */
export function xvertBands(m: RigModel, options: readonly string[] = []): string[] {
  const own = knowsBands(m) ? modelBands(m, options) : []
  return BANDS.slice(BANDS.indexOf('4m')).filter((b) => !own.includes(b))
}
