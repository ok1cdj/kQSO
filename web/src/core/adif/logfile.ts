// A kQSO log file is one ADIF document whose HEADER carries the log metadata via
// application-defined APP_KQSO_* fields (the .adi is the single source of
// truth). QSO records follow. Uploaders ignore APP_ header fields, so the same
// file is also the export.

import type { AwardReference, LogMeta, ProfileId, Qso, ReferenceKind, Signal } from '../model'
import { writeField, writeQso } from './writer'
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
} as const

const PROFILE_IDS: readonly ProfileId[] = ['vkv', 'aktivace', 'obecny', 'sat']
const REF_KINDS: readonly ReferenceKind[] = ['SOTA', 'GMA', 'POTA', 'WWFF', 'TOTA']

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
  if (meta.myRef) out.push(writeField(A.MYREF, `${meta.myRef.kind} ${meta.myRef.value}`))
  if (s.bandRx !== undefined) out.push(writeField(A.DEFBANDRX, s.bandRx))
  if (s.modeRx !== undefined) out.push(writeField(A.DEFMODERX, s.modeRx))
  if (meta.satLabel !== undefined) out.push(writeField(A.SATLABEL, meta.satLabel))
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

function parseRef(raw: string): AwardReference | undefined {
  const sp = raw.indexOf(' ')
  if (sp < 0) return undefined
  const kind = raw.slice(0, sp) as ReferenceKind
  const value = raw.slice(sp + 1)
  return REF_KINDS.includes(kind) ? { kind, value } : undefined
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
    const ref = parseRef(myRefRaw)
    if (ref) meta.myRef = ref
  }
  const satLabel = h[A.SATLABEL]
  if (satLabel !== undefined) meta.satLabel = satLabel
  const ediContest = h[A.EDI_CONTEST]
  if (ediContest !== undefined) {
    meta.edi = { contest: ediContest, section: h[A.EDI_SECTION] ?? '', operators: h[A.EDI_OPS] ?? '' }
  }
  return meta
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
