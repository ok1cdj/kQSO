// Log list: name + QSO count, tap to open, per-row export/delete, and a
// "Nový log" button. The app's home screen. General/Satellite/VKV logs also get a
// manual Wavelog push once it's configured in Settings, with the last
// push result under the name.

import { PROFILES, WAVELOG_SETTINGS, WavelogError, apiBase, pushStatusKey, readPushStatus } from '../../core/index'
import type { PushStatus, WavelogStation } from '../../core/index'
import type { KQSOPlatform, LogSummary } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { t } from '../i18n'
import { trackEvent } from '../stats'
import { pushAdif } from '../wavelog'
import { pushStatusText, wavelogErrorText } from '../wavelog-text'

interface WavelogTarget {
  readonly base: string
  readonly token: string
  readonly station: WavelogStation
}

export interface LogListNav {
  openLog(id: string): void
  newLog(): void
  openSettings(): void
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
      button('⚙', () => this.nav.openSettings(), 'btn btn--icon'),
    )

    const list = el('ul', 'loglist')
    if (logs.length === 0) {
      list.append(el('li', 'empty', t('loglist.empty')))
    } else {
      for (const log of logs) list.append(this.row(log, wl, readPushStatus(await this.platform.getSetting(pushStatusKey(log.id)))))
    }
    this.root.replaceChildren(top, list)
  }

  private row(log: LogSummary, wl: WavelogTarget | null, pushed: PushStatus | null): HTMLElement {
    const li = el('li', 'logrow')
    const open = button(`${log.name}  ·  ${log.qsoCount} QSO`, () => this.nav.openLog(log.id), 'logrow-open')
    const status = el('small', 'logrow-status', pushed ? pushStatusText(pushed) : '')
    status.hidden = !pushed
    open.append(status)
    const exp = button(t('loglist.export'), () => {
      trackEvent('export', { format: 'adif', profile: log.profile })
      void this.platform.exportLog(log.id, `${log.id}.adi`)
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
