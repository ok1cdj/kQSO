// VHF contest statistics: points and the average per QSO for each band (plus the
// total for a multi-band log) and the top 10 QSOs by points. Plain text, no chart.

import { contestStats, readLogFile, scoreLog } from '../../core/index'
import type { ContestStats } from '../../core/index'
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
    const bands = scoreLog(qsos, meta.myGrid)

    const bar = el('div', 'bar')
    bar.append(
      button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'),
      el('b', 'title', `${meta.name} · ${t('qsolist.stats')}`),
    )

    const lines = bands.map((b) => el('div', 'qsosum', summary(b.band, contestStats([b]))))
    const total = contestStats(bands)
    if (bands.length > 1) lines.push(el('div', 'qsosum', summary(t('stats.total'), total)))

    const top = el('ol', 'stats-top')
    for (const r of total.top) {
      top.append(el('li', 'stats-row', t('stats.row', { call: r.qso.call.padEnd(9), grid: (r.qso.grid ?? '').padEnd(6), points: String(r.points).padStart(4), band: r.qso.signal.band })))
    }
    const topBlock = total.top.length > 0 ? [el('div', 'qsosum', t('stats.top')), top] : [el('div', 'empty', t('qsolist.empty'))]
    this.root.replaceChildren(bar, ...lines, ...topBlock)
  }
}

function summary(label: string, s: ContestStats): string {
  return t('stats.line', { band: label, qsos: s.qsos, points: s.points, avg: s.avg.toFixed(1) })
}
