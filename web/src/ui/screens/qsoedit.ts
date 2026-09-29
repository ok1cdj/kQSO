// Edit / delete a single QSO. Classic form, not the parser. Saving and
// deleting rewrite the whole file via rewriteLog() — never append.

import { BANDS, MODES, PROFILES, matchBand, matchMode, parseReferenceInput, readLogFile, writeLogFile } from '../../core/index'
import type { Qso, Signal } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button, fieldError, fieldRow, selectRow } from '../dom'
import { t } from '../i18n'

// Include the QSO's current value even if it is not a dictionary band/mode (e.g. imported).
const bandOptions = (current: string): ReadonlyArray<readonly [string, string]> => {
  const list = BANDS.map((b) => [b, b] as const)
  return list.some(([v]) => v === current) ? list : [[current, current], ...list]
}
const modeOptions = (current: string): ReadonlyArray<readonly [string, string]> => {
  const list = MODES.map((m) => [m, m] as const)
  return list.some(([v]) => v === current) ? list : [[current, current], ...list]
}

export interface QsoEditNav {
  done(): void
}

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))
const dateStr = (d: Date): string => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`
const timeStr = (d: Date): string => `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`

export class QsoEditScreen implements Screen {
  private readonly root = el('form', 'screen screen--form')

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly logId: string,
    private readonly index: number,
    private readonly nav: QsoEditNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {}

  private async render(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))
    const orig = qsos[this.index]
    if (!orig) {
      this.nav.done()
      return
    }

    const call = fieldRow(t('qsoedit.call'), orig.call)
    const band = selectRow(t('qsoedit.band'), bandOptions(orig.signal.band), orig.signal.band)
    const mode = selectRow(t('qsoedit.mode'), modeOptions(orig.signal.mode), orig.signal.mode)
    const sent = fieldRow(t('qsoedit.rstSent'), orig.report.sent)
    const rcvd = fieldRow(t('qsoedit.rstRcvd'), orig.report.rcvd)
    const grid = fieldRow(t('qsoedit.locator'), orig.grid ?? '')
    // Same rule as logging: a VKV-contest QSO can't lose its locator.
    const gridRequired = PROFILES[meta.profile].requiresGrid
    const gridError = fieldError(grid, t('qsoedit.locatorRequired'))
    const name = fieldRow(t('qsoedit.name'), orig.name ?? '')
    const serial = fieldRow(t('qsoedit.serialRcvd'), orig.serial ?? '')
    const ref = fieldRow(t('qsoedit.ref'), orig.theirRef?.value ?? '')
    const date = fieldRow(t('qsoedit.dateUtc'), dateStr(orig.timeOn))
    const time = fieldRow(t('qsoedit.timeUtc'), timeStr(orig.timeOn))

    const actions = el('div', 'form-actions')
    actions.append(
      button(t('common.save'), () => {
        if (gridRequired && !grid.input.value.trim()) {
          gridError.show()
          return
        }
        void this.save(build())
      }, 'btn btn--primary'),
      button(t('common.delete'), () => void this.remove(), 'btn btn--danger'),
      button(t('common.back'), () => this.nav.done(), 'btn'),
    )

    this.root.replaceChildren(
      el('div', 'bar', t('qsoedit.title')),
      call.row,
      band.row,
      mode.row,
      sent.row,
      rcvd.row,
      grid.row,
      name.row,
      serial.row,
      ref.row,
      date.row,
      time.row,
      actions,
    )

    const build = (): Qso => {
      const signal: Signal = {
        band: matchBand(band.select.value) ?? band.select.value,
        mode: matchMode(mode.select.value) ?? mode.select.value,
      }
      if (orig.signal.bandRx !== undefined) (signal as { bandRx?: string }).bandRx = orig.signal.bandRx
      if (orig.signal.modeRx !== undefined) (signal as { modeRx?: string }).modeRx = orig.signal.modeRx

      const q: { -readonly [K in keyof Qso]: Qso[K] } = {
        call: call.input.value.trim().toUpperCase() || orig.call,
        timeOn: parseUtc(date.input.value.trim(), time.input.value.trim(), orig.timeOn),
        signal,
        report: { sent: sent.input.value.trim() || orig.report.sent, rcvd: rcvd.input.value.trim() || orig.report.rcvd },
        stationCall: orig.stationCall,
        myGrid: orig.myGrid,
      }
      const g = grid.input.value.trim().toUpperCase()
      if (g) q.grid = g
      const n = name.input.value.trim()
      if (n) q.name = n
      const r = parseReferenceInput(ref.input.value)
      if (r) q.theirRef = r
      if (orig.myRef !== undefined) q.myRef = orig.myRef
      const sn = serial.input.value.trim()
      if (sn) q.serial = sn
      if (orig.sentSerial !== undefined) q.sentSerial = orig.sentSerial // TX serial is auto, not edited
      if (orig.satName !== undefined) q.satName = orig.satName // satellite fields carried, not edited
      if (orig.satMode !== undefined) q.satMode = orig.satMode
      return q
    }

    // capture for save/remove
    this.commit = async (mutate: (list: Qso[]) => void): Promise<void> => {
      mutate(qsos)
      await this.platform.rewriteLog(this.logId, writeLogFile(meta, qsos))
      this.nav.done()
    }
  }

  private commit: ((mutate: (list: Qso[]) => void) => Promise<void>) | null = null

  private async save(updated: Qso): Promise<void> {
    await this.commit?.((list) => {
      list[this.index] = updated
    })
  }

  private async remove(): Promise<void> {
    if (!confirm(t('qsoedit.deleteConfirm'))) return
    await this.commit?.((list) => {
      list.splice(this.index, 1)
    })
  }
}

function parseUtc(date: string, time: string, fallback: Date): Date {
  if (!/^\d{8}$/.test(date) || !/^\d{3,4}$/.test(time)) return fallback
  const t = time.padStart(4, '0')
  const d = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    fallback.getUTCSeconds(),
  )
  return new Date(d)
}
