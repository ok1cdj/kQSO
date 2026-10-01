// Precipitation radar for the VKV QSO map (rain scatter, 3 cm): RainViewer Weather
// Maps API, the same source and e-ink treatment as kRadar (~/projekty/kRadar,
// RainViewerClient.kt + EinkConverter.kt). Pure: frame metadata, the XYZ tiles a view
// needs, and the recolouring of a tile's pixels. Fetching/drawing lives in ui/radar.ts.
//
// The free plan always serves colour scheme 2 ("Universal Blue", whatever scheme is
// asked) and zoom ≤ 7 (8+ is a "Zoom Level Not Supported" image), so deeper views
// stretch zoom-7 tiles. Unsmoothed tiles (0_0) use exactly the colours of RainViewer's
// table (rainviewer_api_colors_table.csv), so each pixel decodes back to its dBZ; the
// map repaints it in 5 levels. kRadar keys on alpha alone, which only grades the
// light (tan) range: everything from 15 dBZ up is alpha 255 and would be one shade.

import type { MapView } from './mercator'

export const RADAR_META_URL = 'https://api.rainviewer.com/public/weather-maps.json'
export const RADAR_MAX_ZOOM = 7
const TILE_PX = 256

/** The newest past frame: tile base URL ({host}{path}) and its time (unix seconds). */
export interface RadarFrame {
  readonly base: string
  readonly time: number
}

/** Newest `radar.past` frame from weather-maps.json, or undefined when there is none. */
export function latestFrame(meta: unknown): RadarFrame | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const m = meta as { host?: unknown; radar?: { past?: unknown } }
  if (typeof m.host !== 'string' || !Array.isArray(m.radar?.past)) return undefined
  let best: RadarFrame | undefined
  for (const f of m.radar.past as Array<{ path?: unknown; time?: unknown }>) {
    if (typeof f?.path !== 'string' || typeof f.time !== 'number') continue
    if (!best || f.time > best.time) best = { base: m.host + f.path, time: f.time }
  }
  return best
}

/** XYZ tile URL: 256 px, scheme 2, not smoothed and snow as rain (0_0) — so every
 *  pixel is an exact table colour. */
export function tileUrl(frame: RadarFrame, z: number, x: number, y: number): string {
  return `${frame.base}/${TILE_PX}/${z}/${x}/${y}/2/0_0.png`
}

/** Tile zoom for a view: the one whose 256 px tiles are closest to the map's scale,
 *  capped at what the free plan serves. */
export function tileZoom(scale: number): number {
  const z = Math.round(Math.log2(scale / TILE_PX))
  return Math.max(0, Math.min(RADAR_MAX_ZOOM, z))
}

export interface TileRef {
  readonly z: number
  readonly x: number // wrapped into 0…2^z−1 (the request)
  readonly y: number
  readonly col: number // unwrapped column (where it is drawn)
}

/** The tiles covering a w×h view at zoom z (columns wrap around the antimeridian). */
export function visibleTiles(view: MapView, w: number, h: number, z: number): TileRef[] {
  const n = 2 ** z
  const wx0 = view.cx - w / 2 / view.scale
  const wx1 = view.cx + w / 2 / view.scale
  const wy0 = Math.max(0, view.cy - h / 2 / view.scale)
  const wy1 = Math.min(1, view.cy + h / 2 / view.scale)
  const out: TileRef[] = []
  for (let row = Math.floor(wy0 * n); row <= Math.min(n - 1, Math.floor(wy1 * n)); row++) {
    for (let col = Math.floor(wx0 * n); col <= Math.floor(wx1 * n); col++) {
      out.push({ z, x: ((col % n) + n) % n, y: row, col })
    }
  }
  return out
}

/** Pixel box of a tile in the view (the same Web Mercator as the map). */
export function tileBox(t: TileRef, view: MapView, w: number, h: number): { x: number; y: number; size: number } {
  const n = 2 ** t.z
  const size = view.scale / n
  return { x: w / 2 + (t.col / n - view.cx) * view.scale, y: h / 2 + (t.y / n - view.cy) * view.scale, size }
}

