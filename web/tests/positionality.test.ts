import { describe, it, expect } from 'vitest'
import { classifyLine } from '../src/core/classify'
import { PROFILES } from '../src/core/model'

describe('positionality of number and locator (ch. 9.2)', () => {
  it('a number after the call is a received report/serial; before the call it is not a number', () => {
    const after = classifyLine(['OK1ABC', '001'], PROFILES.aktivace)
    expect(after[1]!.cls).toEqual({ type: 'number', value: '001' })

    // Aktivace does not parse names, and 001 before a call fails #7 → unknown.
    const before = classifyLine(['001', 'OK1ABC'], PROFILES.aktivace)
    expect(before[0]!.cls).toEqual({ type: 'unknown', raw: '001' })
    expect(before[1]!.cls).toEqual({ type: 'call', value: 'OK1ABC' })
  })

  it('a locator is recognized only after the call', () => {
    const after = classifyLine(['DL5ABC', 'JO60UN'], PROFILES.aktivace)
    expect(after[1]!.cls).toEqual({ type: 'locator', value: 'JO60UN' })

    // JN79US as the first token matches the callsign regex (ch. 9.2).
    const first = classifyLine(['JN79US', 'DL5ABC'], PROFILES.aktivace)
    expect(first[0]!.cls).toEqual({ type: 'call', value: 'JN79US' })
    // ...and once a call was seen, the second locator-shaped token is a locator.
    const second = classifyLine(['DL5ABC', 'JN79US'], PROFILES.aktivace)
    expect(second[1]!.cls).toEqual({ type: 'locator', value: 'JN79US' })
  })

  it('a later non-locator call-shaped token is a new call (typo fix)', () => {
    const r = classifyLine(['OK1ND', 'OK1NP'], PROFILES.aktivace)
    expect(r[1]!.cls).toEqual({ type: 'call', value: 'OK1NP' })
  })
})
