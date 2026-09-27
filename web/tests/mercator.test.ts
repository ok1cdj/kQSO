import { describe, it, expect } from 'vitest'
import { fitView, panView, project, unproject, zoomView } from '../src/core/mercator'
import { PROFILES } from '../src/core/model'

const W = 480
const H = 700

describe('Web Mercator', () => {
  it('project / unproject round trip', () => {
    const view = { cx: 0.54, cy: 0.33, scale: 4000 }
    for (const [lat, lon] of [[50.08, 14.42], [-33.9, 18.4], [64.1, -21.9]] as const) {
      const p = project(lat, lon, view, W, H)
      const back = unproject(p.x, p.y, view, W, H)
      expect(back.lat).toBeCloseTo(lat, 6)
      expect(back.lon).toBeCloseTo(lon, 6)
    }
  })

  it('fitView puts every point inside the canvas', () => {
    const pts = [{ lat: 50.5, lon: 13 }, { lat: 52.2, lon: 21 }, { lat: 48.2, lon: 16.4 }, { lat: 60.2, lon: 24.9 }]
    const view = fitView(pts, W, H)
    for (const p of pts) {
      const { x, y } = project(p.lat, p.lon, view, W, H)
      expect(x).toBeGreaterThanOrEqual(24 - 1e-6)
      expect(x).toBeLessThanOrEqual(W - 24 + 1e-6)
      expect(y).toBeGreaterThanOrEqual(24 - 1e-6)
      expect(y).toBeLessThanOrEqual(H - 24 + 1e-6)
    }
  })

  it('a single point keeps the minimum span (at least 3° each way, exactly 3° on one axis)', () => {
    const view = fitView([{ lat: 50, lon: 14 }], W, H)
    const lon = unproject(W - 24, H / 2, view, W, H).lon - unproject(24, H / 2, view, W, H).lon
    const lat = unproject(W / 2, 24, view, W, H).lat - unproject(W / 2, H - 24, view, W, H).lat
    expect(Math.min(lon, lat)).toBeCloseTo(3, 1)
    expect(Math.max(lon, lat)).toBeGreaterThanOrEqual(3)
  })

  it('zoom keeps the centre, pan moves it against the drag', () => {
    const view = { cx: 0.5, cy: 0.5, scale: 1000 }
    expect(zoomView(view, 2)).toEqual({ cx: 0.5, cy: 0.5, scale: 2000 })
    expect(panView(view, 100, -50)).toEqual({ cx: 0.4, cy: 0.55, scale: 1000 })
  })
})

describe('map flag', () => {
  it('VKV and Satellite logs have a map, the others not', () => {
    expect([PROFILES.vkv.map, PROFILES.sat.map, PROFILES.aktivace.map, PROFILES.obecny.map]).toEqual([true, true, false, false])
  })
})
