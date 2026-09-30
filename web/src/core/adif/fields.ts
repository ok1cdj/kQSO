// ADIF field-name constants and the single reference↔field mapping shared by the
// writer and the reader, so the two cannot drift and roundtrip is guaranteed.

import type { AwardReference, ReferenceKind } from '../model'

export const F = {
  CALL: 'CALL',
  QSO_DATE: 'QSO_DATE',
  TIME_ON: 'TIME_ON',
  BAND: 'BAND',
  BAND_RX: 'BAND_RX',
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
  MY_POTA_REF: 'MY_POTA_REF',
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

/** Encode an award reference into its ADIF fields. `mine` selects the MY_* variant. */
export function refToFields(ref: AwardReference, mine: boolean): Array<[string, string]> {
  switch (ref.kind) {
    case 'SOTA':
      return [[mine ? F.MY_SOTA_REF : F.SOTA_REF, ref.value]]
    case 'POTA':
      return [[mine ? F.MY_POTA_REF : F.POTA_REF, ref.value]]
    case 'GMA': // no GMA field in ADIF; gma.rocks asks the reference at upload anyway
    case 'WWFF':
    case 'TOTA': // rozhledny.eu wants MY_SIG=TOTA + MY_SIG_INFO=OKR-1001
      return mine
        ? [
            [F.MY_SIG, ref.kind],
            [F.MY_SIG_INFO, ref.value],
          ]
        : [
            [F.SIG, ref.kind],
            [F.SIG_INFO, ref.value],
          ]
  }
}

/** Reconstruct an award reference from a decoded field record, or undefined. `mine` selects MY_*. */
export function fieldsToRef(fields: Record<string, string>, mine: boolean): AwardReference | undefined {
  const sotaRef = fields[mine ? F.MY_SOTA_REF : F.SOTA_REF]
  if (sotaRef !== undefined) return { kind: 'SOTA', value: sotaRef }

  const potaRef = fields[mine ? F.MY_POTA_REF : F.POTA_REF]
  if (potaRef !== undefined) return { kind: 'POTA', value: potaRef }

  const sig = fields[mine ? F.MY_SIG : F.SIG]
  const sigInfo = fields[mine ? F.MY_SIG_INFO : F.SIG_INFO]
  const sigKind = sig?.toUpperCase()
  if ((sigKind === 'GMA' || sigKind === 'WWFF' || sigKind === 'TOTA') && sigInfo !== undefined) {
    return { kind: sigKind, value: sigInfo }
  }
  return undefined
}

export type { ReferenceKind }
