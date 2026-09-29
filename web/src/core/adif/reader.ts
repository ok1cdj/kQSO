// ADIF reader: text → Qso[]. Scans on UTF-8 bytes because `<name:LEN>` lengths
// are byte counts. Reverses the writer's field mapping via the shared fields.ts,
// which is what makes parse → ADIF → parse roundtrip.

import type { Qso, Signal } from '../model'
import { utf8Encode, utf8Decode } from './bytes'
import { F, fieldsToRef } from './fields'

const LT = 0x3c // '<'
const GT = 0x3e // '>'

export interface ReadResult {
  readonly header: Record<string, string>
  readonly qsos: Qso[]
}

function indexOf(bytes: readonly number[], target: number, from: number): number {
  for (let i = from; i < bytes.length; i++) if (bytes[i] === target) return i
  return -1
}

function parseDateTime(date: string, time: string): Date {
  const y = Number(date.slice(0, 4))
  const mo = Number(date.slice(4, 6))
  const d = Number(date.slice(6, 8))
  const hh = Number(time.slice(0, 2))
  const mm = Number(time.slice(2, 4))
  const ss = time.length >= 6 ? Number(time.slice(4, 6)) : 0
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss))
}

function toQso(r: Record<string, string>): Qso {
  const signal: Signal = { band: r[F.BAND] ?? '', mode: r[F.MODE] ?? '' }
  const bandRx = r[F.BAND_RX]
  if (bandRx !== undefined) (signal as { bandRx?: string }).bandRx = bandRx

  const qso: { -readonly [K in keyof Qso]: Qso[K] } = {
    call: r[F.CALL] ?? '',
    timeOn: parseDateTime(r[F.QSO_DATE] ?? '', r[F.TIME_ON] ?? ''),
    signal,
    report: { sent: r[F.RST_SENT] ?? '', rcvd: r[F.RST_RCVD] ?? '' },
    stationCall: r[F.STATION_CALLSIGN] ?? '',
    myGrid: r[F.MY_GRIDSQUARE] ?? '',
  }
  const grid = r[F.GRIDSQUARE]
  if (grid !== undefined) qso.grid = grid
  const theirRef = fieldsToRef(r, false)
  if (theirRef) qso.theirRef = theirRef
  const myRef = fieldsToRef(r, true)
  if (myRef) qso.myRef = myRef
  const name = r[F.NAME]
  if (name !== undefined) qso.name = name
  const serial = r[F.SRX_STRING]
  if (serial !== undefined) qso.serial = serial
  const sentSerial = r[F.STX_STRING]
  if (sentSerial !== undefined) qso.sentSerial = sentSerial
  const satName = r[F.SAT_NAME] // PROP_MODE=SAT is implied by SAT_NAME's presence
  if (satName !== undefined) qso.satName = satName
  const satMode = r[F.SAT_MODE]
  if (satMode !== undefined) qso.satMode = satMode
  return qso
}

export function readAdif(text: string): ReadResult {
  const bytes = utf8Encode(text)
  const n = bytes.length
  let header: Record<string, string> = {}
  const qsos: Qso[] = []
  let record: Record<string, string> = {}
  let i = 0

  while (i < n) {
    if (bytes[i] !== LT) {
      i++
      continue
    }
    const close = indexOf(bytes, GT, i + 1)
    if (close < 0) break
    const tag = utf8Decode(bytes.slice(i + 1, close)).trim()
    i = close + 1

    const upper = tag.toUpperCase()
    if (upper === 'EOH') {
      header = record
      record = {}
      continue
    }
    if (upper === 'EOR') {
      qsos.push(toQso(record))
      record = {}
      continue
    }

    const parts = tag.split(':')
    if (parts.length < 2) continue
    const name = parts[0]!.toUpperCase()
    const len = Number.parseInt(parts[1]!, 10)
    if (!Number.isFinite(len) || len < 0) continue

    record[name] = utf8Decode(bytes.slice(i, i + len))
    i += len
  }

  return { header, qsos }
}
