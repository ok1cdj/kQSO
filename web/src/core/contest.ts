// VHF contest scoring, each station once per band — a repeat on the same band is a dupe
// with 0 points, whatever the mode. IARU R1 / ČRK: 1 point per km (locator.ts). VKV
// Provozní aktiv and FM pohár: large-square rings — own square 2, the ring around it 3,
// each further ring one more; Provozní aktiv multiplies by the large squares worked on
// the band (own one always included). The first QSO in a large square (JO60) on a band
// is a "new WWL". Also the 6-hour window and the statistics per hour and per large
// square. Pure; used by the QSO list, the EDI export, the statistics and the logging.

import type { ContestCategory, Qso } from './model'
import { bearingDeg, qrbKm, qsoPoints } from './locator'

/** How a contest scores: km (IARU / national) or large-square rings, × squares or not. */
export interface Scoring {
  readonly rings: boolean
  readonly multiplier: boolean
}

export const KM_SCORING: Scoring = { rings: false, multiplier: false }

/** The scoring of a log's contest; km when the log has no category. */
export function scoringFor(c: ContestCategory | undefined): Scoring {
  if (c?.contest === 'pa') return { rings: true, multiplier: true }
  if (c?.contest === 'fm') return { rings: true, multiplier: false }
  return KM_SCORING
}

/** Large square → column / row index (JN69 → 9·10+6, 13·10+9); undefined if invalid. */
function squareIndex(grid: string): { x: number; y: number } | undefined {
  const m = /^([A-R])([A-R])(\d)(\d)/.exec(grid.toUpperCase())
  if (!m) return undefined
  return { x: (m[1]!.charCodeAt(0) - 65) * 10 + Number(m[3]), y: (m[2]!.charCodeAt(0) - 65) * 10 + Number(m[4]) }
}

/** Ring points: 2 in the own large square, 3 in the ring around it, one more per ring
 *  (JN69 → JN68, JO50, JO70 … 3). Undefined when a locator is missing / invalid. */
