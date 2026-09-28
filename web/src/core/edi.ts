// EDI export (IARU R1 REG1TEST;1, issue 1.1) for VHF contests — one file per band,
// as the contest rules require. 7-bit ASCII, CRLF, lines ≤ 75 characters. The ADIF
// log stays the single source of truth; this is a derived export.

import type { EdiContest, LogMeta, Qso } from './model'
import { scoreLog } from './contest'
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

// PBand values from the REG1TEST band table, keyed by our band dictionary.
const PBAND: Readonly<Record<string, string>> = {
  '6m': '50 MHz',
  '4m': '70 MHz',
  '2m': '144 MHz',
  '70cm': '432 MHz',
  '23cm': '1,3 GHz',
  '13cm': '2,3 GHz',
  '9cm': '3,4 GHz',
  '6cm': '5,7 GHz',
  '3cm': '10 GHz',
  '1.25cm': '24 GHz',
  '6mm': '47 GHz',
  '4mm': '76 GHz',
}

/** The EDI band label for a band key, or undefined when the band is not an EDI band. */
export function ediBand(band: string): string | undefined {
  return PBAND[band]
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

/** Per-band score of a log, for the export screen (only bands EDI knows). */
export function ediBands(qsos: readonly Qso[], myGrid: string): BandScore[] {
  return scoreLog(qsos, myGrid).filter((b) => ediBand(b.band) !== undefined)
}

/** REG1TEST text for one band of a log. */
export function writeEdi(
  meta: LogMeta,
  qsos: readonly Qso[],
  band: string,
  contest: EdiContest,
  station: EdiStation,
  eq: EdiEquipment,
): string {
  const score = scoreLog(qsos, meta.myGrid).find((b) => b.band === band)
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
    free('PSect', contest.section.toUpperCase()),
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
    `CWWLs=${score?.wwls ?? 0};0;1`,
    'CWWLB=0',
    'CExcs=0;0;1',
    'CExcB=0',
    'CDXCs=0;0;1',
    'CDXCB=0',
    `CToSc=${score?.points ?? 0}`,
    odx ? `CODXC=${odx.call.toUpperCase()};${odx.grid.toUpperCase()};${odx.km}` : 'CODXC=',
    '[Remarks]',
    `[QSORecords;${rows.length}]`,
    ...rows.map((r) => record(r.qso, r.points, r.newWwl, r.dupe)),
  ]
  return lines.join('\r\n') + '\r\n'
}
