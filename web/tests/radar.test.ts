import { describe, it, expect } from 'vitest'
import {
  COLOR_PALETTE,
  EINK_PALETTE,
  latestFrame,
  pixelDbz,
  rainLevel,
  recolor,
  tileBox,
  tileUrl,
  tileZoom,
  visibleTiles,
} from '../src/core/radar'
import { gridCenter, latLonToGrid } from '../src/core/locator'

describe('RainViewer frames', () => {
  it('picks the newest past frame', () => {
    const meta = {
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [{ time: 100, path: '/v2/radar/a' }, { time: 300, path: '/v2/radar/c' }, { time: 200, path: '/v2/radar/b' }] },
    }
    expect(latestFrame(meta)).toEqual({ base: 'https://tilecache.rainviewer.com/v2/radar/c', time: 300 })
  })
  it('tolerates junk', () => {
    expect(latestFrame(null)).toBeUndefined()
    expect(latestFrame({ host: 'x', radar: {} })).toBeUndefined()
    expect(latestFrame({ host: 'x', radar: { past: [{ path: 1 }] } })).toBeUndefined()
  })
  it('XYZ tile URL', () => {
    expect(tileUrl({ base: 'https://h/v2/radar/c', time: 1 }, 6, 34, 21)).toBe('https://h/v2/radar/c/256/6/34/21/2/0_0.png')
  })
})

describe('tile zoom and coverage', () => {
  it('zoom follows the scale and stops at 7', () => {
    expect(tileZoom(256 * 2 ** 5)).toBe(5)
    expect(tileZoom(256 * 2 ** 6 * 1.3)).toBe(6)
    expect(tileZoom(256 * 2 ** 12)).toBe(7)
    expect(tileZoom(10)).toBe(0)
  })
  it('tiles cover the view and sit where the map draws them', () => {
    const view = { cx: 0.54, cy: 0.33, scale: 256 * 2 ** 6 }
    const tiles = visibleTiles(view, 480, 800, 6)
    expect(tiles.length).toBeGreaterThan(0)
    for (const t of tiles) {
      const b = tileBox(t, view, 480, 800)
      expect(b.size).toBeCloseTo(256, 9)
      expect(b.x + b.size).toBeGreaterThan(0)
      expect(b.x).toBeLessThan(480)
    }
  })
  it('columns wrap around the antimeridian', () => {
    const tiles = visibleTiles({ cx: 0, cy: 0.5, scale: 256 * 4 }, 600, 100, 2)
    expect(tiles.map((t) => t.x)).toContain(3) // col −1 → x 3
    expect(tiles.every((t) => t.x >= 0 && t.x < 4)).toBe(true)
  })
})

describe('dBZ decoding and levels', () => {
  it('Universal Blue colours decode to dBZ (RainViewer table)', () => {
    expect(pixelDbz(0x63, 0x61, 0x59, 0x14)).toBe(-10) // faintest tan
    expect(pixelDbz(0x88, 0xdd, 0xee, 0xff)).toBe(15) // first blue
    expect(pixelDbz(0x00, 0x91, 0xca, 0xff)).toBe(22) // seen in a real tile
    expect(pixelDbz(0xff, 0xee, 0x00, 0xff)).toBe(35) // first yellow
    expect(pixelDbz(0xc1, 0x00, 0x00, 0xff)).toBe(50) // red
    expect(pixelDbz(1, 2, 3, 255)).toBeUndefined()
    expect(pixelDbz(0, 0, 0, 0)).toBeUndefined()
  })
  it('levels follow the colour bands', () => {
    expect([-10, 14, 15, 24, 25, 34, 35, 44, 45, 70].map(rainLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  })
  it("e-ink palette is kRadar's black 45 → 255", () => {
    expect(EINK_PALETTE.map((c) => c[3])).toEqual([45, 98, 150, 203, 255])
    expect(EINK_PALETTE.every((c) => c[0] === 0 && c[1] === 0 && c[2] === 0)).toBe(true)
    expect(COLOR_PALETTE).toHaveLength(5)
  })
  it('recolor keeps dry pixels clear and paints rain by dBZ', () => {
    const px = new Uint8ClampedArray([9, 9, 9, 0, 0x88, 0xdd, 0xee, 0xff, 0xc1, 0, 0, 0xff])
    recolor(px, EINK_PALETTE)
    expect(Array.from(px)).toEqual([9, 9, 9, 0, 0, 0, 0, 98, 0, 0, 0, 255])
  })
})

describe('point → locator', () => {
  it('known squares', () => {
    expect(latLonToGrid(50.0875, 14.4213)).toBe('JO70FC') // Prague
    expect(latLonToGrid(-33.86, 151.21)).toBe('QF56OD') // Sydney
    expect(latLonToGrid(0, 0)).toBe('JJ00AA')
  })
  it('round-trips through the square centre', () => {
    for (const g of ['JN79US', 'IO91WM', 'KP20LE', 'AA00AA', 'RR99XX']) {
      const c = gridCenter(g)!
      expect(latLonToGrid(c.lat, c.lon)).toBe(g)
    }
  })
  it('clamps the poles and the antimeridian', () => {
    expect(latLonToGrid(90, 180)).toBe('RR99XX')
    expect(latLonToGrid(-90, -180)).toBe('AA00AA')
  })
})
