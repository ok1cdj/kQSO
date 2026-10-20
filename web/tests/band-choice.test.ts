import { describe, it, expect } from 'vitest'
import { ALL_BANDS, chooseBand, logBands, shownBand } from '../src/ui/band-choice'
import type { Qso } from '../src/core/model'

const q = (band: string): Qso => ({
  call: 'OK1ABC',
  timeOn: new Date(Date.UTC(2026, 8, 5, 14)),
  signal: { band, mode: 'SSB' },
  report: { sent: '59', rcvd: '59' },
  stationCall: 'OK1CDJ',
  myGrid: 'JN79US',
})

describe('band filter', () => {
  it('bands in band-plan order, each once', () => {
    expect(logBands([q('23cm'), q('2m'), q('70cm'), q('2m')])).toEqual(['2m', '70cm', '23cm'])
  })
  it('a one-band log shows everything', () => {
    expect(shownBand('a', [q('2m'), q('2m')])).toBe(ALL_BANDS)
    expect(shownBand('a', [])).toBe(ALL_BANDS)
  })
  it('first the band of the last QSO, then the choice for that log', () => {
    const log = [q('2m'), q('70cm')]
    expect(shownBand('b', log)).toBe('70cm')
    chooseBand('b', '2m')
    expect(shownBand('b', log)).toBe('2m')
    expect(shownBand('c', log)).toBe('70cm') // another log keeps its own
    chooseBand('b', ALL_BANDS)
    expect(shownBand('b', log)).toBe(ALL_BANDS)
  })
  it('a chosen band the log no longer has falls back to the last QSO', () => {
    chooseBand('d', '23cm')
    expect(shownBand('d', [q('2m'), q('70cm')])).toBe('70cm')
  })
})
