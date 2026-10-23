// VHF contest board on the logging screen (as in Tučňák): the band's QSO count in big
// digits, the UTC clock, the rate, the points, the average and the ODX. Shown only in
// the wide layout without our keyboard, where the log has room on the right. Text is
// written only when it changes (e-ink repaints).

import { contestStats, qsoRate, scoreLog } from '../core/index'
import type { BandScore, Qso, Scoring } from '../core/index'
import { currentDisplayMode } from '../theme/mode'
import { el } from './dom'
import { t } from './i18n'

const MINUTE = 60_000
const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))

export class ContestBoard {
  readonly el = el('aside', 'board')
  private readonly countEl = el('div', 'board-count')
  private readonly clockEl = el('div', 'board-clock')
  private readonly rateEl = el('dd')
  private readonly pointsEl = el('dd')
  private readonly avgLabel = el('dt')
  private readonly avgEl = el('dd')
  private readonly odxEl = el('dd')
  private band: BandScore | undefined

  constructor() {
    const dl = el('dl', 'board-stats')
    dl.append(
      el('dt', undefined, t('board.rate')),
      this.rateEl,
      el('dt', undefined, t('board.points')),
      this.pointsEl,
      this.avgLabel,
      this.avgEl,
      el('dt', undefined, 'ODX'),
      this.odxEl,
    )
    this.el.append(this.clockEl, this.countEl, dl)
    this.el.hidden = true
  }

  /** The clock once a second; once a minute on e-ink, which shows no seconds. */
  get tickMs(): number {
    return currentDisplayMode() === 'eink' ? MINUTE : 1000
  }

  /** Rescore the current band (after a QSO is saved / deleted, or the band changes). */
  update(qsos: readonly Qso[], band: string, myGrid: string, scoring: Scoring): void {
    const b = scoreLog(
      qsos.filter((q) => q.signal.band === band),
      myGrid,
      scoring,
    )[0]
    this.band = b
    const st = contestStats(b ? [b] : [])
    set(this.countEl, String(b?.qsos ?? 0))
    set(this.pointsEl, b?.multipliers !== undefined ? `${b.points} × ${b.multipliers} = ${b.total}` : String(b?.total ?? 0))
    set(this.avgLabel, scoring.rings ? t('board.avgPoints') : t('board.avgKm'))
    set(this.avgEl, st.avg.toFixed(1))
    set(this.odxEl, b?.odx ? `${b.odx.call} ${b.odx.grid} ${b.odx.km} km` : '–')
    this.tick(new Date())
  }

  /** Clock and rate. */
  tick(now: Date): void {
    const hm = `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`
    set(this.clockEl, currentDisplayMode() === 'eink' ? hm : `${hm}:${pad2(now.getUTCSeconds())}`)
    const b = this.band
    set(this.rateEl, b ? `${qsoRate(b, now, 60 * MINUTE)} / ${qsoRate(b, now, 10 * MINUTE)}` : '0 / 0')
  }
}

function set(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text
}
