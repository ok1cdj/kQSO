// EDI export (IARU R1 REG1TEST;1, issue 1.1) for VHF contests — one file per band,
// as the contest rules require. 7-bit ASCII, CRLF, lines ≤ 75 characters. The ADIF
// log stays the single source of truth; this is a derived export.

import type { ContestCategory, ContestKind, EdiContest, LogMeta, Qso } from './model'
import { scoreLog, scoringFor } from './contest'
import type { BandScore } from './contest'

/** Station fields of the EDI header that are the same on every band, kept in Settings. */
export interface EdiStation {
  readonly name: string // RName
  readonly email: string // RHBBS (the IARU rules require an e-mail address here)
}

/** Per-band equipment of the EDI header — each band has its own, kept in Settings. */
export interface EdiEquipment {
  readonly power: string // SPowe, watts
  readonly antenna: string // SAnte
  readonly antennaHeight: string // SAntH, "above ground;above sea level" in m
  readonly tx: string // STXEq (optional)
  readonly rx: string // SRXEq (optional)
}

/** What the EDI export remembers for the next contest (Settings key ediStation, JSON). */
export interface EdiSettings {
  readonly station: EdiStation
  readonly bands: Readonly<Record<string, EdiEquipment>> // by our band key (2m, 70cm…)
  readonly fallback?: EdiEquipment // a single set saved by kQSO ≤ 1.3 — prefills every band
}

export const EMPTY_EQUIPMENT: EdiEquipment = { power: '', antenna: '', antennaHeight: '', tx: '', rx: '' }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function equipment(v: unknown): EdiEquipment {
  const o = (v ?? {}) as Record<string, unknown>
  return { power: str(o.power), antenna: str(o.antenna), antennaHeight: str(o.antennaHeight), tx: str(o.tx), rx: str(o.rx) }
}

/**
 * Read the remembered EDI fields. Tolerant: bad JSON or missing fields give empty
 * values. The old flat format ({name, email, power, antenna, tx}) becomes the station
 * + a fallback equipment, so nothing typed before is lost.
 */
export function parseEdiSettings(text: string | null): EdiSettings {
  let o: Record<string, unknown> = {}
  try {
    const v: unknown = JSON.parse(text ?? '{}')
    if (v && typeof v === 'object') o = v as Record<string, unknown>
  } catch {
    // keep empty
  }
  const bands: Record<string, EdiEquipment> = {}
  if (o.bands && typeof o.bands === 'object') {
    for (const [band, eq] of Object.entries(o.bands as Record<string, unknown>)) bands[band] = equipment(eq)
  }
  const legacy = equipment(o)
  const hasLegacy = Object.values(legacy).some((x) => x !== '')
  const out: EdiSettings = { station: { name: str(o.name), email: str(o.email) }, bands }
  return hasLegacy ? { ...out, fallback: legacy } : out
}

/** JSON for the setting. An old single set stays as the flat fields, so a band that
 *  has never been exported still gets it prefilled. */
export function serializeEdiSettings(s: EdiSettings): string {
  return JSON.stringify({ name: s.station.name, email: s.station.email, bands: s.bands, ...(s.fallback ?? {}) })
}

/** Equipment to prefill for a band: its own, else the old single set, else empty. */
export function equipmentFor(s: EdiSettings, band: string): EdiEquipment {
  return s.bands[band] ?? s.fallback ?? EMPTY_EQUIPMENT
}

// PBand values as the ČRK general rules (point 6) name the bands — point 20 allows only
// these — keyed by our band dictionary.
const PBAND: Readonly<Record<string, string>> = {
  '6m': '50 MHz',
  '4m': '70 MHz',
  '2m': '145 MHz',
  '70cm': '435 MHz',
  '23cm': '1.3 GHz',
  '13cm': '2.4 GHz',
  '9cm': '3.4 GHz',
  '6cm': '5.7 GHz',
  '3cm': '10 GHz',
  '1.25cm': '24 GHz',
  '6mm': '47 GHz',
  '4mm': '76 GHz',
}

/** The EDI band label for a band key, or undefined when the band is not an EDI band. */
export function ediBand(band: string): string | undefined {
  return PBAND[band]
}

/** Bands with the LP and 6-hour categories (IARU R1, ČRK): 145 and 435 MHz. */
export const LP_6H_BANDS: readonly string[] = ['2m', '70cm']

