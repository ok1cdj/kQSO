// QSO map (VKV contest, Satellite): a dot per QSO at its locator, the Maidenhead grid
// and the own QTH on Natural Earth country outlines (web/src/db/world110.json, built
// by web/scripts/mapdata.py). Canvas, Web Mercator (core/mercator.ts). E-ink friendly:
// a drag only shifts the canvas and the map is redrawn once on release; zoom by buttons.

import { fitView, gridCenter, panView, project, readLogFile, unproject, zoomView } from '../../core/index'
import type { LatLon, LogMeta, MapView, Qso } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { t } from '../i18n'
import worldText from '../../db/world110.json?raw'

export interface MapNav {
  back(): void
}

interface Ring {
  readonly pts: readonly number[] // lon, lat, lon, lat…
  readonly west: number
  readonly east: number
  readonly south: number
  readonly north: number
}

let world: Ring[] | undefined

/** Country rings with their bounding boxes, parsed on first use. */
function rings(): Ring[] {
  if (world) return world
  world = (JSON.parse(worldText) as number[][]).map((pts) => {
    let west = 180
    let east = -180
    let south = 90
    let north = -90
    for (let i = 0; i < pts.length; i += 2) {
      west = Math.min(west, pts[i]!)
      east = Math.max(east, pts[i]!)
      south = Math.min(south, pts[i + 1]!)
      north = Math.max(north, pts[i + 1]!)
    }
    return { pts, west, east, south, north }
  })
  return world
}

const ZOOM = 2
const SQUARE_MIN_PX = 60 // show the 2°×1° squares once one is at least this wide

export class MapScreen implements Screen {
  private readonly root = el('div', 'screen screen--map')
  private readonly wrap = el('div', 'map-wrap')
  private readonly canvas = el('canvas', 'map-canvas')
  private meta: LogMeta | undefined
  private points: LatLon[] = []
  private view: MapView | undefined
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
    ctx.font = `11px ${font}`
    ctx.textBaseline = 'top'
    for (let lon = lon0; lon < Math.min(180, vis.east); lon += stepLon) {
      for (let lat = lat0; lat < Math.min(90, vis.north); lat += stepLat) {
        const label = squares ? squareName(lat, lon) : squareName(lat, lon).slice(0, 2)
        const p = px(lat + stepLat, lon)
        ctx.fillText(label, p.x + 3, p.y + 3)
      }
    }

    // Country outlines.
    ctx.strokeStyle = fg
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const r of rings()) {
      if (r.east < vis.west || r.west > vis.east || r.north < vis.south || r.south > vis.north) continue
      for (let i = 0; i < r.pts.length; i += 2) {
        const p = px(r.pts[i + 1]!, r.pts[i]!)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
    }
    ctx.stroke()

    // QSO dots.
    ctx.fillStyle = fg
    for (const q of this.points) {
      const p = px(q.lat, q.lon)
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI)
      ctx.fill()
    }

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
}

/** Centres of the QSOs' locators (QSOs without a valid one are skipped). */
function qsoPoints(qsos: readonly Qso[]): LatLon[] {
  const out: LatLon[] = []
  for (const q of qsos) {
    const c = q.grid ? gridCenter(q.grid) : undefined
    if (c) out.push(c)
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
