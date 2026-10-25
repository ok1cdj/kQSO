// Offline award references (SOTA, POTA, WWFF, GMA, TOTA, BOTA), one tile per Maidenhead
// field, built by scripts/refdata.py:
//   # kQSO refs | field=JO | updated=2026-10-19
//   SOTA<TAB>OK/KR-001<TAB>50.7359<TAB>15.7398<TAB>Sněžka
// Parks (POTA, WWFF) are a single point, roughly their centre.

import { distanceKm, latLonToGrid } from './locator'
import type { AwardReference, ReferenceKind } from './model'

export interface RefPoint extends AwardReference {
  readonly lat: number
  readonly lon: number
  readonly name: string
}

export interface RefTile {
  readonly field: string // e.g. "JO"
  readonly updated: string // YYYY-MM-DD
  readonly refs: readonly RefPoint[]
}

export interface NearRef extends RefPoint {
  readonly km: number
}

/** The programs, in the order Settings lists them. */
export const REF_PROGRAMS: readonly ReferenceKind[] = ['SOTA', 'GMA', 'POTA', 'WWFF', 'TOTA', 'BOTA']
const KINDS: ReadonlySet<string> = new Set<ReferenceKind>(REF_PROGRAMS)
const FIELD_OR_LOCATOR = /^[A-R]{2}(\d{2}([A-X]{2})?)?$/
const KM_PER_DEG = 111.2

/** A tile's text → references; undefined when the header is missing. Bad rows are skipped. */
export function parseRefTile(text: string): RefTile | undefined {
  const lines = text.split('\n')
  const head = /^# kQSO refs \| field=([A-R]{2}) \| updated=(\d{4}-\d{2}-\d{2})/.exec(lines[0] ?? '')
  if (!head) return undefined
  const refs: RefPoint[] = []
  for (let i = 1; i < lines.length; i++) {
    const [kind, value, lat, lon, name] = lines[i]!.replace(/\r$/, '').split('\t')
    if (!kind || !KINDS.has(kind) || !value) continue
    const la = Number(lat)
    const lo = Number(lon)
    if (lat === '' || lon === '' || !Number.isFinite(la) || !Number.isFinite(lo)) continue
    refs.push({ kind: kind as ReferenceKind, value, lat: la, lon: lo, name: name ?? '' })
  }
  return { field: head[1]!, updated: head[2]!, refs }
}

/** Field (2 letters) a point lies in. */
export function fieldOf(lat: number, lon: number): string {
  return latLonToGrid(lat, lon).slice(0, 2)
}

/** The field with the point plus every neighbouring field closer than km, the
 *  point's own field first. Longitude wraps at ±180°; there is nothing past the poles. */
export function fieldsAround(lat: number, lon: number, km: number): string[] {
  const own = fieldOf(lat, lon)
  const x = own.charCodeAt(0) - 65
  const y = own.charCodeAt(1) - 65
  const out = [own]
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const fy = y + dy
      if ((dx === 0 && dy === 0) || fy < 0 || fy > 17) continue
      // Box edges unwrapped around the point's own field, so the clamp is right across ±180°.
      const w = (x + dx) * 20 - 180
      const s = fy * 10 - 90
      const d = distanceKm(lat, lon, clamp(lat, s, s + 10), clamp(lon, w, w + 20))
      const name = String.fromCharCode(65 + ((x + dx + 18) % 18), 65 + fy)
      if (d < km && !out.includes(name)) out.push(name)
    }
  }
  return out
}

/** References within maxKm of a point, at most perKind of each program (only `kinds`,
 *  when given), nearest first. */
export function nearestRefs(
  tiles: readonly RefTile[],
  lat: number,
  lon: number,
  opts: { maxKm?: number; perKind?: number; kinds?: ReadonlySet<ReferenceKind> } = {},
): NearRef[] {
  const maxKm = opts.maxKm ?? 25
  const perKind = opts.perKind ?? 3
  // Cheap box test first; a tile holds tens of thousands of references.
  const dLat = maxKm / KM_PER_DEG
  const dLon = dLat / Math.max(Math.cos(Math.min(Math.abs(lat) + dLat, 89.9) * (Math.PI / 180)), 1e-6)
  const near: NearRef[] = []
  for (const tile of tiles) {
    for (const r of tile.refs) {
      if (opts.kinds && !opts.kinds.has(r.kind)) continue
      if (Math.abs(r.lat - lat) > dLat) continue
      const lonGap = Math.abs(((r.lon - lon + 540) % 360) - 180)
      if (lonGap > dLon) continue
      const km = distanceKm(lat, lon, r.lat, r.lon)
      if (km <= maxKm) near.push({ ...r, km })
    }
  }
  near.sort((a, b) => a.km - b.km || a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))
  const taken = new Map<string, number>()
  return near.filter((r) => {
    const n = taken.get(r.kind) ?? 0
    taken.set(r.kind, n + 1)
    return n < perKind
  })
}

/** Field typed in Settings: "JO", or a locator ("jo70", "JO70UN") cut to its field. */
export function parseField(input: string): string | undefined {
  const g = input.trim().toUpperCase()
  return FIELD_OR_LOCATOR.test(g) ? g.slice(0, 2) : undefined
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