/** LP: at most 100 W PEP (IARU R1, ČRK point 5); QRP (≤ 5 W) the evaluator sorts by SPowe. */
export const LP_MAX_W = 100

/** Watts from the power field ("100", "100 W"); undefined when empty / not a number. */
export function powerWatts(power: string): number | undefined {
  const m = /^\s*(\d+)\s*(W)?\s*$/i.exec(power)
  return m ? Number(m[1]) : undefined
}

/**
 * PSect for one band. CHECK everywhere. In an IARU R1 contest 145/435 MHz take "6H SO" /
 * "6H MO" (the ČRK form; the robot makes it 6H for IARU), or SO-LP / MO-LP when the power
 * is at most 100 W (LP is declared, QRP follows SPowe); 50/70 MHz the plain 6H; other
 * bands know only SO / MO. VKV PA and FM pohár: SO / MO, the power class from SPowe.
 */
export function ediSection(c: ContestCategory, band: string, power = ''): string {
  if (c.ops === 'CHECK') return 'CHECK'
  if (c.contest !== 'iaru') return c.ops
  if (LP_6H_BANDS.includes(band)) {
    if (c.variant === '6h') return `6H ${c.ops}`
    const w = powerWatts(power)
    return w !== undefined && w <= LP_MAX_W ? `${c.ops}-LP` : c.ops
  }
  if ((band === '6m' || band === '4m') && c.variant === '6h') return '6H'
  return c.ops
}

/** Whether the band's entry is a 6-hour one (the 6-hour window applies to its QSOs). */
export function isSixHours(c: ContestCategory | undefined, band: string): boolean {
  return c !== undefined && c.ops !== 'CHECK' && c.contest === 'iaru' && c.variant === '6h' && ediSection(c, band).startsWith('6H')
}

// ČRK file number (rules point 19): [SO, MO] per band; 6 hours on 145 / 435 MHz.
const FILE_NO: Readonly<Record<string, readonly [string, string]>> = {
  '2m': ['01', '02'],
  '70cm': ['03', '04'],
  '23cm': ['05', '06'],
  '13cm': ['07', '08'],
  '9cm': ['09', '10'],
  '6cm': ['11', '12'],
  '3cm': ['13', '14'],
  '1.25cm': ['15', '16'],
  '6mm': ['17', '18'],
  '4mm': ['19', '20'],
  '6m': ['50', '51'],
}
const FILE_NO_6H: Readonly<Record<string, readonly [string, string]>> = { '2m': ['61', '62'], '70cm': ['63', '64'] }

/** ČRK file name: number for category + band, then the licensed call (no /P), e.g.
 *  01OK1XXX.edi. Without a number (CHECK, 70 MHz, 6H on 50 MHz): OK1XXX-4m.edi. */
export function ediFileName(c: ContestCategory, band: string, myCall: string): string {
  const call = baseCall(myCall)
  const sixH = isSixHours(c, band)
  const no = c.ops === 'CHECK' ? undefined : (sixH ? FILE_NO_6H : FILE_NO)[band]?.[c.ops === 'MO' ? 1 : 0]
  if (!no) return `${call}-${band}${c.ops === 'CHECK' ? '-CHECK' : ''}.edi`
  return `${no}${call}.edi`
}

/** Category of a log exported before kQSO had categories, from its stored PSect. */
export function categoryFromSection(section: string): ContestCategory {
  const s = section.toUpperCase()
  const ops = s.includes('CHECK') ? 'CHECK' : s.includes('MO') ? 'MO' : 'SO'
  return { ops, contest: 'iaru', variant: s.includes('6H') ? '6h' : 'full' }
}

/** The contest a date (UTC) most likely is, to prefill New log: VKV Provozní aktiv on the
 *  third Sunday (08–11 UTC), FM pohár on the second Saturday, IARU R1 otherwise. */
export function contestForDate(d: Date): ContestKind {
  const day = d.getUTCDate()
  const dow = d.getUTCDay()
  if (dow === 0 && day >= 15 && day <= 21) return 'pa'
  if (dow === 6 && day >= 8 && day <= 14) return 'fm'
  return 'iaru'
}

