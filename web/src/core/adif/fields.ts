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
      return [
        [F.SIG, ref.kind],
        [F.SIG_INFO, ref.value],
      ]
  }
}

/** Reconstruct the worked station's reference from a decoded field record, or undefined. */
export function fieldsToRef(fields: Record<string, string>): AwardReference | undefined {
  const sotaRef = fields[F.SOTA_REF]
  if (sotaRef !== undefined) return { kind: 'SOTA', value: sotaRef }

  const potaRef = fields[F.POTA_REF]
  if (potaRef !== undefined) return { kind: 'POTA', value: potaRef }

  const sigKind = fields[F.SIG]?.toUpperCase()
  const sigInfo = fields[F.SIG_INFO]
  if ((sigKind === 'GMA' || sigKind === 'WWFF' || sigKind === 'TOTA') && sigInfo !== undefined) {
    return { kind: sigKind, value: sigInfo }
  }
  return undefined
}

/**
 * Encode my references (at most one of each kind but POTA, see validateMyRefs). SOTA and
 * WWFF have their own fields, POTA parks share MY_POTA_REF comma-separated. MY_SIG carries
 * GMA or TOTA (no ADIF field; rozhledny.eu wants MY_SIG=TOTA), else WWFF — what older kQSO
 * wrote and Logsearch reads.
 */
export function myRefsToFields(refs: readonly AwardReference[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const sota = refs.find((r) => r.kind === 'SOTA')
  if (sota) out.push([F.MY_SOTA_REF, sota.value])
  const parks = refs.filter((r) => r.kind === 'POTA')
  if (parks.length > 0) out.push([F.MY_POTA_REF, parks.map((r) => r.value).join(',')])
  const wwff = refs.find((r) => r.kind === 'WWFF')
  if (wwff) out.push([F.MY_WWFF_REF, wwff.value])
  const sig = refs.find((r) => r.kind === 'GMA' || r.kind === 'TOTA') ?? wwff
  if (sig) out.push([F.MY_SIG, sig.kind], [F.MY_SIG_INFO, sig.value])
  return out
}

/** My references from a decoded field record, in field order; empty when there are none. */
export function fieldsToMyRefs(fields: Record<string, string>): AwardReference[] {
  const out: AwardReference[] = []
  const add = (kind: ReferenceKind, value: string | undefined): void => {
    const v = value?.trim()
    if (v && !out.some((r) => r.kind === kind && r.value === v)) out.push({ kind, value: v })
  }
  add('SOTA', fields[F.MY_SOTA_REF])
  for (const park of (fields[F.MY_POTA_REF] ?? '').split(',')) add('POTA', park)
  add('WWFF', fields[F.MY_WWFF_REF])
  const sigKind = fields[F.MY_SIG]?.toUpperCase()
  if (sigKind === 'GMA' || sigKind === 'WWFF' || sigKind === 'TOTA') add(sigKind, fields[F.MY_SIG_INFO])
  return out
}

export type { ReferenceKind }
