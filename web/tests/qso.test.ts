import { describe, it, expect } from 'vitest'
import { buildQso } from '../src/core/qso'
import { parseLine } from '../src/core/parse'
import { PROFILES, defaultReport } from '../src/core/model'
import type { LogMeta } from '../src/core/model'

const meta: LogMeta = {
  name: 'test',
  profile: 'obecny',
  myCall: 'OK1CDJ',
  myGrid: 'JN79US',
  defaultSignal: { band: '40m', mode: 'SSB' },
}

const T = new Date('2026-09-22T14:32:00Z')

describe('default report by mode', () => {
  it('599 on CW, 59 on everything else', () => {
    expect(defaultReport('CW')).toBe('599')
    for (const mode of ['SSB', 'FM', 'AM', 'FT8']) expect(defaultReport(mode)).toBe('59')
  })

  it('a CW QSO without typed reports gets 599 both ways', () => {
    const q = buildQso({ call: 'OK1ABC', timeOn: T }, { band: '40m', mode: 'CW' }, meta)
    expect(q?.report).toEqual({ sent: '599', rcvd: '599' })
  })

  it('an SSB QSO without typed reports gets 59 both ways', () => {
    const q = buildQso({ call: 'OK1ABC', timeOn: T }, { band: '40m', mode: 'SSB' }, meta)
    expect(q?.report).toEqual({ sent: '59', rcvd: '59' })
  })

  it('switching to CW on the line makes the default 599', () => {
    const r = parseLine('CW OK1ABC', { band: '40m', mode: 'SSB' }, { timeOn: T }, PROFILES.obecny)
    expect(buildQso(r.partial, r.sticky, meta)?.report).toEqual({ sent: '599', rcvd: '599' })
  })

  it('typed reports override the default (bare number = received, T## = sent)', () => {
    const r = parseLine('OK1ABC 579 T559', { band: '40m', mode: 'CW' }, { timeOn: T }, PROFILES.obecny)
    expect(buildQso(r.partial, r.sticky, meta)?.report).toEqual({ sent: '559', rcvd: '579' })
  })
})
