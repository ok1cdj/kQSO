// A kQSO log file is one ADIF document whose HEADER carries the log metadata via
// application-defined APP_KQSO_* fields (the .adi is the single source of
// truth). QSO records follow. Uploaders ignore APP_ header fields, so the same
// file is also the export.

import type { AwardReference, ContestCategory, LogMeta, ProfileId, Qso, Signal } from '../model'
import { formatRefList, parseRefList } from './fields'
import { writeAdif, writeField, writeQso } from './writer'
import { readAdif } from './reader'

const A = {
  NAME: 'APP_KQSO_NAME',
  PROFILE: 'APP_KQSO_PROFILE',
  MYCALL: 'APP_KQSO_MYCALL',
  MYGRID: 'APP_KQSO_MYGRID',
  MYREF: 'APP_KQSO_MYREF',
  DEFBAND: 'APP_KQSO_DEFBAND',
  DEFMODE: 'APP_KQSO_DEFMODE',
  DEFBANDRX: 'APP_KQSO_DEFBANDRX',
  DEFMODERX: 'APP_KQSO_DEFMODERX',
  SATLABEL: 'APP_KQSO_SATLABEL',
  EDI_CONTEST: 'APP_KQSO_EDI_CONTEST',
  EDI_SECTION: 'APP_KQSO_EDI_SECTION',
  EDI_OPS: 'APP_KQSO_EDI_OPS',
  CATEGORY: 'APP_KQSO_CATEGORY',
} as const

const PROFILE_IDS: readonly ProfileId[] = ['vkv', 'aktivace', 'obecny', 'sat']

function metaFields(meta: LogMeta): string[] {
  const s = meta.defaultSignal
  const out = [
    writeField(A.NAME, meta.name),
    writeField(A.PROFILE, meta.profile),
    writeField(A.MYCALL, meta.myCall),
    writeField(A.MYGRID, meta.myGrid),
    writeField(A.DEFBAND, s.band),
    writeField(A.DEFMODE, s.mode),
  ]
  // "SOTA OK/JC-001;POTA CZ-0123" — a single reference (older logs) is the same without the ;
  if (meta.myRefs && meta.myRefs.length > 0)
    out.push(writeField(A.MYREF, formatRefList(meta.myRefs)))
  if (s.bandRx !== undefined) out.push(writeField(A.DEFBANDRX, s.bandRx))
  if (s.modeRx !== undefined) out.push(writeField(A.DEFMODERX, s.modeRx))
  if (meta.satLabel !== undefined) out.push(writeField(A.SATLABEL, meta.satLabel))
  if (meta.category) out.push(writeField(A.CATEGORY, formatCategory(meta.category)))
  if (meta.edi) {
    out.push(writeField(A.EDI_CONTEST, meta.edi.contest), writeField(A.EDI_SECTION, meta.edi.section))
    if (meta.edi.operators) out.push(writeField(A.EDI_OPS, meta.edi.operators))
  }
  return out
}

/** Serialize a whole log (header with meta + one record per QSO) to ADIF text. */
export function writeLogFile(meta: LogMeta, qsos: readonly Qso[]): string {
  const header = [writeField('ADIF_VER', '3.1.4'), writeField('PROGRAMID', 'kQSO'), ...metaFields(meta), '<EOH>'].join(' ')
  return [header, ...qsos.map(writeQso)].join('\n') + '\n'
}

/** The header line alone — what `createLog` writes before any QSO is appended. */
export function writeLogHeader(meta: LogMeta): string {
  return writeLogFile(meta, []).trimEnd() + '\n'
}

