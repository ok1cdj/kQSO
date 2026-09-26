import { describe, it, expect } from 'vitest'
import { parseLine } from '../src/core/parse'
import { PROFILES } from '../src/core/model'
import type { StickyState } from '../src/core/model'

const sticky: StickyState = { band: '40m', mode: 'SSB' }

describe('ch. 9.4 worked examples (full-line reduction)', () => {
  it('OK1ABC → just a callsign', () => {
    const r = parseLine('OK1ABC', sticky, {}, PROFILES.aktivace)
    expect(r.partial).toEqual({ call: 'OK1ABC' })
  })

  it('OK2XYZ OK/ZC/014 → S2S reference of the worked station', () => {
    const r = parseLine('OK2XYZ OK/ZC/014', sticky, {}, PROFILES.aktivace)
    expect(r.partial.call).toBe('OK2XYZ')
    expect(r.partial.theirRef).toEqual({ kind: 'SOTA', value: 'OK/ZC-014' })
  })

  it('DL5ABC 55 JO60UN → received report (bare number) and locator', () => {
    const r = parseLine('DL5ABC 55 JO60UN', sticky, {}, PROFILES.aktivace)
    expect(r.partial.call).toBe('DL5ABC')
    expect(r.partial.reportRcvd).toBe('55')
    expect(r.partial.grid).toBe('JO60UN')
  })

  it('OK1ABC T56 → explicit TX report', () => {
    const r = parseLine('OK1ABC T56', sticky, {}, PROFILES.aktivace)
    expect(r.partial.call).toBe('OK1ABC')
    expect(r.partial.reportSent).toBe('56')
  })

  it('G8AHK/P PETR → name in the Obecný profile', () => {
    const r = parseLine('G8AHK/P PETR', sticky, {}, PROFILES.obecny)
    expect(r.partial.call).toBe('G8AHK/P')
    expect(r.partial.name).toBe('PETR')
  })

  it('40m ssb sets sticky band/mode', () => {
    const r = parseLine('40m ssb', { band: '20m', mode: 'CW' }, {}, PROFILES.aktivace)
    expect(r.sticky).toEqual({ band: '40m', mode: 'SSB' })
    expect(r.partial).toEqual({})
  })
})

describe('VKV contest exchange (ch. 9 #7)', () => {
  it('a bare number is the serial — including > 99 (123 is serial 123, not 12+3)', () => {
    for (const [line, serial] of [
      ['OK1ABC 001', '001'],
      ['OK1ABC 123', '123'],
      ['OK1ABC 1234', '1234'],
    ] as const) {
      const r = parseLine(line, { band: '2m', mode: 'FM' }, {}, PROFILES.vkv)
      expect(r.partial.serial).toBe(serial)
      expect(r.partial.reportRcvd).toBeUndefined() // → default 59 (FM) at commit
    }
  })

  it('joined report override: 58123 → report 58 + serial 123 (SSB/FM, first 2 chars)', () => {
    const r = parseLine('OK1ABC 58123', { band: '2m', mode: 'FM' }, {}, PROFILES.vkv)
    expect(r.partial.reportRcvd).toBe('58')
    expect(r.partial.serial).toBe('123')
  })

  it('joined override on CW: 599002 → report 599 + serial 002 (first 3 chars)', () => {
    const r = parseLine('OK1ABC 599002', { band: '2m', mode: 'CW' }, {}, PROFILES.vkv)
    expect(r.partial.reportRcvd).toBe('599')
    expect(r.partial.serial).toBe('002')
  })

  it('spaced report + serial: 59 001, 55 002, CW 599 002', () => {
    const a = parseLine('OK1ABC 59 001', { band: '2m', mode: 'FM' }, {}, PROFILES.vkv)
    expect(a.partial).toMatchObject({ reportRcvd: '59', serial: '001' })
    const b = parseLine('OK1ABC 55 002', { band: '2m', mode: 'FM' }, {}, PROFILES.vkv)
    expect(b.partial).toMatchObject({ reportRcvd: '55', serial: '002' })
    const c = parseLine('OK1ABC 599 002', { band: '2m', mode: 'CW' }, {}, PROFILES.vkv)
    expect(c.partial).toMatchObject({ reportRcvd: '599', serial: '002' })
  })

  it('full form 58123 JN99CL → report + serial + locator', () => {
    const r = parseLine('OK1ABC 58123 JN99CL', { band: '2m', mode: 'FM' }, {}, PROFILES.vkv)
    expect(r.partial).toMatchObject({ reportRcvd: '58', serial: '123', grid: 'JN99CL' })
  })

  it('a zero-padded serial is always the serial (0123), never a report prefix', () => {
    const r = parseLine('OK1ABC 0123', { band: '2m', mode: 'FM' }, {}, PROFILES.vkv)
    expect(r.partial.serial).toBe('0123')
    expect(r.partial.reportRcvd).toBeUndefined()
  })

  it('in a non-contest profile a bare number stays the whole RX report', () => {
    const r = parseLine('OK1ABC 55', { band: '40m', mode: 'SSB' }, {}, PROFILES.aktivace)
    expect(r.partial.reportRcvd).toBe('55')
    expect(r.partial.serial).toBeUndefined()
    // ...and a >4-digit token is not a number for non-contest profiles (spec \d{1,4}).
    const long = parseLine('OK1ABC 59002', { band: '40m', mode: 'SSB' }, {}, PROFILES.aktivace)
    expect(long.partial.reportRcvd).toBeUndefined()
  })
})

