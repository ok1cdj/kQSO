// Log list: name + QSO count, tap to open, per-row export/delete, and a
// "Nový log" button. The app's home screen. General/Satellite/VKV logs also get a
// manual Wavelog push once it's configured in Settings, with the last
// push result under the name. An activation with several references also exports
// one file per reference (each program wants its own upload).

import {
  PROFILES,
  WAVELOG_SETTINGS,
  WavelogError,
  apiBase,
  fillSatFrequencies,
  pushStatusKey,
  readLogFile,
  readPushStatus,
  refExportName,
  writeLogFile,
  writeRefExport,
} from '../../core/index'
import type { PushStatus, WavelogStation } from '../../core/index'
import type { KQSOPlatform, LogSummary } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { t } from '../i18n'
import { trackEvent } from '../stats'
import { pushAdif } from '../wavelog'
import { pushStatusText, wavelogErrorText } from '../wavelog-text'
import { RELEASES_PAGE, availableUpdate, dismissUpdate } from '../update'
import { appPromo, hideAppPromo } from '../stores'

interface WavelogTarget {
  readonly base: string
  readonly token: string
  readonly station: WavelogStation
}

export interface LogListNav {
  openLog(id: string): void
  newLog(): void
  openSettings(): void
  openHelp(): void
  exportEdi(id: string): void
}

export class LogListScreen implements Screen {
  private readonly root = el('div', 'screen screen--list')

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly nav: LogListNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {}

  private async render(): Promise<void> {
    const logs = await this.platform.listLogs()
    const wl = await this.wavelogTarget()
    const top = el('div', 'bar')
    top.append(
      el('h1', 'title', 'kQSO'),
      button(t('loglist.new'), () => this.nav.newLog(), 'btn btn--primary'),
      button('?', () => this.nav.openHelp(), 'btn btn--icon'),
      button('⚙', () => this.nav.openSettings(), 'btn btn--icon'),
    )

    const list = el('ul', 'loglist')
    if (logs.length === 0) {
      // First start: how to log, right where it's needed.
      const empty = el('li', 'empty', `${t('loglist.empty')} `)
      empty.append(button(t('loglist.howTo'), () => this.nav.openHelp(), 'btn btn--small'))
      list.append(empty)
    } else {
      for (const log of logs) list.append(this.row(log, wl, readPushStatus(await this.platform.getSetting(pushStatusKey(log.id)))))
    }
    // APK: a newer release → one quiet line under the bar (filled in once the check is back).
    const update = el('div', 'update-notice')
    update.hidden = true
    // Web on a phone / tablet: the app in its store, one line, hidden for good on request.
    const promo = el('div', 'update-notice')
    promo.hidden = true
    this.root.replaceChildren(top, update, promo, list)
    void this.showUpdate(update)
    void this.showPromo(promo)
  }

  private async showPromo(box: HTMLElement): Promise<void> {
    const p = await appPromo(this.platform)
    if (!p) return
    const get = el('a', 'btn btn--small', t(p.store === 'play' ? 'promo.play' : 'promo.appStore'))
    get.href = p.url
    get.target = '_blank'
    get.rel = 'noopener'
    const hide = button(t('update.hide'), () => {
      box.hidden = true
      void hideAppPromo(this.platform)
    }, 'btn btn--small')
    box.replaceChildren(el('span', undefined, t(p.store === 'play' ? 'promo.textAndroid' : 'promo.textIos')), get, hide)
    box.hidden = false
  }

  private async showUpdate(box: HTMLElement): Promise<void> {
    const v = await availableUpdate(this.platform)
    if (!v) return
    const get = el('a', 'btn btn--small', t('update.download'))
    get.href = RELEASES_PAGE
    get.target = '_blank'
    get.rel = 'noopener'
    const hide = button(t('update.hide'), () => {
      box.hidden = true
      void dismissUpdate(this.platform, v)
    }, 'btn btn--small')
    box.replaceChildren(el('span', undefined, t('update.available', { v })), get, hide)
    box.hidden = false
  }

