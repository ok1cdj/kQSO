// Web Mercator for the QSO map. Positions are "world units": x, y in 0…1 across the
// whole map (x = 0 at 180°W, y = 0 at the top). A view is a centre in world units and
// a scale in pixels per world unit, so zooming is continuous. Pure; no DOM.

export interface LatLon {
  readonly lat: number
  readonly lon: number
}

export interface MapView {
  readonly cx: number
  readonly cy: number
  readonly scale: number // px per world unit
}

const MAX_LAT = 85
const RAD = Math.PI / 180

function worldX(lon: number): number {
  return (lon + 180) / 360
}

function worldY(lat: number): number {
  const r = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}

/** Pixel position of a point in a w×h canvas. */
export function project(lat: number, lon: number, view: MapView, w: number, h: number): { x: number; y: number } {
  return { x: w / 2 + (worldX(lon) - view.cx) * view.scale, y: h / 2 + (worldY(lat) - view.cy) * view.scale }
}

/** Inverse of project(). */
export function unproject(x: number, y: number, view: MapView, w: number, h: number): LatLon {
  const wx = view.cx + (x - w / 2) / view.scale
  const wy = view.cy + (y - h / 2) / view.scale
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) / RAD, lon: wx * 360 - 180 }
}

/**
 * The view that shows all points with a pixel margin. The box is at least
 * minSpanDeg wide and tall (in degrees at its centre), so one point does not zoom in
 * to a single street.
 */
export function fitView(points: readonly LatLon[], w: number, h: number, margin = 24, minSpanDeg = 3): MapView {
  if (points.length === 0) return { cx: 0.5, cy: 0.5, scale: Math.min(w, h) }
  const xs = points.map((p) => worldX(p.lon))
  const ys = points.map((p) => worldY(p.lat))
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const lat = unproject(0, 0, { cx, cy, scale: 1 }, 0, 0).lat
  const minX = minSpanDeg / 360
  const minY = Math.abs(worldY(lat + minSpanDeg / 2) - worldY(lat - minSpanDeg / 2))
  const dx = Math.max(x1 - x0, minX)
  const dy = Math.max(y1 - y0, minY)
  const scale = Math.min((w - 2 * margin) / dx, (h - 2 * margin) / dy)
  return { cx, cy, scale: Math.max(scale, 1) }
}

/** Zoom by a factor around the view centre. */
export function zoomView(view: MapView, factor: number): MapView {
  return { ...view, scale: view.scale * factor }
}

/** Move the map content by (dx, dy) pixels (a drag to the right moves the centre west). */
export function panView(view: MapView, dx: number, dy: number): MapView {
  return { ...view, cx: view.cx - dx / view.scale, cy: view.cy - dy / view.scale }
}
