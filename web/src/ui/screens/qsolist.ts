// QSO list (ch. 15 #4): a table of the log's QSOs, tap a row to edit it. A VHF-contest
// log also shows the points per QSO (DUPE for a repeat on the band) and a score line
// per band on top. VKV and Satellite logs open the map, VKV also the statistics.
// On the web (tablets, phones) the rows are aligned in columns when they fit the
// width; the APK (the narrow Kompakt) and any narrower screen keep the compact row.

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
  private readonly list = el('ul', 'qsolist')
  private qsos: readonly Qso[] = []
  private scored = new Map<number, ScoredQso>()
  private resize: ResizeObserver | undefined
  private width = 0

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly logId: string,
    private readonly nav: QsoListNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {
    this.resize?.disconnect()
  }

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
    for (const b of bands) for (const r of b.rows) this.scored.set(r.index, r)
    this.qsos = qsos

    this.root.replaceChildren(bar, ...bands.map((b) => el('div', 'qsosum', scoreLine(b))), this.list)
    this.renderRows()
    if (!this.platform.nativeVersion && qsos.length > 0) {
      // Re-check the fit when the width changes (tablet rotated, window resized).
      this.resize = new ResizeObserver(() => {
        if (this.list.clientWidth !== this.width) this.renderRows()
      })
      this.resize.observe(this.list)
    }
  }

  /** Aligned columns on the web when every row fits on one line, else the compact rows. */
  private renderRows(): void {
    this.width = this.list.clientWidth
    if (this.qsos.length === 0) {
      this.list.replaceChildren(el('li', 'empty', t('qsolist.empty')))
      return
    }
    const cells = this.qsos.map((q, i) => rowCells(q, this.scored.get(i)))
    if (!this.platform.nativeVersion) {
      this.fillRows(alignRows(cells), true)
      const fits = Array.from(this.list.querySelectorAll<HTMLElement>('.qsorow-open')).every(
        (b) => b.scrollWidth <= b.clientWidth,
      )
      if (fits) return
    }
    this.fillRows(
      this.qsos.map((q, i) => formatRow(q) + pointsSuffix(this.scored.get(i))),
      false,
    )
  }

  private fillRows(texts: readonly string[], aligned: boolean): void {
    const cls = aligned ? 'qsorow-open qsorow-open--aligned' : 'qsorow-open'
    this.list.replaceChildren(
      ...texts.map((text, index) => {
        const li = el('li', 'qsorow')
        li.append(button(text, () => this.nav.editQso(index), cls))
        return li
      }),
    )
  }
}

function pointsSuffix(s: ScoredQso | undefined): string {
  return s ? `  ${s.dupe ? t('qsolist.dupe') : s.points}` : ''
}

/** A row's columns for the aligned layout; the last one (points) is right-aligned. */
function rowCells(q: Qso, s: ScoredQso | undefined): string[] {
  return [
    stamp(q.timeOn),
    q.call,
    q.signal.band,
    q.signal.mode,
    `${q.report.sent}/${q.report.rcvd}`,
    q.sentSerial || q.serial ? `#${q.sentSerial ?? '—'}/${q.serial ?? '—'}` : '',
    q.grid ?? q.name ?? '',
    q.theirRef?.value ?? '',
    q.satName ? `🛰${q.satName}` : '',
    s ? (s.dupe ? t('qsolist.dupe') : String(s.points)) : '',
  ]
}

/** Pad every column to its widest value in this log; columns empty in every row drop out. */
function alignRows(rows: readonly string[][]): string[] {
  const n = rows[0]?.length ?? 0
  const widths = Array.from({ length: n }, (_, c) => Math.max(...rows.map((r) => r[c]!.length)))
  const last = n - 1
  return rows.map((r) =>
    r
      .map((cell, c) => (c === last ? cell.padStart(widths[c]!) : cell.padEnd(widths[c]!)))
      .filter((_, c) => widths[c]! > 0)
      .join('  ')
      .trimEnd(),
  )
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
