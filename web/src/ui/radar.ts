// Radar layer for the VKV QSO map: fetches RainViewer's newest frame and the XYZ
// tiles the view needs, recolours them (core/radar.ts) and draws them under the map.
// Network only while the map is open, visible and the setting is on. A newer frame
// is preloaded in the background and swapped in at once — one redraw, no half-empty
// map (e-ink).

import { RADAR_META_URL, COLOR_PALETTE, EINK_PALETTE, latestFrame, recolor, tileBox, tileUrl, tileZoom, visibleTiles } from '../core/index'
import type { MapView, RadarFrame, RadarPalette, TileRef } from '../core/index'

/** Setting: radar on the VKV map ('1' = on; default OFF — off means no network). */
export const RADAR_SETTING = 'mapRadar'

const POLL_MS = 5 * 60 * 1000

interface ViewSize {
  readonly view: MapView
  readonly w: number
  readonly h: number
}

export class RadarLayer {
  private frame: RadarFrame | undefined
  private readonly tiles = new Map<string, HTMLCanvasElement | null>() // null = no tile (failed)
  private readonly loading = new Set<string>()
  private last: ViewSize | undefined
  private palette = 'color'
  private timer: number | undefined
  private polling = false
  /** True when the last metadata fetch failed and no frame is shown. */
  failed = false

  constructor(private readonly onChange: () => void) {}

  /** Frame time (unix s) of what is drawn, or undefined before the first frame. */
  get time(): number | undefined {
    return this.frame?.time
  }

  start(): void {
    document.addEventListener('visibilitychange', this.onVisibility)
    this.schedule()
    void this.poll()
  }

  stop(): void {
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.clearInterval(this.timer)
    this.timer = undefined
  }

  /** Draw the current frame's tiles for this view; fetch the missing ones (one redraw
   *  via onChange when they have all arrived). */
  draw(ctx: CanvasRenderingContext2D, view: MapView, w: number, h: number, palette: string): void {
    this.last = { view, w, h }
    if (palette !== this.palette) {
      this.palette = palette // display mode switched: recolour from scratch
      this.tiles.clear()
    }
    const frame = this.frame
    if (!frame) return
    const refs = this.needed(this.last)
    ctx.save()
    ctx.imageSmoothingEnabled = false // keep the level steps crisp when a zoom-7 tile is stretched
    for (const t of refs) {
      const img = this.tiles.get(key(frame, t))
      if (!img) continue
      const b = tileBox(t, view, w, h)
      ctx.drawImage(img, b.x, b.y, b.size, b.size)
    }
    ctx.restore()
    const missing = refs.filter((t) => !this.tiles.has(key(frame, t)))
    if (missing.length > 0) void this.load(frame, missing).then((got) => got && this.frame === frame && this.onChange())
  }

  private needed(v: ViewSize): TileRef[] {
    return visibleTiles(v.view, v.w, v.h, tileZoom(v.view.scale))
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      window.clearInterval(this.timer)
      this.timer = undefined
    } else {
      this.schedule()
      void this.poll() // back in front: check right away
    }
  }

  private schedule(): void {
    window.clearInterval(this.timer)
    this.timer = window.setInterval(() => void this.poll(), POLL_MS)
  }

  /** Check for a newer frame; preload its tiles for the last view, then swap. */
  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const res = await fetch(RADAR_META_URL, { cache: 'no-store' })
      const next = res.ok ? latestFrame(await res.json()) : undefined
      if (!next) throw new Error('no frame')
      const wasFailed = this.failed
      this.failed = false
      if (this.frame && next.time <= this.frame.time) {
        if (wasFailed) this.onChange()
        return
      }
      if (this.last) await this.load(next, this.needed(this.last))
      const old = this.frame
      this.frame = next
      if (old) for (const k of Array.from(this.tiles.keys())) if (k.startsWith(`${old.time}/`)) this.tiles.delete(k)
      this.onChange()
    } catch {
      if (!this.frame && !this.failed) {
        this.failed = true
        this.onChange()
      }
    } finally {
      this.polling = false
    }
  }

  /** Fetch and recolour tiles; resolves true when at least one new tile arrived. */
  private async load(frame: RadarFrame, refs: readonly TileRef[]): Promise<boolean> {
    const palette = this.palette === 'eink' ? EINK_PALETTE : COLOR_PALETTE
    const todo = refs.filter((t) => {
      const k = key(frame, t)
      return !this.tiles.has(k) && !this.loading.has(k)
    })
    if (todo.length === 0) return false
    for (const t of todo) this.loading.add(key(frame, t))
    const results = await Promise.all(todo.map((t) => fetchTile(tileUrl(frame, t.z, t.x, t.y), palette)))
    let got = false
    todo.forEach((t, i) => {
      const k = key(frame, t)
      this.loading.delete(k)
      this.tiles.set(k, results[i] ?? null)
      if (results[i]) got = true
    })
    return got
  }
}

function key(frame: RadarFrame, t: TileRef): string {
  return `${frame.time}/${t.z}/${t.x}/${t.y}`
}

/** One tile, recoloured into a 256 px canvas (RainViewer sends CORS *, so the pixels
 *  are readable). Undefined when it can't be fetched or decoded. */
async function fetchTile(url: string, palette: RadarPalette): Promise<HTMLCanvasElement | undefined> {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const bmp = await createImageBitmap(await res.blob())
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return undefined
    g.drawImage(bmp, 0, 0)
    bmp.close()
    const data = g.getImageData(0, 0, c.width, c.height)
    recolor(data.data, palette)
    g.putImageData(data, 0, 0)
    return c
  } catch {
    return undefined
  }
}
