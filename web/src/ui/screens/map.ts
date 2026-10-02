// QSO map (VKV contest, Satellite): a dot per QSO at its locator (with the call once
// there is room), the Maidenhead grid and the own QTH over Natural Earth coastlines
// and borders (web/src/db/world.json — 1:10m Europe, 1:50m elsewhere — built by
// web/scripts/mapdata.py). Canvas, Web Mercator (core/mercator.ts). E-ink friendly:
// a drag only shifts the canvas and the map is redrawn once on release; zoom by buttons.
// VKV logs can show the rain radar under the map (ui/radar.ts, setting, default off);
// a tap (not a drag) shows that spot's locator, QRB and azimuth from the own QTH.

import {
  PROFILES,
  bearingDeg,
  fitView,
  gridCenter,
  latLonToGrid,
  panView,
  project,
  qsoPoints as gridPoints,
  readLogFile,
  unproject,
  zoomView,
} from '../../core/index'
import type { LatLon, LogMeta, MapView, Qso } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button, switchOn } from '../dom'
import { t } from '../i18n'
import worldText from '../../db/world.json?raw'
import { RADAR_SETTING, RadarLayer } from '../radar'

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

interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
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
const SQUARE_LINES_PX = 16 // square lines (2°×1°) from this width; the QSO labels carry the square
const SQUARE_DIGITS_PX = 30 // digits in every square from this width
const SQUARE_FULL_PX = 60 // full square labels (JO70) from this width
const MAX_LABELS = 80
const TAP_PX = 6 // a pointer that moved less than this is a tap, not a drag

// 24×24 stroke paths for the bar buttons: font glyphs (⤢ especially) come from
// fallback fonts with their own size and baseline, so they never sit centred.
const BAR_ICONS = {
  zoomOut: 'M6 12h12',
  zoomIn: 'M12 6v12M6 12h12',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', // corner brackets: fit the view
} as const

