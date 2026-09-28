import { describe, it, expect } from 'vitest'
import { writeField, writeQso, writeHeader } from '../src/core/adif/writer'
import type { Qso } from '../src/core/model'

const BASE = {
  timeOn: new Date('2026-09-22T14:32:07Z'),
  signal: { band: '40m', mode: 'SSB' },
  report: { sent: '59', rcvd: '59' },
  stationCall: 'OK1CDJ',
  myGrid: 'JN79US',
} as const

const HEAD =
  '<CALL:6>OK2XYZ <QSO_DATE:8>20260922 <TIME_ON:6>143207 <BAND:3>40m <MODE:3>SSB ' +
  '<RST_SENT:2>59 <RST_RCVD:2>59 <STATION_CALLSIGN:6>OK1CDJ <MY_GRIDSQUARE:6>JN79US'

describe('writeField / writeHeader', () => {
  it('encodes byte length', () => {
    expect(writeField('CALL', 'OK1ABC')).toBe('<CALL:6>OK1ABC')
  })

  it('emits a minimal ADIF header', () => {
    expect(writeHeader()).toBe('<ADIF_VER:5>3.1.4 <PROGRAMID:4>kQSO <EOH>')
  })
})

describe('writeQso against reference output (ch. 14)', () => {
  it('Aktivace SOTA — SOTA_REF + MY_SOTA_REF', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      theirRef: { kind: 'SOTA', value: 'OK/ZC-014' },
      myRef: { kind: 'SOTA', value: 'OK/ZC-001' },
    }
    expect(writeQso(qso)).toBe(`${HEAD} <SOTA_REF:9>OK/ZC-014 <MY_SOTA_REF:9>OK/ZC-001 <EOR>`)
  })

  it('Aktivace POTA — POTA_REF + MY_POTA_REF', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      theirRef: { kind: 'POTA', value: 'OK-0001' },
      myRef: { kind: 'POTA', value: 'OK-0002' },
    }
    expect(writeQso(qso)).toBe(`${HEAD} <POTA_REF:7>OK-0001 <MY_POTA_REF:7>OK-0002 <EOR>`)
  })

  it('Aktivace WWFF — SIG/SIG_INFO + MY_SIG/MY_SIG_INFO', () => {
    const qso: Qso = {
      ...BASE,
      call: 'OK2XYZ',
      theirRef: { kind: 'WWFF', value: 'OKFF-0001' },
      myRef: { kind: 'WWFF', value: 'OKFF-0002' },
    }
    expect(writeQso(qso)).toBe(
      `${HEAD} <SIG:4>WWFF <SIG_INFO:9>OKFF-0001 <MY_SIG:4>WWFF <MY_SIG_INFO:9>OKFF-0002 <EOR>`,
    )
  })

  it('Obecný — GRIDSQUARE + NAME', () => {
    const qso: Qso = { ...BASE, call: 'OK2XYZ', grid: 'JO60UN', name: 'PETR' }
    expect(writeQso(qso)).toBe(`${HEAD} <GRIDSQUARE:6>JO60UN <NAME:4>PETR <EOR>`)
  })

  it('satellite BAND_RX slot emits after BAND (ch. 19.1)', () => {
    const qso: Qso = { ...BASE, call: 'OK2XYZ', signal: { band: '2m', mode: 'SSB', bandRx: '70cm' } }
    expect(writeQso(qso)).toContain('<BAND:2>2m <BAND_RX:4>70cm <MODE:3>SSB')
  })

  it('24 GHz is written under its ADIF name 1.25cm', () => {
    const qso: Qso = { ...BASE, call: 'OK2XYZ', signal: { band: '1.25cm', mode: 'CW' } }
    expect(writeQso(qso)).toContain('<BAND:6>1.25cm <MODE:2>CW')
  })
})