  private row(log: LogSummary, wl: WavelogTarget | null, pushed: PushStatus | null): HTMLElement {
    const li = el('li', 'logrow')
    const open = button(`${log.name}  ·  ${log.qsoCount} QSO`, () => this.nav.openLog(log.id), 'logrow-open')
    const status = el('small', 'logrow-status', pushed ? pushStatusText(pushed) : '')
    status.hidden = !pushed
    open.append(status)
    const exportAll = (): void => {
      trackEvent('export', { format: 'adif', profile: log.profile })
      void this.fillSatFrequencies(log.id).then(() => this.platform.exportLog(log.id, `${log.id}.adi`))
    }
    let perRef: HTMLElement | undefined
    const exp = button(t('loglist.export'), () => {
      if (perRef) {
        perRef.hidden = !perRef.hidden
        return
      }
      if (!PROFILES[log.profile].usesReferences) return exportAll()
      void this.refExports(log, exportAll).then((row) => {
        if (!row) return exportAll()
        perRef = row
        li.after(row)
      })
    }, 'btn btn--small')
    const del = button(t('loglist.delete'), () => void this.remove(log), 'btn btn--small')
    li.append(open, exp)
    // VHF contest: EDI (REG1TEST) per band for the contest manager.
    if (PROFILES[log.profile].contest && log.qsoCount > 0) {
      li.append(button(t('loglist.edi'), () => this.nav.exportEdi(log.id), 'btn btn--small'))
    }
    // Activations go by mail / program upload, never to Wavelog.
    if (wl && PROFILES[log.profile].wavelogPush && log.qsoCount > 0) {
      const push = button(t('wl.push'), () => void this.push(log, wl, push, status), 'btn btn--small')
      li.append(push)
    }
    li.append(del)
    return li
  }

  /** An activation with several references: a row with the whole log and one file per
   *  reference (each program wants its own upload). Undefined for one reference or none. */
  private async refExports(log: LogSummary, exportAll: () => void): Promise<HTMLElement | undefined> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(log.id))
    const refs = meta.myRefs ?? []
    if (refs.length < 2) return undefined
    const row = el('li', 'logrow-refs')
    row.append(
      button(t('loglist.exportAll'), exportAll, 'btn btn--small'),
      ...refs.map((ref) =>
        button(`${ref.kind} ${ref.value}`, () => {
          trackEvent('export', { format: 'adif-ref', profile: log.profile })
          void this.platform.exportText(writeRefExport(qsos, ref), refExportName(log.id, ref))
        }, 'btn btn--small'),
      ),
    )
    return row
  }

  /** Satellite QSOs from before FREQ / FREQ_RX were stored get them written into the
   *  log file (once), so export and push carry the frequencies. */
  private async fillSatFrequencies(logId: string): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(logId))
    const filled = fillSatFrequencies(qsos)
    if (filled) await this.platform.rewriteLog(logId, writeLogFile(meta, filled))
  }

  /** URL + token + station from Settings, or null when Wavelog isn't set up. */
  private async wavelogTarget(): Promise<WavelogTarget | null> {
    const K = WAVELOG_SETTINGS
    const url = await this.platform.getSetting(K.url)
    const token = await this.platform.getSetting(K.token)
    const station = await this.platform.getSetting(K.station)
    if (!url || !token || !station) return null
    try {
      return { base: apiBase(url), token, station: JSON.parse(station) as WavelogStation }
    } catch {
      return null
    }
  }

  /** Push the whole log; safe to repeat (Wavelog skips dupes). Never retried automatically. */
  private async push(log: LogSummary, wl: WavelogTarget, btn: HTMLButtonElement, status: HTMLElement): Promise<void> {
    btn.disabled = true
    btn.textContent = t('wl.pushing')
    status.hidden = false
    let result: PushStatus
    try {
      await this.fillSatFrequencies(log.id)
      const { imported, skipped } = await pushAdif(wl.base, wl.token, wl.station.id, await this.platform.readLog(log.id))
      result = { at: new Date().toISOString(), ok: true, imported, skipped }
      trackEvent('wavelog-push', { profile: log.profile })
      status.textContent = pushStatusText(result)
    } catch (e) {
      result = { at: new Date().toISOString(), ok: false, error: e instanceof WavelogError ? e.kind : 'server' }
      status.textContent = wavelogErrorText(e) // full reason now; the short one after a reload
    }
    await this.platform.setSetting(pushStatusKey(log.id), JSON.stringify(result))
    btn.disabled = false
    btn.textContent = t('wl.push')
  }

  private async remove(log: LogSummary): Promise<void> {
    if (!confirm(t('loglist.deleteConfirm', { name: log.name, count: log.qsoCount }))) return
    await this.platform.deleteLog(log.id)
    await this.platform.setSetting(pushStatusKey(log.id), '')
    await this.render()
  }
}
