import { describe, it, expect } from 'vitest'
import { classifyToken } from '../src/core/classify'
import type { TokenContext } from '../src/core/classify'
import { PROFILES } from '../src/core/model'

function ctx(over: Partial<TokenContext> = {}): TokenContext {
  return { isFirstToken: true, callSeen: false, profile: PROFILES.aktivace, ...over }
}

describe('band vs callsign collisions', () => {
  it('20M is a band, not a callsign', () => {
    expect(classifyToken('20M', ctx())).toEqual({ type: 'band', value: '20m' })
  })

  it('2M is a band, not a callsign', () => {
    expect(classifyToken('2M', ctx())).toEqual({ type: 'band', value: '2m' })
  })

  it('10G/24G are bands, not callsigns', () => {
    expect(classifyToken('10G', ctx())).toEqual({ type: 'band', value: '3cm' })
    expect(classifyToken('24G', ctx())).toEqual({ type: 'band', value: '1.25cm' })
  })
})

describe('locator vs callsign collision', () => {
  it('JN79US is a locator only after a call', () => {
    expect(classifyToken('JN79US', ctx({ isFirstToken: false, callSeen: true }))).toEqual({
      type: 'locator',
      value: 'JN79US',
    })
  })

  it('JN79US before any call is classified as a callsign (position matters)', () => {
    expect(classifyToken('JN79US', ctx({ callSeen: false }))).toEqual({ type: 'call', value: 'JN79US' })
  })

  it('VHF contest: a full locator is a locator even before the call (heard first)', () => {
    expect(classifyToken('JO70VA', ctx({ callSeen: false, profile: PROFILES.vkv }))).toEqual({ type: 'locator', value: 'JO70VA' })
    // a short one (70VA) still needs the call first; a real call stays a call
    expect(classifyToken('70VA', ctx({ callSeen: false, profile: PROFILES.vkv })).type).not.toBe('locator')
    expect(classifyToken('OK1ABC', ctx({ callSeen: false, profile: PROFILES.vkv }))).toEqual({ type: 'call', value: 'OK1ABC' })
  })
})

describe('VHF contest: locator first, call later', () => {
  it('JO70VA ⏎ then OK1ABC 59001 ⏎ builds one QSO', async () => {
    const { parseLine } = await import('../src/core/parse')
    const s0 = { band: '2m', mode: 'SSB' }
    const l1 = parseLine('JO70VA', s0, {}, PROFILES.vkv)
    expect(l1.partial).toMatchObject({ grid: 'JO70VA' })
    expect(l1.partial.call).toBeUndefined()
    const l2 = parseLine('OK1ABC 59001', l1.sticky, l1.partial, PROFILES.vkv)
    expect(l2.partial).toMatchObject({ call: 'OK1ABC', grid: 'JO70VA', serial: '001' })
  })
})
