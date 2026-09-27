// QSO list (ch. 15 #4): a table of the log's QSOs, tap a row to edit it. A VHF-contest
// log also shows the points per QSO (DUPE for a repeat on the band) and a score line
// per band on top. VKV and Satellite logs open the map, VKV also the statistics.

import { PROFILES, readLogFile, scoreLog } from '../../core/index'
import type { BandScore, Qso, ScoredQso } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { t } from '../i18n'

export interface QsoListNav {
  back(): void
  editQso(index: number): void
  toMap(): void
  toStats(): void
}

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))
const stamp = (d: Date): string =>
  `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}. ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`

export class QsoListScreen implements Screen {
  private readonly root = el('div', 'screen screen--list')

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly logId: string,
    private readonly nav: QsoListNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {}

  private async render(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))

    const bar = el('div', 'bar')
    bar.append(
      button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'),
      el('b', 'title', `${meta.name} · ${qsos.length} QSO`),
    )
    const profile = PROFILES[meta.profile]
    if (profile.map) bar.append(button(t('qsolist.map'), () => this.nav.toMap(), 'btn btn--small'))
    if (profile.contest) bar.append(button(t('qsolist.stats'), () => this.nav.toStats(), 'btn btn--small'))

    const bands = profile.contest ? scoreLog(qsos, meta.myGrid) : []
    const scored = new Map<number, ScoredQso>()
    for (const b of bands) for (const r of b.rows) scored.set(r.index, r)

    const list = el('ul', 'qsolist')
    if (qsos.length === 0) {
      list.append(el('li', 'empty', t('qsolist.empty')))
    } else {
      qsos.forEach((q, i) => list.append(this.row(q, i, scored.get(i))))
    }
    this.root.replaceChildren(bar, ...bands.map((b) => el('div', 'qsosum', scoreLine(b))), list)
  }

  private row(q: Qso, index: number, s: ScoredQso | undefined): HTMLElement {
    const li = el('li', 'qsorow')
    const pts = s ? `  ${s.dupe ? t('qsolist.dupe') : s.points}` : ''
    li.append(button(formatRow(q) + pts, () => this.nav.editQso(index), 'qsorow-open'))
    return li
  }
}

function scoreLine(b: BandScore): string {
  const line = t('qsolist.score', { band: b.band, qsos: b.qsos, points: b.points, wwls: b.wwls })
  return b.odx ? line + t('qsolist.odx', { call: b.odx.call, km: b.odx.km }) : line
}

function formatRow(q: Qso): string {
  const ref = q.theirRef ? ` ${q.theirRef.value}` : ''
  const extra = q.grid ? ` ${q.grid}` : q.name ? ` ${q.name}` : ''
  const nums = q.sentSerial || q.serial ? ` #${q.sentSerial ?? '—'}/${q.serial ?? '—'}` : ''
  const sat = q.satName ? ` 🛰${q.satName}` : ''
  return `${stamp(q.timeOn)}  ${q.call}  ${q.signal.band} ${q.signal.mode}  ${q.report.sent}/${q.report.rcvd}${nums}${extra}${ref}${sat}`
}