// Universal Blue, rain, RRGGBBAA for -10, -9, … 95 dBZ (RainViewer's colour table).
const UB_FIRST_DBZ = -10
const UB_RAIN = (
  '63615914 66635a19 69665c1e 6c685d24 6f6b5f29 726e612e 75706234 78736439 ' +
  '7c75653e 7f786744 827b6949 857d6a4e 88806c54 8b826d59 8e856f5e 92887164 ' +
  '9e93756e aa9e7978 b6a97e82 c2b4828c cec08796 d2c48ba0 d6c88faa dacc93b4 ' +
  'ded097be 88ddeeff 6cd1ebff 51c5e8ff 36bae5ff 1baee2ff 00a3e0ff 009ad5ff ' +
  '0091caff 0088bfff 007fb4ff 0077aaff 0070a3ff 00699cff 006295ff 005b8eff ' +
  '005588ff 005180ff 004e78ff 004a70ff 004768ff ffee00ff ffe000ff ffd200ff ' +
  'ffc500ff ffb700ff ffaa00ff ff9f00ff ff9500ff ff8b00ff ff8100ff ff4400ff ' +
  'f23600ff e62800ff d91b00ff cd0d00ff c10000ff a80000ff 8f0000ff 760000ff ' +
  '5d0000ff ffaaffff ff9fffff ff95ffff ff8bffff ff81ffff ff77ffff ff6cffff ' +
  'ff62ffff ff58ffff ff4effff ffffffff ffffffff ffffffff ffffffff ffffffff ' +
  'ffffffff ffffffff ffffffff ffffffff ffffffff 00ff00ff 00ff00ff 00ff00ff ' +
  '00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff ' +
  '00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff 00ff00ff ' +
  '00ff00ff 00ff00ff '
).trim().split(' ')

const DBZ_BY_RGBA = new Map<number, number>()
UB_RAIN.forEach((hex, i) => {
  const v = parseInt(hex, 16) >>> 0
  if (!DBZ_BY_RGBA.has(v)) DBZ_BY_RGBA.set(v, UB_FIRST_DBZ + i) // repeated top colours → lowest dBZ
})

/** dBZ of a Universal Blue pixel, or undefined (transparent / not a table colour). */
export function pixelDbz(r: number, g: number, b: number, a: number): number | undefined {
  if (a === 0) return undefined
  return DBZ_BY_RGBA.get(((r << 24) | (g << 16) | (b << 8) | a) >>> 0)
}

// Level edges follow RainViewer's own colour bands: tan < 15, blue 15–34 (split at 25),
// yellow/orange 35–44, red and up ≥ 45 dBZ.
const LEVEL_DBZ = [15, 25, 35, 45]

/** Rain level 1 (light) … 5 (heaviest) from dBZ. */
export function rainLevel(dbz: number): number {
  let level = 1
  for (const edge of LEVEL_DBZ) if (dbz >= edge) level++
  return level
}

/** RGBA for levels 1…5. */
export type RadarPalette = readonly (readonly [number, number, number, number])[]

/** E-ink (kRadar's greys): black with opacity 45 → 255, light rain light grey, heavy solid. */
export const EINK_PALETTE: RadarPalette = [0, 1, 2, 3, 4].map((i) => [0, 0, 0, Math.round(45 + (210 * i) / 4)] as const)

/** Colour screens: the usual radar ramp, translucent so the map stays readable. */
export const COLOR_PALETTE: RadarPalette = [
  [120, 200, 255, 120], // light — pale blue
  [40, 170, 60, 150], // green
  [250, 210, 0, 170], // yellow
  [250, 120, 0, 190], // orange
  [220, 0, 60, 210], // red
]

/** Repaint RGBA pixels in place: colour → dBZ → level → palette colour. A pixel that
 *  is no table colour (none expected with 0_0) counts as the lightest level. */
export function recolor(px: Uint8ClampedArray, palette: RadarPalette): void {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]!
    if (a === 0) continue
    const dbz = pixelDbz(px[i]!, px[i + 1]!, px[i + 2]!, a)
    const c = palette[(dbz === undefined ? 1 : rainLevel(dbz)) - 1]!
    px[i] = c[0]
    px[i + 1] = c[1]
    px[i + 2] = c[2]
    px[i + 3] = c[3]
  }
}
