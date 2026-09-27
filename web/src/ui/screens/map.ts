// QSO map (VKV contest, Satellite): a dot per QSO at its locator (with the call once
// there is room), the Maidenhead grid and the own QTH over Natural Earth coastlines
// and borders (web/src/db/world.json — 1:10m Europe, 1:50m elsewhere — built by
// web/scripts/mapdata.py). Canvas, Web Mercator (core/mercator.ts). E-ink friendly:
// a drag only shifts the canvas and the map is redrawn once on release; zoom by buttons.

import { fitView, gridCenter, panView, project, readLogFile, unproject, zoomView } from '../../core/index'
import type { LatLon, LogMeta, MapView, Qso } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { t } from '../i18n'
import worldText from '../../db/world.json?raw'

/** Setting: calls next to the dots on the map ('0' = off; default on). */
export const MAP_LABELS_SETTING = 'mapLabels'

export interface MapNav {
  back(): void
}

interface Line {
  readonly pts: Float32Array // lon, lat, lon, lat…
  readonly west: number
  readonly east: number
  readonly south: number
  readonly north: number
}

interface World {
  readonly coast: readonly Line[]
  readonly border: readonly Line[]
}

interface QsoPoint extends LatLon {
  readonly call: string
}

let world: World | undefined

/** Decode the delta-encoded 0.01° lines (mapdata.py) with their bounding boxes, once. */
function loadWorld(): World {
  if (world) return world
  const raw = JSON.parse(worldText) as { coast: number[][]; border: number[][] }
  const decode = (enc: number[]): Line => {
    const pts = new Float32Array(enc.length)
    let lon = 0
    let lat = 0
    let west = 180
    let east = -180
    let south = 90
    let north = -90
    for (let i = 0; i < enc.length; i += 2) {
      lon += enc[i]!
      lat += enc[i + 1]!
      const x = lon / 100
      const y = lat / 100
      pts[i] = x
      pts[i + 1] = y
      west = Math.min(west, x)
      east = Math.max(east, x)
      south = Math.min(south, y)
      north = Math.max(north, y)
    }
    return { pts, west, east, south, north }
  }
  world = { coast: raw.coast.map(decode), border: raw.border.map(decode) }
  return world
}

const ZOOM = 2
const SQUARE_MIN_PX = 60 // show the 2°×1° squares once one is at least this wide
const MAX_LABELS = 80

