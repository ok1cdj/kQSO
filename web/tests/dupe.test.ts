import { describe, it, expect } from 'vitest'
import { isDupe } from '../src/core/dupe'
import type { Qso } from '../src/core/model'

function qso(call: string, band: string, mode: string): Qso {
  return {
    call,
    timeOn: new Date('2026-09-22T14:00:00Z'),
    signal: { band, mode },
    report: { sent: '59', rcvd: '59' },
    stationCall: 'OK1CDJ',
    myGrid: 'JN79US',
  }
}

const log = [qso('OK1ABC', '40m', 'SSB'), qso('DL5ABC', '20m', 'CW')]

describe('DUPE check', () => {
  it('matches on call + band + mode', () => {
    expect(isDupe(log, 'OK1ABC', '40m', 'SSB')).toBe(true)
  })

  it('is case-insensitive on the call', () => {
    expect(isDupe(log, 'ok1abc', '40m', 'SSB')).toBe(true)
  })

  it('same call on a different band is not a dupe', () => {
    expect(isDupe(log, 'OK1ABC', '20m', 'SSB')).toBe(false)
  })

  it('same call, same band, different mode is not a dupe', () => {
    expect(isDupe(log, 'OK1ABC', '40m', 'CW')).toBe(false)
  })

  it('unknown call is not a dupe', () => {
    expect(isDupe(log, 'S57ABC', '40m', 'SSB')).toBe(false)
  })
})
