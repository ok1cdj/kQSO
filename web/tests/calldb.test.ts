import { describe, it, expect } from 'vitest'
import { LIVE_MAX, LiveDb, baseSource, combineSources, dbDate, mergeEntry, parseDb, serializeDb } from '../src/core/calldb'
import { emptySuggestions } from '../src/core/suggest'

const H = '# kQSO callsign DB | set=user | exported=20260924'

describe('parseDb — tolerant TSV', () => {
  it('reads the header and 1–4 columns; empty fields count as missing', () => {
    const { header, entries } = parseDb(
      [
        '# kQSO callsign DB | set=sat | version=1 | updated=2026-09-24',
        '# a comment',
        'ok1abc\tjn79us',
        'OK2XYZ\tJO70',
        'S57ABC',
        'S57DEF\t\t20260921\t7',
        '',
      ].join('\n'),
    )
    expect(header).toMatchObject({ set: 'sat', version: '1', updated: '2026-09-24' })
    expect(entries).toEqual([
      { call: 'OK1ABC', loc: 'JN79US', count: 0 },
      { call: 'OK2XYZ', loc: 'JO70', count: 0 },
      { call: 'S57ABC', count: 0 },
      { call: 'S57DEF', last: '20260921', count: 7 },
    ])
  })
})

describe('mergeEntry — import rule', () => {
  it('newer LAST wins the locator, counts add up', () => {
    const m = mergeEntry({ call: 'A1A', loc: 'JN79', last: '20250101', count: 2 }, { call: 'A1A', loc: 'JO70', last: '20260101', count: 3 })
    expect(m).toEqual({ call: 'A1A', loc: 'JO70', last: '20260101', count: 5 })
  })
  it('same or missing date keeps the existing record', () => {
    expect(mergeEntry({ call: 'A1A', loc: 'JN79', last: '20260101', count: 1 }, { call: 'A1A', loc: 'JO70', last: '20260101', count: 1 }).loc).toBe('JN79')
    expect(mergeEntry({ call: 'A1A', loc: 'JN79', count: 1 }, { call: 'A1A', loc: 'JO70', count: 0 }).loc).toBe('JN79')
  })
  it('a winner without a locator keeps the other one', () => {
    expect(mergeEntry({ call: 'A1A', loc: 'JN79', last: '20250101', count: 1 }, { call: 'A1A', last: '20260101', count: 1 })).toEqual({
      call: 'A1A',
      loc: 'JN79',
      last: '20260101',
      count: 2,
    })
  })
})

describe('LiveDb', () => {
  it('record: count +1, latest date, newer locator wins, older sighting keeps it', () => {
    const db = new LiveDb()
    db.record('ok1abc', 'JN79US', '20260101')
    db.record('OK1ABC', undefined, '20260201') // no locator this time → keep the known one
    expect(db.get('OK1ABC')).toEqual({ call: 'OK1ABC', loc: 'JN79US', last: '20260201', count: 2 })
    db.record('OK1ABC', 'JO70AA', '20260301')
    db.record('OK1ABC', 'JN00XX', '20250101') // older than what we have → locator stays
    expect(db.get('OK1ABC')).toEqual({ call: 'OK1ABC', loc: 'JO70AA', last: '20260301', count: 4 })
  })

  it('import merges, never replaces; accepts a two-column file', () => {
    const db = LiveDb.fromText(`${H}\nOK1ABC\tJN79US\t20260101\t4\n`)
    db.importText('OK1ABC\tJO70AA\t20260601\t2\nOK2XYZ\tJO70\n')
    expect(db.get('OK1ABC')).toEqual({ call: 'OK1ABC', loc: 'JO70AA', last: '20260601', count: 6 })
    expect(db.get('OK2XYZ')).toEqual({ call: 'OK2XYZ', loc: 'JO70', count: 0 })
  })

  it('roundtrip: export → import into an empty DB → export is identical', () => {
    const db = new LiveDb()
    db.record('OK1ABC', 'JN79US', '20260921')
    db.record('S57ABC', undefined, '20260921')
    db.record('OK2XYZ', 'JO70', '20260614')
    db.record('OK1ABC', undefined, '20260922')
    const out = db.toText(H)
    const back = new LiveDb()
    back.importText(out)
    expect(back.toText(H)).toBe(out)
    expect(out).toBe(`${H}\nOK1ABC\tJN79US\t20260922\t2\nOK2XYZ\tJO70\t20260614\t1\nS57ABC\t\t20260921\t1\n`)
  })

  it(`caps at ${LIVE_MAX}, dropping the oldest sightings`, () => {
    const db = new LiveDb()
    const rows = Array.from({ length: LIVE_MAX + 2 }, (_, i) => `C${i}\t\t${i < 2 ? '20200101' : '20260101'}\t1`)
    db.importText(rows.join('\n'))
    expect(db.size).toBe(LIVE_MAX)
    expect(db.get('C0')).toBeUndefined()
    expect(db.get('C1')).toBeUndefined()
    expect(db.get('C2')).toBeDefined()
  })
})

