// Offline reference tiles (core/refdb.ts): downloaded per Maidenhead field from
// kqso.ok1cdj.com/refs/ and kept in platform.refTiles. The server learns only the
// field (~1000 km), never the position. Offline, whatever is stored is used.
//
// refs/index.json says which fields exist and when the data was rebuilt; it is
// fetched at most once a day. A stored tile older than the index is fetched again.
// A field missing from the index has no references (sea), which is not an error.

import { parseRefTile, type RefTile } from '../core/refdb'
import type { KQSOPlatform } from '../platform/index'

// VITE_REFS_URL (e.g. http://localhost:8099/) points a dev build at local tiles.
export const REFS_URL: string = import.meta.env.VITE_REFS_URL || 'https://kqso.ok1cdj.com/refs/'

export const REFS_SETTINGS = {
  index: 'refsIndex', // last index.json, as fetched
  indexAt: 'refsIndexAt', // ms of the last successful index fetch
  tiles: 'refsTiles', // {"JO": {"updated": "2026-10-19", "count": 30752}} of the stored tiles
} as const

const DAY_MS = 24 * 60 * 60 * 1000

export interface RefIndex {
  readonly updated: string
  readonly fields: Readonly<Record<string, { readonly count: number; readonly bytes: number }>>
}

export interface StoredTile {
  readonly field: string
  readonly updated: string
  readonly count: number
}

export interface TilesResult {
  readonly tiles: RefTile[] // stored or freshly downloaded
  readonly missing: string[] // fields with no data here and none downloadable now
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

// Parsed tiles, so a second tap doesn't re-read megabytes. Keyed by field; replaced
// when a newer tile is stored.
const parsed = new Map<string, RefTile>()

/** Tiles for these fields: stored ones, refreshed or downloaded when the network allows. */
export async function ensureTiles(
  platform: KQSOPlatform,
  fields: readonly string[],
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<TilesResult> {
  const store = platform.refTiles
  if (!store) return { tiles: [], missing: [...fields] }
  const get = opts.fetch ?? ((url, init) => fetch(url, init))
  const index = await currentIndex(platform, get, opts.now ?? Date.now())
  const tiles: RefTile[] = []
  const missing: string[] = []
  for (const field of fields) {
    let tile = await storedTile(platform, field)
    const known = index?.fields[field]
    if (index && !known) {
      // No references in this field; drop a leftover from an older build.
      if (tile) await removeTile(platform, field)
      continue
    }
    if (!tile || (index && tile.updated < index.updated)) {
      tile = (await download(platform, get, field, index?.updated)) ?? tile
    }
    if (tile) tiles.push(tile)
    else missing.push(field)
  }
  return { tiles, missing }
}

/** Download one field now (Settings: "Download area"); false when it failed or has no references. */
export async function downloadTile(platform: KQSOPlatform, field: string, opts: { fetch?: Fetch } = {}): Promise<boolean> {
  return (await download(platform, opts.fetch ?? ((url, init) => fetch(url, init)), field, undefined)) !== undefined
}

/** Stored tiles for Settings, by field. */
export async function storedTiles(platform: KQSOPlatform): Promise<StoredTile[]> {
  const store = platform.refTiles
  if (!store) return []
  const meta = await tileMeta(platform)
  const fields = (await store.list()).sort()
  return fields.map((field) => ({ field, updated: meta[field]?.updated ?? '', count: meta[field]?.count ?? 0 }))
}

export async function removeTile(platform: KQSOPlatform, field: string): Promise<void> {
  await platform.refTiles?.remove(field)
  parsed.delete(field)
  const meta = await tileMeta(platform)
  delete meta[field]
  await platform.setSetting(REFS_SETTINGS.tiles, JSON.stringify(meta))
}

async function currentIndex(platform: KQSOPlatform, get: Fetch, now: number): Promise<RefIndex | undefined> {
  let index = parseIndex(await platform.getSetting(REFS_SETTINGS.index))
  const at = Number(await platform.getSetting(REFS_SETTINGS.indexAt)) || 0
  if (!index || now - at > DAY_MS) {
    const text = await fetchText(get, `${REFS_URL}index.json`, { cache: 'no-cache' })
    const fresh = parseIndex(text)
    if (fresh && text) {
      index = fresh
      await platform.setSetting(REFS_SETTINGS.index, text)
      await platform.setSetting(REFS_SETTINGS.indexAt, String(now))
    }
  }
  return index
}

async function storedTile(platform: KQSOPlatform, field: string): Promise<RefTile | undefined> {
  const cached = parsed.get(field)
  if (cached) return cached
  const text = await platform.refTiles!.read(field)
  const tile = text ? parseRefTile(text) : undefined
  if (tile?.field === field) {
    parsed.set(field, tile)
    return tile
  }
  return undefined
}

async function download(platform: KQSOPlatform, get: Fetch, field: string, updated: string | undefined): Promise<RefTile | undefined> {
  // The rebuild date in the URL keeps a browser / CDN cache from serving last week's tile.
  const text = await fetchText(get, `${REFS_URL}${field}.tsv${updated ? `?u=${updated}` : ''}`)
  const tile = text ? parseRefTile(text) : undefined
  if (!text || tile?.field !== field) return undefined
  await platform.refTiles!.write(field, text)
  parsed.set(field, tile)
  const meta = await tileMeta(platform)
  meta[field] = { updated: tile.updated, count: tile.refs.length }
  await platform.setSetting(REFS_SETTINGS.tiles, JSON.stringify(meta))
  return tile
}

async function fetchText(get: Fetch, url: string, init?: RequestInit): Promise<string | undefined> {
  try {
    const res = await get(url, init)
    return res.ok ? await res.text() : undefined
  } catch {
    return undefined // offline
  }
}

export function parseIndex(text: string | null | undefined): RefIndex | undefined {
  if (!text) return undefined
  try {
    const o = JSON.parse(text) as Partial<RefIndex>
    return typeof o.updated === 'string' && o.fields && typeof o.fields === 'object' ? (o as RefIndex) : undefined
  } catch {
    return undefined
  }
}

async function tileMeta(platform: KQSOPlatform): Promise<Record<string, { updated: string; count: number }>> {
  try {
    const o = JSON.parse((await platform.getSetting(REFS_SETTINGS.tiles)) ?? '{}') as unknown
    return o && typeof o === 'object' ? (o as Record<string, { updated: string; count: number }>) : {}
  } catch {
    return {}
  }
}

/** Tests: forget the parsed tiles between cases. */
export function clearParsedTiles(): void {
  parsed.clear()
}
