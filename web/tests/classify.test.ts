import { describe, it, expect } from 'vitest'
import { classifyToken, isFullLocator } from '../src/core/classify'
import type { TokenContext } from '../src/core/classify'
import { PROFILES } from '../src/core/model'

// Default context: first token, no call seen yet, Obecný profile (so #9 name is reachable).
function ctx(over: Partial<TokenContext> = {}): TokenContext {
  return { isFirstToken: true, callSeen: false, profile: PROFILES.obecny, ...over }
}

describe('each classification rule in isolation', () => {
  it('#1 band', () => {
    expect(classifyToken('40M', ctx())).toEqual({ type: 'band', value: '40m' })
  })

  it('#2 mode', () => {
    expect(classifyToken('SSB', ctx())).toEqual({ type: 'mode', value: 'SSB' })
  })

  it('#3 time — only as first token', () => {
    expect(classifyToken('1428', ctx({ isFirstToken: true }))).toEqual({ type: 'time', value: '1428' })
    // not first token → falls through; after a call a 4-digit number is a #7 number
    expect(classifyToken('1428', ctx({ isFirstToken: false, callSeen: true }))).toEqual({
      type: 'number',
      value: '1428',
    })
  })

  it('#4 reference', () => {
    expect(classifyToken('OK/ZC/001', ctx())).toEqual({
      type: 'reference',
      value: { kind: 'SOTA', value: 'OK/ZC-001' },
    })
  })

  it('#5 callsign, plain and portable', () => {
    expect(classifyToken('OK1ABC', ctx())).toEqual({ type: 'call', value: 'OK1ABC' })
    expect(classifyToken('OK1ABC/P', ctx())).toEqual({ type: 'call', value: 'OK1ABC/P' })
    expect(classifyToken('HB0/OK1MCS/P', ctx())).toEqual({ type: 'call', value: 'HB0/OK1MCS/P' })
    expect(classifyToken('OK1ABC/5', ctx())).toEqual({ type: 'call', value: 'OK1ABC/5' })
  })

  it('#6 TX report override T## keeps digits only', () => {
    expect(classifyToken('T56', ctx({ callSeen: true }))).toEqual({ type: 'reportSent', value: '56' })
    expect(classifyToken('T599', ctx({ callSeen: true }))).toEqual({ type: 'reportSent', value: '599' })
  })

  it('#7 bare number after a call is the RX report (no R prefix)', () => {
    expect(classifyToken('55', ctx({ isFirstToken: false, callSeen: true }))).toEqual({
      type: 'number',
      value: '55',
    })
    expect(classifyToken('001', ctx({ isFirstToken: false, callSeen: true }))).toEqual({
      type: 'number',
      value: '001',
    })
  })

  it('a stray R## is no longer a received-report token', () => {
    // Aktivace does not parse names → R55 falls through to unknown.
    expect(classifyToken('R55', ctx({ callSeen: true, profile: PROFILES.aktivace }))).toEqual({
      type: 'unknown',
      raw: 'R55',
    })
  })

  it('#8 locator — after a call', () => {
    expect(classifyToken('JN79US', ctx({ isFirstToken: false, callSeen: true }))).toEqual({
      type: 'locator',
      value: 'JN79US',
    })
    expect(classifyToken('JO60', ctx({ isFirstToken: false, callSeen: true }))).toEqual({
      type: 'locator',
      value: 'JO60',
    })
  })

  it('#9 name — Obecný only', () => {
    expect(classifyToken('PETR', ctx({ isFirstToken: false, callSeen: true }))).toEqual({
      type: 'name',
      value: 'PETR',
    })
    // Aktivace does not parse names → unknown
    expect(
      classifyToken('PETR', ctx({ isFirstToken: false, callSeen: true, profile: PROFILES.aktivace })),
    ).toEqual({ type: 'unknown', raw: 'PETR' })
  })
})

describe('isFullLocator', () => {
  it('accepts only 6-character locators', () => {
    expect(isFullLocator('JO70FD')).toBe(true)
    expect(isFullLocator('JO70')).toBe(false)
    expect(isFullLocator('70FD')).toBe(false)
    expect(isFullLocator('')).toBe(false)
  })
})
