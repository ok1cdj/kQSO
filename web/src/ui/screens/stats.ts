// VHF contest statistics, per band: points, the average per QSO, the 6-hour window (a
// 6H entry), QSOs and points per UTC hour, the large squares worked (tap = the stations
// there) and the band's top 10 QSOs by points (bands are never mixed), plus the total
// for a multi-band log.

import { contestStats, hourlyStats, isSixHours, readLogFile, scoreLog, scoringFor, sixHourWindow, squareStats } from '../../core/index'
import type { BandScore, ContestStats, HourStats, SixHourWindow, SquareStats } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { t } from '../i18n'

export interface StatsNav {
  back(): void
}

export class StatsScreen implements Screen {
  private readonly root = el('div', 'screen screen--list')

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly logId: string,
    private readonly nav: StatsNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {}

  private async render(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))
    const bands = scoreLog(qsos, meta.myGrid, scoringFor(meta.category))

    const bar = el('div', 'bar')
    bar.append(
      button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'),
      el('b', 'title', `${meta.name} · ${t('qsolist.stats')}`),
    )

    // One block per band — its line, 6-hour window, hours, squares and its own top 10
    // (bands never mix), then the total.
    const blocks: HTMLElement[] = []
    for (const b of bands) {
      const st = contestStats([b])
      blocks.push(el('div', 'qsosum', summary(b.band, st, b.multipliers)))
      const window = isSixHours(meta.category, b.band) ? sixHourWindow(b.rows.map((r) => r.qso.timeOn)) : undefined
      if (window) blocks.push(el('div', 'about stats-note', windowLine(window)))
      blocks.push(...hoursBlock(hourlyStats(b, window), window !== undefined))
      blocks.push(...squaresBlock(squareStats(b, meta.myGrid)))
      blocks.push(...topBlock(b))
    }
    if (bands.length > 1) blocks.push(el('div', 'qsosum', summary(t('stats.total'), contestStats(bands))))
    if (bands.length === 0) blocks.push(el('div', 'empty', t('qsolist.empty')))
    this.root.replaceChildren(bar, ...blocks)
  }
}

/** Band / total line; Provozní aktiv shows points × large squares = score. */
function summary(label: string, s: ContestStats, mult?: number): string {
  const points = mult !== undefined ? t('edi.scoreMult', { points: s.points, mult, total: s.total }) : s.points !== s.total ? `${s.points} → ${s.total}` : s.points
  return t('stats.line', { band: label, qsos: s.qsos, points, avg: s.avg.toFixed(1) })
}

const hhmm = (d: Date): string => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

/** "6 h: 14:02–16:30 · 19:00–22:30 UTC" — part 1, and part 2 after the break. */
function windowLine(w: SixHourWindow): string {
  const parts = w.part2 ? `${hhmm(w.start)}–${hhmm(w.breakAt!)} · ${hhmm(w.part2)}–${hhmm(w.end)}` : `${hhmm(w.start)}–${hhmm(w.end)}`
  return t('stats.window', { parts })
}

/** Monospace table: the first column left, the numbers right-aligned. */
function table(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)))
  return rows.map((r) => r.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join('  '))
}

/** QSOs and points per UTC hour with running totals; with 6 h, the QSOs outside it. */
function hoursBlock(hours: readonly HourStats[], sixH: boolean): HTMLElement[] {
  if (hours.length === 0) return []
  const head = [t('stats.hUtc'), 'QSO', t('stats.hPts'), 'Σ QSO', `Σ ${t('stats.hPts')}`, ...(sixH ? [t('stats.hOutside')] : [])]
  const rows = hours.map((h) => [
    hhmm(h.hour),
    String(h.qsos),
    String(h.points),
    String(h.totalQsos),
    String(h.totalPoints),
    ...(sixH ? [h.outside > 0 ? String(h.outside) : ''] : []),
  ])
  const lines = table([head, ...rows])
  const pre = el('div', 'stats-table')
  pre.append(el('div', 'stats-table__head', lines[0]), ...lines.slice(1).map((l) => el('div', undefined, l)))
  return [el('div', 'field-label stats-label', t('stats.hours')), pre]
}

/** The large squares, most stations first; each opens to the stations worked there. */
function squaresBlock(squares: readonly SquareStats[]): HTMLElement[] {
  if (squares.length === 0) return []
  const lines = table(squares.map((s) => [s.square, String(s.calls.length), s.km !== undefined ? `${s.km} km` : '', s.az !== undefined ? `${s.az}°` : '']))
  const list = el('div', 'stats-squares')
  squares.forEach((s, i) => {
    const d = el('details')
    d.append(el('summary', undefined, lines[i]), el('div', 'stats-calls', s.calls.join(' ')))
    list.append(d)
  })
  return [el('div', 'field-label stats-label', t('stats.squares', { n: squares.length })), list]
}

/** The band's top 10 QSOs by points. */
function topBlock(b: BandScore): HTMLElement[] {
  const st = contestStats([b])
  if (st.top.length === 0) return []
  const top = el('ol', 'stats-top')
  for (const r of st.top) {
    const row = { call: r.qso.call.padEnd(9), grid: (r.qso.grid ?? '').padEnd(6), points: String(r.points).padStart(4) }
    top.append(el('li', 'stats-row', t('stats.row', row)))
  }
  return [el('div', 'field-label stats-label', t('stats.top')), top]
}