const MODE_CODE: Readonly<Record<string, string>> = { SSB: '1', CW: '2', FM: '6' }

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
const ymd = (d: Date): string => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`

/** Free-format text → printable 7-bit ASCII (diacritics dropped, rest replaced). */
export function ediAscii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .trim()
}

/** Serials are zero-padded to 3 (REG1TEST: 3 or 4 characters). */
const serial = (s: string | undefined): string => (s && /^\d+$/.test(s) ? s.padStart(3, '0').slice(-4) : '')

/** The responsible operator's call: the home call without portable prefix/suffix. */
function baseCall(call: string): string {
  const parts = call.toUpperCase().split('/').filter((p) => /\d/.test(p) && /[A-Z]/.test(p))
  return parts.sort((a, b) => b.length - a.length)[0] ?? call.toUpperCase()
}

function record(q: Qso, points: number, newWwl: boolean, dupe: boolean): string {
  const d = q.timeOn
  return [
    ymd(d).slice(2),
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`,
    q.call.toUpperCase().slice(0, 14),
    MODE_CODE[q.signal.mode] ?? '0',
    q.report.sent,
    serial(q.sentSerial),
    q.report.rcvd,
    serial(q.serial),
    '', // received exchange — not used
    q.grid?.toUpperCase() ?? '',
    String(points),
    '', // new exchange
    newWwl ? 'N' : '',
    '', // new DXCC — not claimed
    dupe ? 'D' : '',
  ].join(';')
}

/** Per-band score of a log under its contest's scoring, for the export screen (only
 *  bands EDI knows). */
export function ediBands(qsos: readonly Qso[], myGrid: string, category?: ContestCategory): BandScore[] {
  return scoreLog(qsos, myGrid, scoringFor(category)).filter((b) => ediBand(b.band) !== undefined)
}

/** REG1TEST text for one band of a log. */
export function writeEdi(
  meta: LogMeta,
  qsos: readonly Qso[],
  band: string,
  contest: EdiContest,
  category: ContestCategory,
  station: EdiStation,
  eq: EdiEquipment,
): string {
  const score = scoreLog(qsos, meta.myGrid, scoringFor(category)).find((b) => b.band === band)
  const rows = score?.rows ?? []
  const dates = rows.map((r) => ymd(r.qso.timeOn)).sort()
  const odx = score?.odx
  const free = (key: string, value: string): string => `${key}=${ediAscii(value)}`.slice(0, 75)
  const lines = [
    '[REG1TEST;1]',
    free('TName', contest.contest),
    `TDate=${dates[0] ?? ''};${dates[dates.length - 1] ?? ''}`,
    `PCall=${meta.myCall.toUpperCase()}`,
    `PWWLo=${meta.myGrid.toUpperCase()}`,
    'PExch=',
    'PAdr1=',
    'PAdr2=',
    `PSect=${ediSection(category, band, eq.power)}`,
    `PBand=${ediBand(band) ?? ''}`,
    'PClub=',
    free('RName', station.name),
    `RCall=${baseCall(meta.myCall)}`,
    'RAdr1=',
    'RAdr2=',
    'RPoCo=',
    'RCity=',
    'RCoun=',
    'RPhon=',
    free('RHBBS', station.email),
    free('MOpe1', contest.operators.toUpperCase()),
    'MOpe2=',
    free('STXEq', eq.tx),
    `SPowe=${eq.power.replace(/\D/g, '')}`,
    free('SRXEq', eq.rx),
    free('SAnte', eq.antenna),
    free('SAntH', eq.antennaHeight),
    `CQSOs=${score?.qsos ?? 0};1`,
    `CQSOP=${score?.points ?? 0}`,
    `CWWLs=${score?.multipliers ?? score?.wwls ?? 0};0;1`, // Provozní aktiv: the own square counts too
    'CWWLB=0',
    'CExcs=0;0;1',
    'CExcB=0',
    'CDXCs=0;0;1',
    'CDXCB=0',
    `CToSc=${score?.total ?? 0}`,
    odx ? `CODXC=${odx.call.toUpperCase()};${odx.grid.toUpperCase()};${odx.km}` : 'CODXC=',
    '[Remarks]',
    `[QSORecords;${rows.length}]`,
    ...rows.map((r) => record(r.qso, r.points, r.newWwl, r.dupe)),
  ]
  return lines.join('\r\n') + '\r\n'
}
