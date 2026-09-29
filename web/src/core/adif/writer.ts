// ADIF writer: a Qso becomes one record `<field:len>value … <eor>`.
// Fields are emitted in a fixed deterministic order so exact-string tests hold.

import type { Qso } from '../model'
import { byteLength } from './bytes'
import { F, refToFields } from './fields'

/** One ADIF field: `<NAME:byteLen>VALUE`. */
export function writeField(name: string, value: string): string {
  return `<${name}:${byteLength(value)}>${value}`
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

/** YYYYMMDD in UTC — QSOs are stored in UTC. */
function qsoDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`
}

/** HHMMSS in UTC. */
function timeOn(d: Date): string {
  return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`
}

/**
 * Serialize one QSO to a single ADIF record (no trailing newline). Emission is
 * presence-based: a field appears iff the Qso carries it, which keeps the
 * writer and reader symmetric for roundtrip.
 */
export function writeQso(qso: Qso): string {
  const parts: string[] = [
    writeField(F.CALL, qso.call),
    writeField(F.QSO_DATE, qsoDate(qso.timeOn)),
    writeField(F.TIME_ON, timeOn(qso.timeOn)),
    writeField(F.BAND, qso.signal.band),
  ]
  if (qso.signal.bandRx !== undefined) parts.push(writeField(F.BAND_RX, qso.signal.bandRx))
  parts.push(
    writeField(F.MODE, qso.signal.mode),
    writeField(F.RST_SENT, qso.report.sent),
    writeField(F.RST_RCVD, qso.report.rcvd),
    writeField(F.STATION_CALLSIGN, qso.stationCall),
    writeField(F.MY_GRIDSQUARE, qso.myGrid),
  )
  if (qso.grid !== undefined) parts.push(writeField(F.GRIDSQUARE, qso.grid))
  if (qso.theirRef !== undefined)
    for (const [n, v] of refToFields(qso.theirRef, false)) parts.push(writeField(n, v))
  if (qso.myRef !== undefined)
    for (const [n, v] of refToFields(qso.myRef, true)) parts.push(writeField(n, v))
  if (qso.name !== undefined) parts.push(writeField(F.NAME, qso.name))
  if (qso.serial !== undefined) parts.push(writeField(F.SRX_STRING, qso.serial))
  if (qso.sentSerial !== undefined) parts.push(writeField(F.STX_STRING, qso.sentSerial))
  if (qso.satName !== undefined) {
    parts.push(writeField(F.PROP_MODE, 'SAT'), writeField(F.SAT_NAME, qso.satName))
    if (qso.satMode !== undefined) parts.push(writeField(F.SAT_MODE, qso.satMode))
  }

  return parts.join(' ') + ' <EOR>'
}

/** A minimal ADIF header so external uploaders accept the file. */
export function writeHeader(): string {
  return `${writeField(F.ADIF_VER, '3.1.4')} ${writeField(F.PROGRAMID, 'kQSO')} <EOH>`
}

/** Full ADIF document: header line + one record per line. */
export function writeAdif(qsos: readonly Qso[]): string {
  const lines = [writeHeader(), ...qsos.map(writeQso)]
  return lines.join('\n') + '\n'
}