describe('Satellite profile (F3): report + locator, band tokens ignored', () => {
  it('9A5Y 59 JN86 → call + received report + locator', () => {
    const r = parseLine('9A5Y 59 JN86', { band: '2m', mode: 'SSB' }, {}, PROFILES.sat)
    expect(r.partial).toMatchObject({ call: '9A5Y', reportRcvd: '59', grid: 'JN86' })
  })

  it('a typed band token does not change the (satellite) band', () => {
    const r = parseLine('40m 9A5Y', { band: '2m', mode: 'SSB' }, {}, PROFILES.sat)
    expect(r.sticky.band).toBe('2m') // bird sets the band, not the token
    expect(r.partial.call).toBe('9A5Y')
  })

  it('a mode token still switches mode (SSB↔CW on linear birds)', () => {
    const r = parseLine('cw 9A5Y', { band: '2m', mode: 'SSB' }, {}, PROFILES.sat)
    expect(r.sticky.mode).toBe('CW')
  })
})

describe('piecewise accumulation across lines (ch. 11 phase 1)', () => {
  it('OK1ABC, then JN79US, then PETR accumulate into one partial', () => {
    let partial = {}
    ;({ partial } = parseLine('OK1ABC', sticky, partial, PROFILES.obecny))
    ;({ partial } = parseLine('JN79US', sticky, partial, PROFILES.obecny))
    ;({ partial } = parseLine('PETR', sticky, partial, PROFILES.obecny))
    expect(partial).toEqual({ call: 'OK1ABC', grid: 'JN79US', name: 'PETR' })
  })

  it('a call-shaped token on a later line fixes the call (OK1ND → OK1NP)', () => {
    let partial = {}
    ;({ partial } = parseLine('OK1ND 57', sticky, partial, PROFILES.aktivace))
    ;({ partial } = parseLine('OK1NP', sticky, partial, PROFILES.aktivace))
    expect(partial).toEqual({ call: 'OK1NP', reportRcvd: '57' })
  })

  it('the fix also works in Obecný — the new call is not taken for a name', () => {
    let partial = {}
    ;({ partial } = parseLine('OK1ND', sticky, partial, PROFILES.obecny))
    ;({ partial } = parseLine('OK1NP PETR', sticky, partial, PROFILES.obecny))
    expect(partial).toEqual({ call: 'OK1NP', name: 'PETR' })
  })

  it('a locator on a later line still stays a locator', () => {
    let partial = {}
    ;({ partial } = parseLine('OK1ND', sticky, partial, PROFILES.aktivace))
    ;({ partial } = parseLine('79US', sticky, partial, PROFILES.aktivace))
    expect(partial).toEqual({ call: 'OK1ND', grid: '79US' })
  })
})
