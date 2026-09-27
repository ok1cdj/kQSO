// VHF contest scoring (IARU R1): 1 point per km (locator.ts), each station once per
// band — a repeat on the same band is a dupe with 0 points, whatever the mode. The
// first QSO in a large square (JO60) on a band is a "new WWL". Pure; used by the QSO
// list, the EDI export and the logging preview.

import type { Qso } from './model'
import { qsoPoints } from './locator'

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
  readonly odx?: { readonly call: string; readonly grid: string; readonly km: number }
}

/** Score a log per band, in the order bands first appear. */
export function scoreLog(qsos: readonly Qso[], myGrid: string): BandScore[] {
  const bands = new Map<string, { rows: ScoredQso[]; calls: Set<string>; wwls: Set<string> }>()
  qsos.forEach((qso, index) => {
    const band = qso.signal.band
    let b = bands.get(band)
    if (!b) bands.set(band, (b = { rows: [], calls: new Set(), wwls: new Set() }))
    const call = qso.call.toUpperCase()
    const dupe = b.calls.has(call)
    b.calls.add(call)
    const pts = qso.grid ? qsoPoints(myGrid, qso.grid) : undefined
    const wwl = qso.grid?.slice(0, 4).toUpperCase()
    const newWwl = !dupe && pts !== undefined && wwl !== undefined && !b.wwls.has(wwl)
    if (newWwl) b.wwls.add(wwl!)
    b.rows.push({ qso, index, points: dupe || pts === undefined ? 0 : pts, dupe, newWwl })
  })

  return [...bands].map(([band, b]) => {
    const valid = b.rows.filter((r) => !r.dupe)
    let odx: BandScore['odx']
    for (const r of valid) {
      if (r.points > 0 && (!odx || r.points > odx.km)) odx = { call: r.qso.call, grid: r.qso.grid!, km: r.points }
    }
    const score: { -readonly [K in keyof BandScore]: BandScore[K] } = {
      band,
      rows: b.rows,
      qsos: valid.length,
      points: valid.reduce((sum, r) => sum + r.points, 0),
      wwls: b.wwls.size,
    }
    if (odx) score.odx = odx
    return score
  })
}

export interface ContestStats {
  readonly qsos: number // valid (non-dupe) QSOs
  readonly points: number
  readonly avg: number // points per valid QSO, 1 decimal; 0 for no QSO
  readonly top: readonly ScoredQso[] // highest points first, dupes excluded
}

const TOP_N = 10

/** Points, average per QSO and the top 10 QSOs — for a set of bands (one, or all for the total). */
export function contestStats(bands: readonly BandScore[]): ContestStats {
  const qsos = bands.reduce((n, b) => n + b.qsos, 0)
  const points = bands.reduce((n, b) => n + b.points, 0)
  const top = bands
    .flatMap((b) => b.rows)
    .filter((r) => !r.dupe && r.points > 0)
    .sort((a, b) => b.points - a.points || a.index - b.index)
    .slice(0, TOP_N)
  return { qsos, points, avg: qsos === 0 ? 0 : Math.round((points / qsos) * 10) / 10, top }
}