export function ringPoints(myGrid: string, theirGrid: string): number | undefined {
  const a = squareIndex(myGrid)
  const b = squareIndex(theirGrid)
  if (!a || !b) return undefined
  return 2 + Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

/** A QSO's points under a scoring. */
export function contestPoints(myGrid: string, theirGrid: string, s: Scoring): number | undefined {
  return s.rings ? ringPoints(myGrid, theirGrid) : qsoPoints(myGrid, theirGrid)
}

export interface ScoredQso {
  readonly qso: Qso
  readonly index: number // position in the whole log (for editing)
  readonly points: number // 0 for a dupe or a QSO without a usable locator
  readonly dupe: boolean
  readonly newWwl: boolean
}

export interface BandScore {
  readonly band: string
  readonly rows: readonly ScoredQso[] // this band's QSOs in log order
  readonly qsos: number // valid (non-dupe) QSOs
  readonly points: number
  readonly wwls: number // distinct large squares worked
  readonly multipliers?: number // Provozní aktiv: large squares worked + the own one
  readonly total: number // the band's score: points, × multipliers when the contest has them
  readonly odx?: { readonly call: string; readonly grid: string; readonly km: number }
}

/** Score a log per band, in the order bands first appear. */
export function scoreLog(qsos: readonly Qso[], myGrid: string, scoring: Scoring = KM_SCORING): BandScore[] {
  const bands = new Map<string, { rows: ScoredQso[]; calls: Set<string>; wwls: Set<string> }>()
  qsos.forEach((qso, index) => {
    const band = qso.signal.band
    let b = bands.get(band)
    if (!b) bands.set(band, (b = { rows: [], calls: new Set(), wwls: new Set() }))
    const call = qso.call.toUpperCase()
    const dupe = b.calls.has(call)
    b.calls.add(call)
    const pts = qso.grid ? contestPoints(myGrid, qso.grid, scoring) : undefined
    const wwl = qso.grid?.slice(0, 4).toUpperCase()
    const newWwl = !dupe && pts !== undefined && wwl !== undefined && !b.wwls.has(wwl)
    if (newWwl) b.wwls.add(wwl!)
    b.rows.push({ qso, index, points: dupe || pts === undefined ? 0 : pts, dupe, newWwl })
  })

  return [...bands].map(([band, b]) => {
    const valid = b.rows.filter((r) => !r.dupe)
    // ODX by distance (km + 1, as the EDI wants it), whatever the contest scores by.
    let odx: BandScore['odx']
    for (const r of valid) {
      const km = r.qso.grid && r.points > 0 ? qsoPoints(myGrid, r.qso.grid) : undefined
      if (km !== undefined && (!odx || km > odx.km)) odx = { call: r.qso.call, grid: r.qso.grid!, km }
    }
    const points = valid.reduce((sum, r) => sum + r.points, 0)
    const own = myGrid.slice(0, 4).toUpperCase()
    const multipliers = scoring.multiplier ? new Set([...b.wwls, ...(squareIndex(own) ? [own] : [])]).size : undefined
    const score: { -readonly [K in keyof BandScore]: BandScore[K] } = {
      band,
      rows: b.rows,
      qsos: valid.length,
      points,
      wwls: b.wwls.size,
      total: points * (multipliers ?? 1),
    }
    if (multipliers !== undefined) score.multipliers = multipliers
    if (odx) score.odx = odx
    return score
  })
}

export interface ContestStats {
  readonly qsos: number // valid (non-dupe) QSOs
  readonly points: number
  readonly total: number // the score: points, × multipliers per band where the contest has them
  readonly avg: number // points per valid QSO, 1 decimal; 0 for no QSO
  readonly top: readonly ScoredQso[] // highest points first, dupes excluded
}

const TOP_N = 10

/** Points, average per QSO and the top 10 QSOs of a set of bands. The UI passes one band
 *  at a time for the top list (bands never mix) and all bands for the total line. */
export function contestStats(bands: readonly BandScore[]): ContestStats {
  const qsos = bands.reduce((n, b) => n + b.qsos, 0)
  const points = bands.reduce((n, b) => n + b.points, 0)
  const total = bands.reduce((n, b) => n + b.total, 0)
  const top = bands
    .flatMap((b) => b.rows)
    .filter((r) => !r.dupe && r.points > 0)
    .sort((a, b) => b.points - a.points || a.index - b.index)
    .slice(0, TOP_N)
  return { qsos, points, total, avg: qsos === 0 ? 0 : Math.round((points / qsos) * 10) / 10, top }
}

const HOUR = 3_600_000
const SIX_HOURS = 6 * HOUR
const BREAK = 2 * HOUR

/** The 6-hour category's window (ČRK / IARU R1): part 1 starts with the first QSO; the
 *  first gap of 2 hours or more between QSOs is the break, the next QSO starts part 2,
 *  which gets what part 1 left of the 6 hours. */
export interface SixHourWindow {
  readonly start: Date
  readonly breakAt?: Date // the last QSO before the break
  readonly part2?: Date // the first QSO after it
  readonly end: Date // when the 6 hours run out
}

/** The window for a band's QSO times (any order); undefined without a QSO. */
export function sixHourWindow(times: readonly Date[]): SixHourWindow | undefined {
  const t = times.map((d) => d.getTime()).sort((a, b) => a - b)
  if (t.length === 0) return undefined
  const start = t[0]!
  for (let i = 1; i < t.length; i++) {
    if (t[i]! - t[i - 1]! >= BREAK) {
      const used = Math.min(t[i - 1]! - start, SIX_HOURS)
      return { start: new Date(start), breakAt: new Date(t[i - 1]!), part2: new Date(t[i]!), end: new Date(t[i]! + SIX_HOURS - used) }
    }
  }
  return { start: new Date(start), end: new Date(start + SIX_HOURS) }
}

/** Which part of the window a QSO time falls in: 1, 2, or undefined outside it. */
export function sixHourPart(w: SixHourWindow, d: Date): 1 | 2 | undefined {
  const t = d.getTime()
  if (!w.part2 || t <= w.breakAt!.getTime()) return t - w.start.getTime() <= SIX_HOURS ? 1 : undefined
  return w.end > w.part2 && t <= w.end.getTime() ? 2 : undefined // nothing left after a part 1 of 6 h
}

export type SixHourPhase = 'idle' | 'part1' | 'break' | 'part2' | 'over'

/** Live state for the logging header: the phase and the time left of the 6 hours. In a
 *  pause of 2 hours or more part 1 is over and the rest waits for part 2. */
export function sixHourStatus(times: readonly Date[], now: Date): { readonly phase: SixHourPhase; readonly leftMs: number } {
  const w = sixHourWindow(times)
  if (!w) return { phase: 'idle', leftMs: SIX_HOURS }
  const n = now.getTime()
  if (w.part2) {
    const left = w.end.getTime() - n
    return left > 0 ? { phase: 'part2', leftMs: left } : { phase: 'over', leftMs: 0 }
  }
  const last = Math.max(...times.map((d) => d.getTime()))
  const used = last - w.start.getTime()
  if (n - last >= BREAK && used < SIX_HOURS) return { phase: 'break', leftMs: SIX_HOURS - used }
  const left = w.end.getTime() - n
  return left > 0 ? { phase: 'part1', leftMs: left } : { phase: 'over', leftMs: 0 }
}

export interface HourStats {
  readonly hour: Date // start of the UTC hour
  readonly qsos: number // valid (non-dupe) QSOs in the hour
  readonly points: number
  readonly totalQsos: number // running totals up to and including this hour
  readonly totalPoints: number
  readonly outside: number // valid QSOs outside the 6-hour window (6H entries only)
}

/** One band per UTC hour from the first QSO's hour to the last's — empty hours included,
 *  so a pause shows. Dupes don't count. With a 6-hour window, QSOs outside it are
 *  counted in `outside` (the points stay: the log is sent whole, the robot strikes them). */
export function hourlyStats(band: BandScore, window?: SixHourWindow): HourStats[] {
  const valid = band.rows.filter((r) => !r.dupe)
  if (valid.length === 0) return []
  const hourOf = (r: ScoredQso): number => Math.floor(r.qso.timeOn.getTime() / HOUR)
  const first = Math.min(...valid.map(hourOf))
  const last = Math.max(...valid.map(hourOf))
  const out: HourStats[] = []
  let totalQsos = 0
  let totalPoints = 0
  for (let h = first; h <= last; h++) {
    const rows = valid.filter((r) => hourOf(r) === h)
    const points = rows.reduce((sum, r) => sum + r.points, 0)
    totalQsos += rows.length
    totalPoints += points
    const outside = window ? rows.filter((r) => sixHourPart(window, r.qso.timeOn) === undefined).length : 0
    out.push({ hour: new Date(h * HOUR), qsos: rows.length, points, totalQsos, totalPoints, outside })
  }
  return out
}

/** Valid (non-dupe) QSOs of a band in the last `windowMs` up to `now` — the rate on the
 *  logging screen's contest board (60 and 10 minutes). */
export function qsoRate(band: BandScore, now: Date, windowMs: number): number {
  const to = now.getTime()
  const from = to - windowMs
  return band.rows.filter((r) => {
    const t = r.qso.timeOn.getTime()
    return !r.dupe && t > from && t <= to
  }).length
}

export interface SquareStats {
  readonly square: string // large square, e.g. JO70
  readonly calls: readonly string[] // distinct stations worked there, in log order
  readonly km?: number // from my locator to the square's centre
  readonly az?: number
}

/** One band's large squares with the stations worked in each (no dupes), most first. */
export function squareStats(band: BandScore, myGrid: string): SquareStats[] {
  const squares = new Map<string, string[]>()
  for (const r of band.rows) {
    const sq = r.qso.grid?.slice(0, 4).toUpperCase()
    if (r.dupe || !sq || sq.length < 4) continue
    const calls = squares.get(sq) ?? []
    const call = r.qso.call.toUpperCase()
    if (!calls.includes(call)) calls.push(call)
    squares.set(sq, calls)
  }
  return [...squares]
    .map(([square, calls]) => {
      const s: { -readonly [K in keyof SquareStats]: SquareStats[K] } = { square, calls }
      const km = qrbKm(myGrid, square)
      const az = bearingDeg(myGrid, square)
      if (km !== undefined) s.km = Math.round(km)
      if (az !== undefined) s.az = az
      return s
    })
    .sort((a, b) => b.calls.length - a.calls.length || a.square.localeCompare(b.square))
}
