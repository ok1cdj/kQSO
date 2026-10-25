import { describe, it, expect } from 'vitest'
import { fieldOf, fieldsAround, nearestRefs, parseField, parseRefTile, type RefTile } from '../src/core/refdb'
import { distanceKm, gridCenter, qrbKm } from '../src/core/locator'

const JO = [
  '# kQSO refs | field=JO | updated=2026-10-19',
  'SOTA\tOK/KR-001\t50.7359\t15.7398\tSněžka',
  'SOTA\tOK/KR-002\t50.7700\t15.5400\tNear peak',
  'SOTA\tOK/KR-003\t50.7400\t15.7000\tNearer peak',
  'SOTA\tOK/KR-004\t50.7500\t15.7300\tAnother',
  'WWFF\tOKFF-0001\t50.8827\t14.4175\tNarodni park Ceske Svycarsko',
  'POTA\tCZ-0010\t50.7000\t15.6000\tKrkonoše National Park',
  'XXXX\tBAD-1\t50\t15\tunknown program',
  'SOTA\tOK/KR-099\tnope\t15\tbad latitude',
  'SOTA\tOK/KR-098\t\t15\tempty latitude',
  '',
].join('\n')

describe('parseRefTile', () => {
  it('reads the header and the valid rows, skipping bad ones', () => {
    const t = parseRefTile(JO)!
    expect(t.field).toBe('JO')
    expect(t.updated).toBe('2026-10-19')
    expect(t.refs).toHaveLength(6)
    expect(t.refs[0]).toEqual({ kind: 'SOTA', value: 'OK/KR-001', lat: 50.7359, lon: 15.7398, name: 'Sněžka' })
  })
  it('CRLF and a missing name', () => {
    const t = parseRefTile('# kQSO refs | field=JN | updated=2026-10-19\r\nTOTA\tOKR-1001\t49.6418\t14.8732\r\n')!
    expect(t.refs).toEqual([{ kind: 'TOTA', value: 'OKR-1001', lat: 49.6418, lon: 14.8732, name: '' }])
    const b = parseRefTile('# kQSO refs | field=JO | updated=2026-10-25\nBOTA\tB/OK-0001\t49.9301\t18.3536\tMO-S 2 U skoly\n')!
    expect(b.refs[0]).toMatchObject({ kind: 'BOTA', value: 'B/OK-0001', name: 'MO-S 2 U skoly' })
  })
  it('rejects text without the header (an HTML error page)', () => {
    expect(parseRefTile('<!doctype html><title>404</title>')).toBeUndefined()
    expect(parseRefTile('')).toBeUndefined()
  })
})

describe('distanceKm', () => {
  it('matches qrbKm between locator centres', () => {
    const a = gridCenter('JO70UN')!
    const b = gridCenter('JN79US')!
    expect(distanceKm(a.lat, a.lon, b.lat, b.lon)).toBeCloseTo(qrbKm('JO70UN', 'JN79US')!, 9)
  })
  it('one degree of latitude is 111.2 km; zero for the same point', () => {
    expect(distanceKm(50, 15, 51, 15)).toBeCloseTo(111.2, 6)
    expect(distanceKm(50, 15, 50, 15)).toBe(0)
  })
})

describe('fieldsAround', () => {
  it('only the own field far from any edge', () => {
    expect(fieldOf(50.7359, 15.7398)).toBe('JO')
    expect(fieldsAround(55, 10, 25)).toEqual(['JO'])
  })
  it('the neighbour across a nearby edge', () => {
    // Krkonoše, ~80 km north of the JN/JO line at 50°N: only with a larger radius.
    expect(fieldsAround(50.7359, 15.7398, 25)).toEqual(['JO'])
    expect(fieldsAround(50.7359, 15.7398, 100)).toEqual(['JO', 'JN'])
    // Just south of 50°N in JN.
    expect(fieldsAround(49.9, 14.4, 25)).toEqual(['JN', 'JO'])
  })
  it('a corner adds three neighbours', () => {
    expect(fieldsAround(50.05, 19.95, 25).sort()).toEqual(['JN', 'JO', 'KN', 'KO'])
  })
  it('wraps around 180° longitude and stops at the poles', () => {
    expect(fieldsAround(-41, 179.95, 25).sort()).toEqual(['AE', 'RE'])
    // Near the pole the meridians converge, so the side neighbours are close; no row past R.
    expect(fieldsAround(89.95, 10, 25).sort()).toEqual(['IR', 'JR', 'KR'])
  })
})

describe('nearestRefs', () => {
  const tile = parseRefTile(JO)!
  it('within maxKm, nearest first, at most perKind per program', () => {
    const r = nearestRefs([tile], 50.7359, 15.7398, { maxKm: 25, perKind: 2 })
    expect(r.map((x) => x.value)).toEqual(['OK/KR-001', 'OK/KR-004', 'CZ-0010'])
    expect(r[0]!.km).toBe(0)
    expect(r[2]!.kind).toBe('POTA')
  })
  it('defaults: 25 km and 3 per program; WWFF 90 km away is left out', () => {
    const r = nearestRefs([tile], 50.7359, 15.7398)
    expect(r.filter((x) => x.kind === 'SOTA')).toHaveLength(3)
    expect(r.some((x) => x.kind === 'WWFF')).toBe(false)
  })
  it('only the chosen programs', () => {
    const r = nearestRefs([tile], 50.7359, 15.7398, { kinds: new Set(['POTA'] as const) })
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => x.kind === 'POTA')).toBe(true)
    expect(nearestRefs([tile], 50.7359, 15.7398, { kinds: new Set() })).toEqual([])
  })
  it('nothing near', () => {
    expect(nearestRefs([tile], 55, 10)).toEqual([])
    expect(nearestRefs([], 50.7, 15.7)).toEqual([])
  })
  it('across 180° longitude', () => {
    const t: RefTile = {
      field: 'AE',
      updated: '2026-10-19',
      refs: [{ kind: 'POTA', value: 'ZL-0001', lat: -41, lon: -179.95, name: 'x' }],
    }
    const r = nearestRefs([t], -41, 179.95)
    expect(r).toHaveLength(1)
    expect(r[0]!.km).toBeCloseTo(8.4, 0)
  })
})

describe('parseField', () => {
  it('a field or a locator cut to its field', () => {
    expect(parseField('jo')).toBe('JO')
    expect(parseField(' JN69 ')).toBe('JN')
    expect(parseField('jo70un')).toBe('JO')
  })
  it('rejects the rest', () => {
    expect(parseField('ZZ')).toBeUndefined()
    expect(parseField('J')).toBeUndefined()
    expect(parseField('JO7')).toBeUndefined()
    expect(parseField('')).toBeUndefined()
  })
})