function metaFromHeader(h: Record<string, string>): LogMeta {
  const rawProfile = h[A.PROFILE]
  const profile: ProfileId = PROFILE_IDS.includes(rawProfile as ProfileId)
    ? (rawProfile as ProfileId)
    : 'obecny'

  const signal: Signal = { band: h[A.DEFBAND] ?? '40m', mode: h[A.DEFMODE] ?? 'SSB' }
  const bandRx = h[A.DEFBANDRX]
  if (bandRx !== undefined) (signal as { bandRx?: string }).bandRx = bandRx
  const modeRx = h[A.DEFMODERX]
  if (modeRx !== undefined) (signal as { modeRx?: string }).modeRx = modeRx

  const meta: { -readonly [K in keyof LogMeta]: LogMeta[K] } = {
    name: h[A.NAME] ?? '',
    profile,
    myCall: h[A.MYCALL] ?? '',
    myGrid: h[A.MYGRID] ?? '',
    defaultSignal: signal,
  }
  const myRefRaw = h[A.MYREF]
  if (myRefRaw !== undefined) {
    const refs = parseRefList(myRefRaw)
    if (refs.length > 0) meta.myRefs = refs
  }
  const satLabel = h[A.SATLABEL]
  if (satLabel !== undefined) meta.satLabel = satLabel
  const category = parseCategory(h[A.CATEGORY])
  if (category) meta.category = category
  const ediContest = h[A.EDI_CONTEST]
  if (ediContest !== undefined) {
    meta.edi = { contest: ediContest, section: h[A.EDI_SECTION] ?? '', operators: h[A.EDI_OPS] ?? '' }
  }
  return meta
}

const CONTEST_WORD: Readonly<Record<ContestCategory['contest'], string>> = { national: '', iaru: 'IARU', pa: 'PA', fm: 'FM' }

/** "MO IARU 6H", "SO PA": ops, then the contest unless national, then LP / 6H when not full power. */
function formatCategory(c: ContestCategory): string {
  return [c.ops, CONTEST_WORD[c.contest], ...(c.variant === 'full' ? [] : [c.variant.toUpperCase()])].filter(Boolean).join(' ')
}

function parseCategory(text: string | undefined): ContestCategory | undefined {
  const words = (text ?? '').toUpperCase().split(/\s+/)
  const ops = words.find((w): w is ContestCategory['ops'] => w === 'SO' || w === 'MO' || w === 'CHECK')
  if (!ops) return undefined
  const contest = words.includes('IARU') ? 'iaru' : words.includes('PA') ? 'pa' : words.includes('FM') ? 'fm' : 'national'
  const variant = contest !== 'iaru' ? 'full' : words.includes('6H') ? '6h' : words.includes('LP') ? 'lp' : 'full'
  return { ops, contest, variant }
}

export interface ParsedLogFile {
  readonly meta: LogMeta
  readonly qsos: Qso[]
  readonly count: number
}

/** Parse a whole log file back into its meta and QSOs. */
export function readLogFile(text: string): ParsedLogFile {
  const { header, qsos } = readAdif(text)
  return { meta: metaFromHeader(header), qsos, count: qsos.length }
}

/** One program's upload from an activation with several references: plain ADIF (no
 *  APP_KQSO header) where every QSO carries just that reference. */
export function writeRefExport(qsos: readonly Qso[], ref: AwardReference): string {
  return writeAdif(qsos.map((q) => ({ ...q, myRefs: [ref] })))
}

/**
 * The file name each program asks for, dated by the first QSO (UTC):
 * WWFF "OK1CDJ@OKFF-0123 20261019.adi", POTA "OK1CDJ@CZ-0123-20261019.adi", and the
 * same shape for SOTA / GMA / TOTA. Slashes (OK1CDJ/P, OK/JC-001) become dashes.
 */
export function refExportName(myCall: string, ref: AwardReference, qsos: readonly Qso[]): string {
  const first = qsos.reduce<Date | undefined>((d, q) => (d && d <= q.timeOn ? d : q.timeOn), undefined)
  const date = (first ?? new Date()).toISOString().slice(0, 10).replace(/-/g, '')
  const safe = (s: string): string => s.replace(/\//g, '-')
  return `${safe(myCall)}@${safe(ref.value)}${ref.kind === 'WWFF' ? ' ' : '-'}${date}.adi`
}
