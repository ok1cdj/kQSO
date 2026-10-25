import { beforeEach, describe, it, expect } from 'vitest'
import { MemoryPlatform } from '../../src/platform/memory'
import { REFS_SETTINGS, REFS_URL, clearParsedTiles, downloadTile, ensureTiles, programsOn, removeTile, setProgramOn, storedTiles } from '../../src/ui/refsync'

const tile = (field: string, updated: string, ref = 'OK/KR-001'): string =>
  `# kQSO refs | field=${field} | updated=${updated}\nSOTA\t${ref}\t50.7359\t15.7398\tSněžka\n`
const index = (updated: string, fields: string[]): string =>
  JSON.stringify({ updated, fields: Object.fromEntries(fields.map((f) => [f, { count: 1, bytes: 60 }])) })

/** A fake server: path → body; records the requested URLs. Undefined server = offline. */
function server(files: Record<string, string> | undefined) {
  const urls: string[] = []
  const fetch = async (url: string): Promise<Response> => {
    urls.push(url.replace(REFS_URL, ''))
    if (!files) throw new TypeError('Failed to fetch')
    const body = files[url.replace(REFS_URL, '').replace(/\?.*$/, '')]
    return body === undefined ? new Response('<!doctype html>404', { status: 404 }) : new Response(body)
  }
  return { fetch, urls }
}

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => clearParsedTiles())

describe('ensureTiles', () => {
  it('downloads missing tiles, skips fields the index does not have', async () => {
    const p = new MemoryPlatform()
    const s = server({ 'index.json': index('2026-10-19', ['JO', 'JN']), 'JO.tsv': tile('JO', '2026-10-19'), 'JN.tsv': tile('JN', '2026-10-19', 'OK/ST-019') })
    const r = await ensureTiles(p, ['JO', 'IO', 'JN'], { fetch: s.fetch, now: 10 * DAY })
    expect(r.tiles.map((t) => t.field)).toEqual(['JO', 'JN'])
    expect(r.missing).toEqual([])
    expect(s.urls).toEqual(['index.json', 'JO.tsv?u=2026-10-19', 'JN.tsv?u=2026-10-19'])
    expect(await storedTiles(p)).toEqual([
      { field: 'JN', updated: '2026-10-19', count: 1 },
      { field: 'JO', updated: '2026-10-19', count: 1 },
    ])
  })

  it('uses stored tiles without the network; the index at most once a day', async () => {
    const p = new MemoryPlatform()
    const files = { 'index.json': index('2026-10-19', ['JO']), 'JO.tsv': tile('JO', '2026-10-19') }
    await ensureTiles(p, ['JO'], { fetch: server(files).fetch, now: 10 * DAY })
    clearParsedTiles() // as after a restart
    const s = server(files)
    const r = await ensureTiles(p, ['JO'], { fetch: s.fetch, now: 10 * DAY + DAY / 2 })
    expect(r.tiles).toHaveLength(1)
    expect(s.urls).toEqual([])
  })

  it('refreshes a tile older than a newer index', async () => {
    const p = new MemoryPlatform()
    await ensureTiles(p, ['JO'], { fetch: server({ 'index.json': index('2026-10-19', ['JO']), 'JO.tsv': tile('JO', '2026-10-19') }).fetch, now: 10 * DAY })
    const s = server({ 'index.json': index('2026-10-26', ['JO']), 'JO.tsv': tile('JO', '2026-10-26', 'OK/KR-002') })
    const r = await ensureTiles(p, ['JO'], { fetch: s.fetch, now: 12 * DAY })
    expect(s.urls).toEqual(['index.json', 'JO.tsv?u=2026-10-26'])
    expect(r.tiles[0]!.refs[0]!.value).toBe('OK/KR-002')
    expect((await storedTiles(p))[0]!.updated).toBe('2026-10-26')
  })

  it('offline: stored tiles are used, the rest is missing', async () => {
    const p = new MemoryPlatform()
    await ensureTiles(p, ['JO'], { fetch: server({ 'index.json': index('2026-10-19', ['JO', 'JN']), 'JO.tsv': tile('JO', '2026-10-19') }).fetch, now: 10 * DAY })
    const r = await ensureTiles(p, ['JO', 'JN'], { fetch: server(undefined).fetch, now: 20 * DAY })
    expect(r.tiles.map((t) => t.field)).toEqual(['JO'])
    expect(r.missing).toEqual(['JN'])
  })

  it('offline with no index yet: everything missing, nothing stored', async () => {
    const p = new MemoryPlatform()
    const r = await ensureTiles(p, ['JO'], { fetch: server(undefined).fetch })
    expect(r).toEqual({ tiles: [], missing: ['JO'] })
    expect(await p.refTiles.list()).toEqual([])
    expect(await p.getSetting(REFS_SETTINGS.indexAt)).toBeNull()
  })

  it('an error page or a tile for another field is not stored', async () => {
    const p = new MemoryPlatform()
    const s = server({ 'index.json': index('2026-10-19', ['JO', 'JN']), 'JN.tsv': tile('JO', '2026-10-19') })
    const r = await ensureTiles(p, ['JO', 'JN'], { fetch: s.fetch, now: 10 * DAY })
    expect(r.missing).toEqual(['JO', 'JN'])
    expect(await p.refTiles.list()).toEqual([])
  })

  it('a host without tile storage', async () => {
    const p = Object.assign(new MemoryPlatform(), { refTiles: undefined })
    expect(await ensureTiles(p, ['JO'])).toEqual({ tiles: [], missing: ['JO'] })
  })
})

describe('downloadTile / removeTile', () => {
  it('downloads one field on demand and removes it again', async () => {
    const p = new MemoryPlatform()
    const s = server({ 'JN.tsv': tile('JN', '2026-10-19') })
    expect(await downloadTile(p, 'JN', { fetch: s.fetch })).toBe(true)
    expect(await downloadTile(p, 'IO', { fetch: s.fetch })).toBe(false)
    expect((await storedTiles(p)).map((t) => t.field)).toEqual(['JN'])
    await removeTile(p, 'JN')
    expect(await storedTiles(p)).toEqual([])
    expect(await p.getSetting(REFS_SETTINGS.tiles)).toBe('{}')
  })
})

describe('programs offered nearby', () => {
  it('all by default; off ones are kept, so a program added later is on', async () => {
    const p = new MemoryPlatform()
    expect([...(await programsOn(p))]).toEqual(['SOTA', 'GMA', 'POTA', 'WWFF', 'TOTA', 'BOTA'])
    await setProgramOn(p, 'BOTA', false)
    await setProgramOn(p, 'GMA', false)
    expect(await p.getSetting(REFS_SETTINGS.off)).toBe('["GMA","BOTA"]')
    expect([...(await programsOn(p))]).toEqual(['SOTA', 'POTA', 'WWFF', 'TOTA'])
    await setProgramOn(p, 'GMA', true)
    expect((await programsOn(p)).has('GMA')).toBe(true)
    await p.setSetting(REFS_SETTINGS.off, 'broken')
    expect((await programsOn(p)).size).toBe(6)
  })
})
