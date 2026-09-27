// VHF contest statistics, per band: points, the average per QSO and the band's top 10
// QSOs by points (bands are never mixed), plus the total for a multi-band log.

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

    // One block per band — its line and its own top 10 (bands never mix), then the total.
    const blocks: HTMLElement[] = []
    for (const b of bands) {
      const st = contestStats([b])
      blocks.push(el('div', 'qsosum', summary(b.band, st)))
      if (st.top.length === 0) continue
      const top = el('ol', 'stats-top')
      for (const r of st.top) {
        const row = { call: r.qso.call.padEnd(9), grid: (r.qso.grid ?? '').padEnd(6), points: String(r.points).padStart(4) }
        top.append(el('li', 'stats-row', t('stats.row', row)))
      }
      blocks.push(top)
    }
    if (bands.length > 1) blocks.push(el('div', 'qsosum', summary(t('stats.total'), contestStats(bands))))
    if (bands.length === 0) blocks.push(el('div', 'empty', t('qsolist.empty')))
    this.root.replaceChildren(bar, ...blocks)
  }
}

function summary(label: string, s: ContestStats): string {
  return t('stats.line', { band: label, qsos: s.qsos, points: s.points, avg: s.avg.toFixed(1) })
}
