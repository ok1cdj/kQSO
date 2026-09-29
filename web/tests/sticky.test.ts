import { describe, it, expect } from 'vitest'
import { parseLine } from '../src/core/parse'
import { initialSticky } from '../src/core/sticky'
import { PROFILES } from '../src/core/model'
import type { LogMeta } from '../src/core/model'

const meta: LogMeta = {
  name: 'Test',
  profile: 'aktivace',
  myCall: 'OK1CDJ',
  myGrid: 'JN79US',
  defaultSignal: { band: '40m', mode: 'SSB' },
}

describe('sticky state across lines', () => {
  it('band/mode set on one line are inherited by a later bare-callsign line', () => {
    const s0 = initialSticky(meta)

    const l1 = parseLine('20m cw', s0, {}, PROFILES.aktivace)
    expect(l1.sticky).toMatchObject({ band: '20m', mode: 'CW' })

    const l2 = parseLine('OK1ABC', l1.sticky, {}, PROFILES.aktivace)
    // No band/mode token on line 2 → sticky unchanged.
    expect(l2.sticky).toMatchObject({ band: '20m', mode: 'CW' })
    expect(l2.partial.call).toBe('OK1ABC')
  })

  it('seeds band/mode from the log default signal', () => {
    expect(initialSticky(meta)).toMatchObject({ band: '40m', mode: 'SSB' })
  })

  it('leaves the RX variant untouched when band changes', () => {
    const s: typeof meta.defaultSignal = { band: '40m', mode: 'SSB', bandRx: '2m', modeRx: 'FM' }
    const seeded = initialSticky({ ...meta, defaultSignal: s })
    expect(seeded).toEqual({ band: '40m', mode: 'SSB', bandRx: '2m', modeRx: 'FM' })

    const changed = parseLine('20m', seeded, {}, PROFILES.aktivace)
    expect(changed.sticky).toEqual({ band: '20m', mode: 'SSB', bandRx: '2m', modeRx: 'FM' })
  })
})