describe('combineSources — base + live', () => {
  const base = baseSource(
    parseDb('OK1ABC\tJN79US\nOK1AAA\tJO70AA\nOK1BBB\n' + 'F5PYI\t\t\t3\nZL1IM\t\t\t1\n').entries,
  )

  it('lookup: base prefills, own newer record overrides it', () => {
    const live = new LiveDb()
    const db = combineSources(base, live)
    expect(db.lookup('OK1ABC')?.loc).toBe('JN79US')
    live.record('OK1ABC', 'JO60UN', '20260924')
    expect(db.lookup('ok1abc')?.loc).toBe('JO60UN')
  })

  it('lookup: own record without a locator falls back to the base locator', () => {
    const live = new LiveDb()
    live.record('OK1AAA', undefined, '20260924')
    expect(combineSources(base, live).lookup('OK1AAA')).toEqual({ call: 'OK1AAA', loc: 'JO70AA', last: '20260924', count: 1 })
  })

  it('awards-style entries: suggested, but nothing to prefill', () => {
    const db = combineSources(base, new LiveDb())
    expect(db.search('PYI', 3).map((e) => e.call)).toEqual(['F5PYI'])
    expect(db.lookup('F5PYI')?.loc).toBeUndefined()
  })

  it('search orders by own count, then bundled count, prefix, alphabet; dedupes', () => {
    const live = new LiveDb()
    live.record('OK1BBB', undefined, '20260924')
    const db = combineSources(base, live)
    expect(db.search('OK1', 10).map((e) => e.call)).toEqual(['OK1BBB', 'OK1AAA', 'OK1ABC'])
    expect(db.search('1', 10)).toEqual([]) // < 2 chars
    expect(db.search('OK1ABC', 10)).toEqual([]) // exact = already typed
    expect(db.search('5P', 1).map((e) => e.call)).toEqual(['F5PYI'])
    expect(combineSources(base, new LiveDb()).search('L1', 10).map((e) => e.call)).toEqual(['ZL1IM'])
  })

  it('new own call is suggested immediately after recording', () => {
    const live = new LiveDb()
    const db = combineSources(null, live)
    expect(db.search('XY', 3)).toEqual([])
    live.record('OK2XYZ', 'JO70', '20260924')
    expect(db.search('XY', 3).map((e) => e.call)).toEqual(['OK2XYZ'])
  })

  it('byLocator: calls at a locator heard before the call; own locator wins over bundled', () => {
    const live = new LiveDb()
    const db = combineSources(base, live)
    expect(db.byLocator('jo70aa', 3).map((e) => e.call)).toEqual(['OK1AAA'])
    live.record('OK1AAA', 'JO70BB', '20260924') // moved: no longer at JO70AA
    live.record('OK2XYZ', 'JO70AA', '20260924')
    expect(db.byLocator('JO70AA', 3).map((e) => e.call)).toEqual(['OK2XYZ'])
    expect(db.byLocator('JO70BB', 3).map((e) => e.call)).toEqual(['OK1AAA'])
    expect(emptySuggestions.byLocator('JO70AA', 3)).toEqual([])
  })

  it('no base and an empty live layer: nothing, no crash', () => {
    const db = combineSources(null, new LiveDb())
    expect(db.search('OK', 3)).toEqual([])
    expect(db.lookup('OK1ABC')).toBeUndefined()
    expect(emptySuggestions.search('OK', 3)).toEqual([])
  })
})

describe('helpers', () => {
  it('dbDate is UTC YYYYMMDD', () => {
    expect(dbDate(new Date('2026-09-23T23:30:00Z'))).toBe('20260923')
  })
  it('serializeDb writes four columns sorted by call', () => {
    expect(serializeDb([{ call: 'B', count: 1 }, { call: 'A', loc: 'JO70', last: '20260101', count: 2 }], H)).toBe(
      `${H}\nA\tJO70\t20260101\t2\nB\t\t\t1\n`,
    )
  })
})
