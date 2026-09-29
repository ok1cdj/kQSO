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
})