function iconButton(icon: keyof typeof BAR_ICONS, label: string, onClick: () => void): HTMLButtonElement {
  const b = button('', onClick, 'btn btn--small btn--mapicon')
  b.setAttribute('aria-label', label)
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', BAR_ICONS[icon])
  svg.appendChild(path)
  b.appendChild(svg)
  return b
}

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
  private radar: RadarLayer | undefined
  private readonly radarNote = el('div', 'map-note')
  private readonly pickBar = el('div', 'map-pick')
  private pick: string | undefined // tapped 6-char locator

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
    this.radar?.stop()
  }

  private async load(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))
    this.meta = meta
    this.labels = switchOn(await this.platform.getSetting(MAP_LABELS_SETTING))
    this.points = qsoPoints(qsos)
    const noGrid = qsos.length - qsos.filter((q) => q.grid && gridCenter(q.grid)).length

    const bar = el('div', 'bar')
    bar.append(
      button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'),
      el('b', 'title', `${meta.name} · ${qsos.length} QSO`),
      iconButton('zoomOut', '−', () => this.zoom(1 / ZOOM)),
      iconButton('zoomIn', '+', () => this.zoom(ZOOM)),
      iconButton('fit', '⤢', () => this.fit()),
    )
    const note = noGrid > 0 ? [el('div', 'qsosum', t('map.noGrid', { n: noGrid }))] : []
    this.pickBar.hidden = true
    this.radarNote.hidden = true
    this.wrap.replaceChildren(this.canvas, this.pickBar, this.radarNote)
    this.root.replaceChildren(bar, ...note, this.wrap)

    // Rain radar: VKV logs only (rain scatter), and only when switched on.
    if (PROFILES[meta.profile].contest && switchOn(await this.platform.getSetting(RADAR_SETTING), false)) {
      this.radar = new RadarLayer(() => this.draw())
      this.radarNote.hidden = false
      this.radar.start()
    }

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
    if (Math.abs(d.dx) < TAP_PX && Math.abs(d.dy) < TAP_PX) {
      this.tap(e)
      return
    }
    if (this.view) {
      this.view = panView(this.view, d.dx, d.dy)
      this.draw()
    }
  }

  /** A tap: the locator there, its QRB and azimuth from the own QTH (as in the log). */
  private tap(e: PointerEvent): void {
    if (!this.view || !this.meta) return
    const r = this.canvas.getBoundingClientRect()
    const { w, h } = this.size()
    const p = unproject(e.clientX - r.left, e.clientY - r.top, this.view, w, h)
    this.pick = latLonToGrid(p.lat, p.lon)
    const km = gridPoints(this.meta.myGrid, this.pick)
    const az = bearingDeg(this.meta.myGrid, this.pick)
    const text = km !== undefined && az !== undefined ? `${this.pick} · ${km} km · ${az}°` : this.pick
    const close = button('×', () => this.clearPick(), 'btn btn--small')
    close.setAttribute('aria-label', t('map.pickClose'))
    this.pickBar.replaceChildren(el('b', undefined, text), close)
    this.pickBar.hidden = false
    this.draw()
  }

  private clearPick(): void {
    this.pick = undefined
    this.pickBar.hidden = true
    this.draw()
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

    // Rain radar first: the grid, coast and dots stay on top of it.
    if (this.radar) {
      this.radar.draw(ctx, view, w, h, css.getPropertyValue('--radar-palette').trim())
      const time = this.radar.time
      this.radarNote.textContent = this.radar.failed
        ? t('map.radarOff')
        : time !== undefined
          ? t('map.radarBy', { time: hhmm(time) })
          : t('map.radarLoading')
    }

    const nw = unproject(0, 0, view, w, h)
    const se = unproject(w, h, view, w, h)
    const vis = { west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }
    const px = (lat: number, lon: number): { x: number; y: number } => project(lat, lon, view, w, h)

    // Maidenhead grid. Fields (20°×10°): solid lines + big letters (JO). Squares
    // (2°×1°) from SQUARE_LINES_PX wide: dotted lines, and the QSO labels carry the
    // square (DJ8MS JO54); from SQUARE_DIGITS_PX small digits (70) in every square;
    // from SQUARE_FULL_PX the square label is the full JO70.
    const sqPx = px(0, 2).x - px(0, 0).x
    const full = sqPx >= SQUARE_FULL_PX
    const squares = sqPx >= SQUARE_LINES_PX
    const allDigits = sqPx >= SQUARE_DIGITS_PX
    const west = Math.max(-180, vis.west)
    const east = Math.min(180, vis.east)
    const south = Math.max(-90, vis.south)
    const north = Math.min(90, vis.north)
    const gridLines = (stepLon: number, stepLat: number): void => {
      ctx.beginPath()
      for (let lon = Math.ceil(west / stepLon) * stepLon; lon <= east; lon += stepLon) {
        const x = Math.round(px(0, lon).x) + 0.5
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
      }
      for (let lat = Math.ceil(south / stepLat) * stepLat; lat <= north; lat += stepLat) {
        const y = Math.round(px(lat, 0).y) + 0.5
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
      }
      ctx.stroke()
    }
    ctx.strokeStyle = ghost
    ctx.fillStyle = ghost
    ctx.lineWidth = 1
    ctx.textBaseline = 'top'
    if (squares) {
      ctx.setLineDash([1, 3])
      gridLines(2, 1)
      ctx.setLineDash([])
    }
    if (allDigits) {
      ctx.font = `${full ? 11 : 10}px ${font}`
      for (let lon = Math.floor(west / 2) * 2; lon < east; lon += 2) {
        for (let lat = Math.floor(south); lat < north; lat++) {
          const name = squareName(lat, lon)
          const p = px(lat + 1, lon)
          // Without the full name, the field's top-left square carries the field letters.
          if (!full && name[2] === '0' && name[3] === '9') continue
          ctx.fillText(full ? name : name.slice(2), p.x + 3, p.y + 3)
        }
      }
    }
    gridLines(20, 10)
    if (!full) {
      ctx.font = `bold 13px ${font}`
      for (let lon = Math.floor(west / 20) * 20; lon < east; lon += 20) {
        for (let lat = Math.floor(south / 10) * 10; lat < north; lat += 10) {
          const p = px(lat + 10, lon)
          ctx.fillText(squareName(lat, lon).slice(0, 2), p.x + 3, p.y + 3)
        }
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
    // Small squares without their own digits: the QSO label carries the square (DJ8MS JO54).
    const withSquare = squares && !allDigits
    if (this.labels || withSquare) this.drawLabels(ctx, px, w, h, fg, bg, font, withSquare)

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

    // Tapped locator: a square outline around its centre, distinct from the QTH ring.
    const picked = this.pick ? gridCenter(this.pick) : undefined
    if (picked) {
      const p = px(picked.lat, picked.lon)
      ctx.lineWidth = 3
      ctx.strokeStyle = bg
      ctx.strokeRect(p.x - 7, p.y - 7, 14, 14)
      ctx.lineWidth = 2
      ctx.strokeStyle = fg
      ctx.strokeRect(p.x - 7, p.y - 7, 14, 14)
    }
  }

  /** Label next to each dot where it fits (the call, with/or the square): greedy, first
   *  come first placed, no overlaps. */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    px: (lat: number, lon: number) => { x: number; y: number },
    w: number,
    h: number,
    fg: string,
    bg: string,
    font: string,
    withSquare: boolean,
  ): void {
    ctx.font = `bold 12px ${font}`
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    const placed: Box[] = []
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
      const square = squareOf(q)
      const text = withSquare ? (this.labels ? `${q.call} ${square}` : square) : q.call
      const key = `${text}@${withSquare && !this.labels ? square : `${q.lat},${q.lon}`}`
      if (seen.has(key)) continue
      seen.add(key)
      const p = px(q.lat, q.lon)
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue
      const tw = ctx.measureText(text).width
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
        if (placed.some((b) => overlaps(box, b))) continue
        placed.push(box)
        ctx.strokeStyle = bg
        ctx.strokeText(text, s.x, s.y)
        ctx.fillStyle = fg
        ctx.fillText(text, s.x, s.y)
        count++
        break
      }
    }
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
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

/** HH:MM UTC of a unix time (seconds). */
function hhmm(sec: number): string {
  const d = new Date(sec * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** 4-char locator of the square a point lies in. */
function squareOf(p: LatLon): string {
  return squareName(Math.floor(p.lat), Math.floor(p.lon / 2) * 2)
}

/** 4-char locator of the square whose south-west corner is (lat, lon). */
function squareName(lat: number, lon: number): string {
  const x = lon + 180
  const y = lat + 90
  const field = String.fromCharCode(65 + Math.floor(x / 20)) + String.fromCharCode(65 + Math.floor(y / 10))
  return field + String(Math.floor((x % 20) / 2)) + String(Math.floor(y % 10))
}
