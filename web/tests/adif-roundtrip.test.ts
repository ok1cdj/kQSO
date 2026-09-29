import { describe, it, expect } from 'vitest'
import { writeAdif } from '../src/core/adif/writer'
import { readAdif } from '../src/core/adif/reader'
import type { Qso } from '../src/core/model'

const BASE = {
  timeOn: new Date('2026-09-22T14:32:07Z'),
  report: { sent: '59', rcvd: '59' },
  stationCall: 'OK1CDJ',
  myGrid: 'JN79US',
} as const

function roundtrip(qso: Qso): Qso {
  const { qsos } = readAdif(writeAdif([qso]))
  expect(qsos).toHaveLength(1)
  return qsos[0]!
}

describe('parse → ADIF → parse roundtrip', () => {
  it('SOTA', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      signal: { band: '40m', mode: 'SSB' },
      theirRef: { kind: 'SOTA', value: 'OK/ZC-014' },
      myRef: { kind: 'SOTA', value: 'OK/ZC-001' },
    }
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('POTA', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      signal: { band: '20m', mode: 'CW' },
      theirRef: { kind: 'POTA', value: 'OK-0001' },
      myRef: { kind: 'POTA', value: 'OK-0002' },
    }
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('WWFF', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      signal: { band: '2m', mode: 'FM' },
      theirRef: { kind: 'WWFF', value: 'OKFF-0001' },
      myRef: { kind: 'WWFF', value: 'OKFF-0002' },
    }
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('TOTA', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      signal: { band: '2m', mode: 'FM' },
      theirRef: { kind: 'TOTA', value: 'OKR-0427' },
      myRef: { kind: 'TOTA', value: 'OKR-1001' },
    }
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('Obecný with grid + name', () => {
    const qso: Qso = {
      ...BASE,
      call: 'G8AHK/P',
      signal: { band: '40m', mode: 'SSB' },
      grid: 'JO60UN',
      name: 'PETR',
    }
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('VKV contest Qso with sent + received serials', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      signal: { band: '2m', mode: 'SSB' },
      grid: 'JN99',
      serial: '002', // received (SRX_STRING) — leading zero preserved
      sentSerial: '015', // sent (STX_STRING)
    }
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('satellite QSO: PROP_MODE/SAT_NAME/SAT_MODE + BAND_RX (F3)', () => {
    const qso: Qso = {
      ...BASE,
      call: '9A5Y',
      signal: { band: '2m', bandRx: '70cm', mode: 'SSB' },
      grid: 'JN86',
      satName: 'RS-44',
      satMode: 'V/U',
    }
    const text = writeAdif([qso])
    expect(text).toContain('<PROP_MODE:3>SAT')
    expect(text).toContain('<SAT_NAME:5>RS-44')
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('satellite-shaped Qso with BAND_RX', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      signal: { band: '2m', mode: 'SSB', bandRx: '70cm' },
    }
    expect(roundtrip(qso)).toEqual(qso)
  })

  it('reads multiple records', () => {
    const a: Qso = { ...BASE, call: 'OK1ABC', signal: { band: '40m', mode: 'SSB' } }
    const b: Qso = { ...BASE, call: 'DL5ABC', signal: { band: '20m', mode: 'CW' } }
    const { qsos } = readAdif(writeAdif([a, b]))
    expect(qsos).toEqual([a, b])
  })
})