export class MapScreen implements Screen {
  private readonly root = el('div', 'screen screen--map')
  private readonly wrap = el('div', 'map-wrap')
  private readonly canvas = el('canvas', 'map-canvas')
  private meta: LogMeta | undefined
  private points: QsoPoint[] = []
  private view: MapView | undefined
  private labels = true
  private resize: ResizeObserver | undefined
  private drag: { id: number; x: number; y: number; dx: number; dy: number } | undefined

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly logId: string,
    private readonly nav: MapNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.load()
  }

  unmount(): void {
    this.resize?.disconnect()
  }

  private async load(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))
    this.meta = meta
    this.labels = (await this.platform.getSetting(MAP_LABELS_SETTING)) !== '0'
    this.points = qsoPoints(qsos)
    const noGrid = qsos.length - qsos.filter((q) => q.grid && gridCenter(q.grid)).length

    const bar = el('div', 'bar')
    bar.append(
      button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'),
      el('b', 'title', `${meta.name} · ${qsos.length} QSO`),
      button('−', () => this.zoom(1 / ZOOM), 'btn btn--small'),
      button('+', () => this.zoom(ZOOM), 'btn btn--small'),
      button('⤢', () => this.fit(), 'btn btn--small'),
    )
    const note = noGrid > 0 ? [el('div', 'qsosum', t('map.noGrid', { n: noGrid }))] : []
    this.wrap.replaceChildren(this.canvas)
    this.root.replaceChildren(bar, ...note, this.wrap)

    this.canvas.addEventListener('pointerdown', (e) => this.dragStart(e))
    this.canvas.addEventListener('pointermove', (e) => this.dragMove(e))
    this.canvas.addEventListener('pointerup', (e) => this.dragEnd(e))
    this.canvas.addEventListener('pointercancel', (e) => this.dragEnd(e))

    this.resize = new ResizeObserver(() => this.draw())
    this.resize.observe(this.wrap)
  }

  /** Own QTH + every QSO — what the initial view must show. */
  private fitPoints(): LatLon[] {
    const own = this.meta ? gridCenter(this.meta.myGrid) : undefined
    return own ? [own, ...this.points] : this.points
  }

  private fit(): void {
    const { w, h } = this.size()
    this.view = fitView(this.fitPoints(), w, h)
    this.draw()
  }

  private zoom(factor: number): void {
    if (!this.view) return
    this.view = zoomView(this.view, factor)
    this.draw()
  }

  private size(): { w: number; h: number } {
    return { w: this.wrap.clientWidth, h: this.wrap.clientHeight }
  }

  // --- drag: shift the canvas while moving, redraw once on release -----------

  private dragStart(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId)
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
  }

  private dragMove(e: PointerEvent): void {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    d.dx = e.clientX - d.x
    d.dy = e.clientY - d.y
    this.canvas.style.transform = `translate(${d.dx}px, ${d.dy}px)`
  }

  private dragEnd(e: PointerEvent): void {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    this.drag = undefined
    this.canvas.style.transform = ''
    if (this.view && (d.dx !== 0 || d.dy !== 0)) {
      this.view = panView(this.view, d.dx, d.dy)
      this.draw()
    }
  }

  // --- drawing ---------------------------------------------------------------

  private draw(): void {
    const { w, h } = this.size()
    if (w === 0 || h === 0 || !this.meta) return
    if (!this.view) this.view = fitView(this.fitPoints(), w, h)
    const view = this.view

    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Colours from the theme tokens, so e-ink / light / dark all follow the display mode.
    const css = getComputedStyle(this.root)
    const fg = css.getPropertyValue('--fg').trim() || '#000'
    const bg = css.getPropertyValue('--bg').trim() || '#fff'
    const ghost = css.getPropertyValue('--ghost').trim() || '#777'
    const font = css.fontFamily

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    const nw = unproject(0, 0, view, w, h)
    const se = unproject(w, h, view, w, h)
    const vis = { west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }
    const px = (lat: number, lon: number): { x: number; y: number } => project(lat, lon, view, w, h)

    // Maidenhead grid: fields (20°×10°) always, squares (2°×1°) once they are big enough.
    const squares = project(0, 2, view, w, h).x - project(0, 0, view, w, h).x >= SQUARE_MIN_PX
    ctx.strokeStyle = ghost
    ctx.fillStyle = ghost
    ctx.lineWidth = 1
    ctx.setLineDash([1, 3])
    ctx.beginPath()
    const stepLon = squares ? 2 : 20
    const stepLat = squares ? 1 : 10
    const lon0 = Math.max(-180, Math.floor(vis.west / stepLon) * stepLon)
    const lat0 = Math.max(-90, Math.floor(vis.south / stepLat) * stepLat)
    for (let lon = lon0; lon <= Math.min(180, vis.east); lon += stepLon) {
      const x = Math.round(px(0, lon).x) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
    }
    for (let lat = lat0; lat <= Math.min(90, vis.north); lat += stepLat) {
      const y = Math.round(px(lat, 0).y) + 0.5
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `11px ${font}`
    ctx.textBaseline = 'top'
    for (let lon = lon0; lon < Math.min(180, vis.east); lon += stepLon) {
      for (let lat = lat0; lat < Math.min(90, vis.north); lat += stepLat) {
        const label = squares ? squareName(lat, lon) : squareName(lat, lon).slice(0, 2)
        const p = px(lat + stepLat, lon)
        ctx.fillText(label, p.x + 3, p.y + 3)
      }
    }

    // Coastlines solid, land borders thinner and dashed.
    const strokeLines = (lines: readonly Line[]): void => {
      ctx.beginPath()
      for (const l of lines) {
        if (l.east < vis.west || l.west > vis.east || l.north < vis.south || l.south > vis.north) continue
        let last = px(l.pts[1]!, l.pts[0]!)
        ctx.moveTo(last.x, last.y)
        const n = l.pts.length
        for (let i = 2; i < n; i += 2) {
          const p = px(l.pts[i + 1]!, l.pts[i]!)
          // Skip sub-pixel steps (except the last point) — cleaner lines, faster redraw.
          if (i < n - 2 && Math.abs(p.x - last.x) < 0.8 && Math.abs(p.y - last.y) < 0.8) continue
          ctx.lineTo(p.x, p.y)
          last = p
        }
      }
      ctx.stroke()
    }
    const map = loadWorld()
    ctx.strokeStyle = fg
    ctx.lineJoin = 'round'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    strokeLines(map.border)
    ctx.setLineDash([])
    ctx.lineWidth = 1.6
    strokeLines(map.coast)

    // QSO dots with a halo, so they stand out on the lines.
    for (const q of this.points) {
      const p = px(q.lat, q.lon)
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4.5, 0, 2 * Math.PI)
      ctx.fillStyle = bg
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI)
      ctx.fillStyle = fg
      ctx.fill()
    }
    if (this.labels) this.drawLabels(ctx, px, w, h, fg, bg, font)

    // Own QTH: a ring with a cross.
    const own = gridCenter(this.meta.myGrid)
    if (own) {
      const p = px(own.lat, own.lon)
      ctx.fillStyle = bg
      ctx.strokeStyle = fg
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(p.x - 11, p.y)
      ctx.lineTo(p.x + 11, p.y)
      ctx.moveTo(p.x, p.y - 11)
      ctx.lineTo(p.x, p.y + 11)
      ctx.stroke()
    }
  }

  /** Call next to each dot where it fits: greedy, first come first placed, no overlaps. */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    px: (lat: number, lon: number) => { x: number; y: number },
    w: number,
    h: number,
    fg: string,
    bg: string,
    font: string,
  ): void {
    ctx.font = `bold 12px ${font}`
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
    // The dots themselves are obstacles too.
    for (const q of this.points) {
      const p = px(q.lat, q.lon)
      placed.push({ x0: p.x - 5, y0: p.y - 5, x1: p.x + 5, y1: p.y + 5 })
    }
    const own = this.meta ? gridCenter(this.meta.myGrid) : undefined
    if (own) {
      const p = px(own.lat, own.lon)
      placed.push({ x0: p.x - 12, y0: p.y - 12, x1: p.x + 12, y1: p.y + 12 })
    }
    const seen = new Set<string>()
    let count = 0
    for (const q of this.points) {
      if (count >= MAX_LABELS) break
      const key = `${q.call}@${q.lat},${q.lon}`
      if (seen.has(key)) continue
      seen.add(key)
      const p = px(q.lat, q.lon)
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue
      const tw = ctx.measureText(q.call).width
      // Try right, left, above, below the dot.
      const spots = [
        { x: p.x + 7, y: p.y },
        { x: p.x - 7 - tw, y: p.y },
        { x: p.x - tw / 2, y: p.y - 13 },
        { x: p.x - tw / 2, y: p.y + 13 },
      ]
      for (const s of spots) {
        const box = { x0: s.x - 2, y0: s.y - 7, x1: s.x + tw + 2, y1: s.y + 7 }
        if (box.x0 < 0 || box.x1 > w || box.y0 < 0 || box.y1 > h) continue
        if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue
        placed.push(box)
        ctx.strokeStyle = bg
        ctx.strokeText(q.call, s.x, s.y)
        ctx.fillStyle = fg
        ctx.fillText(q.call, s.x, s.y)
        count++
        break
      }
    }
  }
}

/** Centres of the QSOs' locators (QSOs without a valid one are skipped). */
function qsoPoints(qsos: readonly Qso[]): QsoPoint[] {
  const out: QsoPoint[] = []
  for (const q of qsos) {
    const c = q.grid ? gridCenter(q.grid) : undefined
    if (c) out.push({ ...c, call: q.call })
  }
  return out
}

/** 4-char locator of the square whose south-west corner is (lat, lon). */
function squareName(lat: number, lon: number): string {
  const x = lon + 180
  const y = lat + 90
  const field = String.fromCharCode(65 + Math.floor(x / 20)) + String.fromCharCode(65 + Math.floor(y / 10))
  return field + String(Math.floor((x % 20) / 2)) + String(Math.floor(y % 10))
}
