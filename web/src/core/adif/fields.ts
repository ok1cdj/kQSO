// ADIF field-name constants and the single reference↔field mapping shared by the
// writer and the reader, so the two cannot drift and roundtrip is guaranteed.

import type { AwardReference, ReferenceKind } from '../model'

export const F = {
  CALL: 'CALL',
  QSO_DATE: 'QSO_DATE',
  TIME_ON: 'TIME_ON',
  BAND: 'BAND',
  BAND_RX: 'BAND_RX',
  FREQ: 'FREQ', // MHz
  FREQ_RX: 'FREQ_RX', // MHz
  MODE: 'MODE',
  RST_SENT: 'RST_SENT',
  RST_RCVD: 'RST_RCVD',
  STATION_CALLSIGN: 'STATION_CALLSIGN',
  MY_GRIDSQUARE: 'MY_GRIDSQUARE',
  GRIDSQUARE: 'GRIDSQUARE',
  NAME: 'NAME',
  SOTA_REF: 'SOTA_REF',
  MY_SOTA_REF: 'MY_SOTA_REF',
  POTA_REF: 'POTA_REF',
  MY_POTA_REF: 'MY_POTA_REF', // comma-separated parks (n-fer)
  MY_WWFF_REF: 'MY_WWFF_REF',
  SIG: 'SIG',
  SIG_INFO: 'SIG_INFO',
  MY_SIG: 'MY_SIG',
  MY_SIG_INFO: 'MY_SIG_INFO',
  SRX_STRING: 'SRX_STRING', // received serial (string preserves leading zeros)
  STX_STRING: 'STX_STRING', // sent serial
  PROP_MODE: 'PROP_MODE', // "SAT" for satellite QSOs
  SAT_NAME: 'SAT_NAME',
  SAT_MODE: 'SAT_MODE',
  PROGRAMID: 'PROGRAMID',
  APP_MYREF: 'APP_KQSO_MYREF', // all my references, when the ADIF fields can't hold them
  ADIF_VER: 'ADIF_VER',
} as const

/** Encode the worked station's (S2S) reference into its ADIF fields. */
export function refToFields(ref: AwardReference): Array<[string, string]> {
  switch (ref.kind) {
    case 'SOTA':
      return [[F.SOTA_REF, ref.value]]
    case 'POTA':
      return [[F.POTA_REF, ref.value]]
    case 'GMA': // no GMA field in ADIF; gma.rocks asks the reference at upload anyway
    case 'WWFF':
    case 'TOTA':
    case 'BOTA':
      return [
        [F.SIG, sigName(ref.kind)],
        [F.SIG_INFO, ref.value],
      ]
  }
}

/** The program's name in SIG / MY_SIG: the kind, but WWBOTA for bunkers (wwbota.net/adifguide). */
function sigName(kind: ReferenceKind): string {
  return kind === 'BOTA' ? 'WWBOTA' : kind
}

/** SIG / MY_SIG → our kind, or undefined for a program we don't keep. */
function sigKindOf(sig: string | undefined): ReferenceKind | undefined {
  const s = sig?.trim().toUpperCase()
  if (s === 'WWBOTA' || s === 'BOTA') return 'BOTA'
  return s === 'GMA' || s === 'WWFF' || s === 'TOTA' ? s : undefined
}

/** Reconstruct the worked station's reference from a decoded field record, or undefined. */
export function fieldsToRef(fields: Record<string, string>): AwardReference | undefined {
  const sotaRef = fields[F.SOTA_REF]
  if (sotaRef !== undefined) return { kind: 'SOTA', value: sotaRef }

  const potaRef = fields[F.POTA_REF]
  if (potaRef !== undefined) return { kind: 'POTA', value: potaRef }

  const sigKind = sigKindOf(fields[F.SIG])
  const sigInfo = fields[F.SIG_INFO]
  if (sigKind && sigInfo !== undefined) return { kind: sigKind, value: sigInfo }
  return undefined
}

const REF_KINDS: readonly ReferenceKind[] = ['SOTA', 'GMA', 'POTA', 'WWFF', 'TOTA', 'BOTA']

/** "SOTA OK/JC-001;POTA CZ-0123" — the log header's (and an overflowing QSO's) form. */
export function formatRefList(refs: readonly AwardReference[]): string {
  return refs.map((r) => `${r.kind} ${r.value}`).join(';')
}

export function parseRefList(raw: string): AwardReference[] {
  const out: AwardReference[] = []
  for (const item of raw.split(';')) {
    const sp = item.indexOf(' ')
    const kind = item.slice(0, sp) as ReferenceKind
    if (sp > 0 && REF_KINDS.includes(kind)) out.push({ kind, value: item.slice(sp + 1) })
  }
  return out
}

/**
 * Encode my references (at most one of each kind but POTA and BOTA, see parseMyRefsInput).
 * SOTA and WWFF have their own fields, POTA parks share MY_POTA_REF comma-separated. MY_SIG
 * carries GMA, TOTA (no ADIF field; rozhledny.eu wants MY_SIG=TOTA) or BOTA (MY_SIG=WWBOTA,
 * the bunkers comma-separated as wwbota.net asks), else WWFF — what older kQSO wrote and
 * Logsearch reads.
 */
export function myRefsToFields(refs: readonly AwardReference[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const sota = refs.find((r) => r.kind === 'SOTA')
  if (sota) out.push([F.MY_SOTA_REF, sota.value])
  const parks = refs.filter((r) => r.kind === 'POTA')
  if (parks.length > 0) out.push([F.MY_POTA_REF, parks.map((r) => r.value).join(',')])
  const wwff = refs.find((r) => r.kind === 'WWFF')
  if (wwff) out.push([F.MY_WWFF_REF, wwff.value])
  const sigs = refs.filter((r) => r.kind === 'GMA' || r.kind === 'TOTA' || r.kind === 'BOTA')
  const sigKinds = new Set(sigs.map((r) => r.kind))
  const sig = sigs[0] ?? wwff
  // Several bunkers at once share MY_SIG_INFO, comma-separated.
  const info = sig?.kind === 'BOTA' ? sigs.filter((r) => r.kind === 'BOTA').map((r) => r.value).join(',') : sig?.value
  if (sig && info) out.push([F.MY_SIG, sigName(sig.kind)], [F.MY_SIG_INFO, info])
  // Two programs for one MY_SIG (a GMA summit with a tower or a bunker on it). The rest goes
  // in an APP_ field uploaders skip, so the log keeps all (the per-reference export carries each).
  if (sigKinds.size > 1) out.push([F.APP_MYREF, formatRefList(refs)])
  return out
}

/** My references from a decoded field record, in field order; empty when there are none. */
export function fieldsToMyRefs(fields: Record<string, string>): AwardReference[] {
  const all = fields[F.APP_MYREF]
  if (all !== undefined) return parseRefList(all)
  const out: AwardReference[] = []
  const add = (kind: ReferenceKind, value: string | undefined): void => {
    const v = value?.trim()
    if (v && !out.some((r) => r.kind === kind && r.value === v)) out.push({ kind, value: v })
  }
  add('SOTA', fields[F.MY_SOTA_REF])
  for (const park of (fields[F.MY_POTA_REF] ?? '').split(',')) add('POTA', park)
  add('WWFF', fields[F.MY_WWFF_REF])
  const sigKind = sigKindOf(fields[F.MY_SIG])
  if (sigKind === 'BOTA') for (const b of (fields[F.MY_SIG_INFO] ?? '').split(',')) add('BOTA', b)
  else if (sigKind) add(sigKind, fields[F.MY_SIG_INFO])
  return out
}

export type { ReferenceKind }
