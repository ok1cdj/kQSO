// Maidenhead locator geometry for VHF contest scoring (IARU R1 rules, "Scoring"):
// the centre of each locator square, spherical geometry, 111.2 km per degree, and
// points = distance truncated to whole km + 1 (so the same square scores 1).

const KM_PER_DEG = 111.2
const RAD = Math.PI / 180

const LOCATOR = /^[A-R]{2}\d{2}([A-X]{2})?$/

/** Centre of a 4- or 6-character locator in degrees, or undefined when invalid. */
export function gridCenter(loc: string): { lat: number; lon: number } | undefined {
  const g = loc.toUpperCase()
  if (!LOCATOR.test(g)) return undefined
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3])
  if (g.length === 6) {
    lon += (g.charCodeAt(4) - 65) * (2 / 24) + 1 / 24
    lat += (g.charCodeAt(5) - 65) * (1 / 24) + 1 / 48
  } else {
    lon += 1
    lat += 0.5
  }
  return { lat, lon }
}

/** Great-circle distance between two locator centres in km (unrounded). */
export function qrbKm(a: string, b: string): number | undefined {
  const p = gridCenter(a)
  const q = gridCenter(b)
  if (!p || !q) return undefined
  const c =
    Math.sin(p.lat * RAD) * Math.sin(q.lat * RAD) +
    Math.cos(p.lat * RAD) * Math.cos(q.lat * RAD) * Math.cos((q.lon - p.lon) * RAD)
  return (Math.acos(Math.min(1, Math.max(-1, c))) / RAD) * KM_PER_DEG
}

/** Initial great-circle bearing from one locator centre to another, whole degrees
 *  0–359 (where to point the antenna). Undefined when a locator is missing/invalid. */
export function bearingDeg(from: string, to: string): number | undefined {
  const p = gridCenter(from)
  const q = gridCenter(to)
  if (!p || !q) return undefined
  const dLon = (q.lon - p.lon) * RAD
  const y = Math.sin(dLon) * Math.cos(q.lat * RAD)
  const x =
    Math.cos(p.lat * RAD) * Math.sin(q.lat * RAD) - Math.sin(p.lat * RAD) * Math.cos(q.lat * RAD) * Math.cos(dLon)
  if (x === 0 && y === 0) return 0 // same square
  return Math.round((Math.atan2(y, x) / RAD + 360) % 360) % 360
}

/** QSO points: whole km + 1 (IARU R1). Undefined when a locator is missing/invalid. */
export function qsoPoints(myGrid: string, theirGrid: string): number | undefined {
  const km = qrbKm(myGrid, theirGrid)
  return km === undefined ? undefined : Math.trunc(km) + 1
}
