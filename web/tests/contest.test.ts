import { describe, it, expect } from 'vitest'
import { gridCenter, qrbKm, qsoPoints } from '../src/core/locator'
import { contestStats, scoreLog } from '../src/core/contest'
import { isDupe } from '../src/core/dupe'
import type { Qso } from '../src/core/model'

describe('locator centre', () => {
  it('6-char square centre', () => {
    const c = gridCenter('JN79US')!
    expect(c.lon).toBeCloseTo(14 + 20 * (2 / 24) + 1 / 24, 6) // J → 0°, 7 → +14°, U = 20th 2/24° column
    expect(c.lat).toBeCloseTo(49 + 18 / 24 + 1 / 48, 6) // N → 40°, 9 → +9°, S = 18th 1/24° row
  })
  it('4-char square centre, case-insensitive, invalid → undefined', () => {
    expect(gridCenter('jo60')).toEqual({ lat: 50.5, lon: 13 })
    expect(gridCenter('ZZ00')).toBeUndefined()
    expect(gridCenter('JO6')).toBeUndefined()
    expect(gridCenter('JO60ZZ')).toBeUndefined()
  })
})

describe('QSO points (IARU R1: trunc(km) + 1)', () => {
  // The worked example of the REG1TEST spec (OZ1FDJ in JO65FR) — every QSO matches.
  const SAMPLE: ReadonlyArray<[string, number]> = [
    ['JO65ER', 6],
    ['JO42LT', 396],
    ['JO55US', 48],
    ['JO40XL', 608],
    ['JO65FR', 1],
    ['IP62OA', 1302],
    ['KP20LG', 891],
    ['IO87WI', 911],
    ['JP70TO', 573],
  ]
  for (const [grid, pts] of SAMPLE) {
    it(`JO65FR → ${grid} = ${pts}`, () => expect(qsoPoints('JO65FR', grid)).toBe(pts))
  }
  it('same square is 1 point; symmetric; invalid → undefined', () => {
    expect(qsoPoints('JN79US', 'JN79US')).toBe(1)
    expect(qrbKm('JN79US', 'JO60UN')).toBeCloseTo(qrbKm('JO60UN', 'JN79US')!, 9)
    expect(qsoPoints('JN79US', 'XX')).toBeUndefined()
  })
})

const T = new Date('2026-09-05T14:00:00Z')
let n = 0
function q(call: string, band: string, mode: string, grid?: string): Qso {
  const base: Qso = {
    call,
    timeOn: new Date(T.getTime() + n++ * 60000),
    signal: { band, mode },
    report: { sent: '59', rcvd: '59' },
    stationCall: 'OK1CDJ',
    myGrid: 'JO65FR',
  }
  return grid ? { ...base, grid } : base
}

describe('scoreLog', () => {
  it('sums points per band, counts large squares, finds the ODX', () => {
    const [b] = scoreLog([q('OZ9SIG', '2m', 'SSB', 'JO65ER'), q('DL5BBF', '2m', 'SSB', 'JO42LT'), q('OY9JD', '2m', 'CW', 'IP62OA')], 'JO65FR')
    expect(b).toMatchObject({ band: '2m', qsos: 3, points: 6 + 396 + 1302, wwls: 3 })
    expect(b!.odx).toEqual({ call: 'OY9JD', grid: 'IP62OA', km: 1302 })
    expect(b!.rows.map((r) => r.newWwl)).toEqual([true, true, true])
  })

  it('a repeat on the same band is a dupe with 0 points, even in another mode', () => {
    const [b] = scoreLog([q('OZ9SIG', '2m', 'SSB', 'JO65ER'), q('OZ9SIG', '2m', 'CW', 'JO65ER')], 'JO65FR')
    expect(b!.rows.map((r) => [r.dupe, r.points])).toEqual([
      [false, 6],
      [true, 0],
    ])
    expect(b).toMatchObject({ qsos: 1, points: 6 })
  })

  it('the same station on another band counts; bands in first-seen order', () => {
    const bands = scoreLog([q('OZ9SIG', '70cm', 'SSB', 'JO65ER'), q('OZ9SIG', '2m', 'SSB', 'JO65ER')], 'JO65FR')
    expect(bands.map((b) => [b.band, b.qsos, b.points])).toEqual([
      ['70cm', 1, 6],
      ['2m', 1, 6],
    ])
  })

  it('new WWL only for the first QSO in a large square', () => {
    const [b] = scoreLog([q('A1AA', '2m', 'SSB', 'JO65ER'), q('B1BB', '2m', 'SSB', 'JO65FR')], 'JO65FR')
    expect(b!.rows.map((r) => r.newWwl)).toEqual([true, false])
    expect(b!.wwls).toBe(1)
  })

  it('a QSO without a locator scores 0 and is not a new WWL', () => {
    const [b] = scoreLog([q('A1AA', '2m', 'SSB')], 'JO65FR')
    expect(b!.rows[0]).toMatchObject({ points: 0, newWwl: false, dupe: false })
    expect(b!.odx).toBeUndefined()
  })
})

describe('isDupe without a mode (VHF contest)', () => {
  it('matches the call on the band in any mode', () => {
    const log = [q('OK1ABC', '2m', 'SSB', 'JN79US')]
    expect(isDupe(log, 'OK1ABC', '2m')).toBe(true)
    expect(isDupe(log, 'OK1ABC', '2m', 'CW')).toBe(false)
    expect(isDupe(log, 'OK1ABC', '70cm')).toBe(false)
  })
})

describe('contestStats', () => {
  it('points, average per QSO and the top list, dupes excluded', () => {
    const bands = scoreLog(
      [q('OZ9SIG', '2m', 'SSB', 'JO65ER'), q('DL5BBF', '2m', 'SSB', 'JO42LT'), q('OZ9SIG', '2m', 'CW', 'JO65ER'), q('OY9JD', '2m', 'CW', 'IP62OA')],
      'JO65FR',
    )
    const s = contestStats(bands)
    expect(s).toMatchObject({ qsos: 3, points: 6 + 396 + 1302, avg: 568 })
    expect(s.top.map((r) => r.qso.call)).toEqual(['OY9JD', 'DL5BBF', 'OZ9SIG'])
  })

  it('total over bands; ties keep log order; at most 10', () => {
    const qsos = [q('DL1AAA', '2m', 'SSB', 'JO42LT'), q('DL1AAA', '70cm', 'SSB', 'JO42LT')]
    for (let i = 0; i < 12; i++) qsos.push(q(`OZ${i}ABC`, '2m', 'SSB', 'JO65ER'))
    const bands = scoreLog(qsos, 'JO65FR')
    const s = contestStats(bands)
    expect(s.qsos).toBe(14)
    expect(s.top).toHaveLength(10)
    expect(s.top.slice(0, 2).map((r) => r.qso.signal.band)).toEqual(['2m', '70cm'])
    expect(contestStats(bands.filter((b) => b.band === '70cm'))).toMatchObject({ qsos: 1, points: 396, avg: 396 })
  })

  it('empty log', () => {
    expect(contestStats([])).toEqual({ qsos: 0, points: 0, avg: 0, top: [] })
  })
})
