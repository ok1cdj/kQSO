import { describe, it, expect } from 'vitest'
import { SATELLITES, fillSatFrequencies, satelliteByLabel, satelliteSignal } from '../src/core/satellites'
import type { Qso } from '../src/core/model'

describe('satellite database (F3)', () => {
  it('has the expected active satellites incl. AO-7 A/B as two rows of one SAT_NAME', () => {
    const labels = SATELLITES.map((s) => s.label)
    expect(labels).toContain('AO-7 A')
    expect(labels).toContain('AO-7 B')
    expect(labels).toContain('AO-123')
    const ao7 = SATELLITES.filter((s) => s.name === 'AO-7')
    expect(ao7).toHaveLength(2) // same SAT_NAME, different mode
    expect(ao7.map((s) => s.satMode).sort()).toEqual(['A', 'B'])
  })

  it('satelliteSignal maps up→BAND, down→BAND_RX; FM forces FM, linear keeps mode', () => {
    const rs44 = satelliteByLabel('RS-44')!
    expect(satelliteSignal(rs44, 'SSB')).toEqual({ band: '2m', bandRx: '70cm', mode: 'SSB' })
    expect(satelliteSignal(rs44, 'CW')).toEqual({ band: '2m', bandRx: '70cm', mode: 'CW' })

    const so50 = satelliteByLabel('SO-50')!
    expect(satelliteSignal(so50, 'SSB')).toEqual({ band: '2m', bandRx: '70cm', mode: 'FM' }) // FM bird

    const ao7a = satelliteByLabel('AO-7 A')!
    expect(satelliteSignal(ao7a, 'SSB')).toEqual({ band: '2m', bandRx: '10m', mode: 'SSB' })
  })

  it('every satellite has uplink / downlink frequencies inside its bands', () => {
    // Rough band edges in MHz, enough to catch a swapped or mistyped frequency.
    const edges: Record<string, [number, number]> = {
      '10m': [28, 29.7],
      '2m': [144, 146],
      '70cm': [430, 440],
      '13cm': [2300, 2450],
      '3cm': [10000, 10500],
    }
    for (const s of SATELLITES) {
      for (const [band, mhz] of [[s.up, s.upMHz], [s.down, s.downMHz]] as const) {
        const [lo, hi] = edges[band]!
        expect(Number(mhz), `${s.label} ${band}`).toBeGreaterThanOrEqual(lo)
        expect(Number(mhz), `${s.label} ${band}`).toBeLessThanOrEqual(hi)
        expect(mhz, s.label).toMatch(/^\d+\.\d{3}$/)
      }
    }
  })

  it('QO-100 uses the microwave bands', () => {
    const qo = satelliteByLabel('QO-100')!
    expect(satelliteSignal(qo, 'SSB')).toEqual({ band: '13cm', bandRx: '3cm', mode: 'SSB' })
  })
})

describe('fillSatFrequencies (QSOs logged before FREQ was stored)', () => {
  const base: Qso = {
    call: 'OK1ABC',
    timeOn: new Date('2026-09-26T10:00:00Z'),
    signal: { band: '70cm', bandRx: '2m', mode: 'SSB' },
    report: { sent: '59', rcvd: '59' },
    stationCall: 'OK1CDJ',
    myGrid: 'JN79US',
    satName: 'AO-7',
    satMode: 'B',
  }

  it('fills by SAT_NAME + SAT_MODE (AO-7 B, not A)', () => {
    expect(fillSatFrequencies([base])?.[0]?.signal).toEqual({ band: '70cm', bandRx: '2m', mode: 'SSB', freq: '432.150', freqRx: '145.950' })
  })

  it('leaves alone what it cannot be sure of; undefined when nothing changed', () => {
    const { satName: _n, satMode: _m, ...rest } = base
    const plain: Qso = { ...rest, signal: { band: '40m', mode: 'CW' } }
    const done: Qso = { ...base, signal: { ...base.signal, freq: '432.160', freqRx: '145.940' } }
    const otherBand: Qso = { ...base, signal: { band: '2m', bandRx: '70cm', mode: 'SSB' } } // AO-7 B is U/V
    const unknown: Qso = { ...base, satName: 'XO-999' }
    expect(fillSatFrequencies([plain, done, otherBand, unknown])).toBeUndefined()
    const out = fillSatFrequencies([plain, base])!
    expect(out[0]).toBe(plain)
    expect(out[1]?.signal.freq).toBe('432.150')
  })
})
