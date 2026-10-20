// EDI export for a VHF-contest log (REG1TEST): a short prefilled form, then
// one block per band — the rules want one file per band, and each band has its own
// equipment (power, antenna, antenna height, TX, RX). The category (from New log,
// changeable here) gives each band its PSect and the ČRK file name (01OK1XXX.edi).
// Contest fields (name, category, operators) are stored in the log header; the station
// (name, e-mail) and each band's equipment in Settings, saved as they are typed, so the
// next contest is prefilled band by band. The ADIF log stays whole.

import {
  LP_6H_BANDS,
  categoryFromSection,
  ediBand,
  ediBands,
  ediFileName,
  ediSection,
  equipmentFor,
  isIaruContestDate,
  parseEdiSettings,
  readLogFile,
  serializeEdiSettings,
  writeEdi,
  writeLogFile,
} from '../../core/index'
import type { ContestCategory, EdiContest, EdiEquipment, EdiSettings, EdiStation, LogMeta, Qso } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { categoryPicker } from '../contest-category'
import { el, button, fieldError, fieldRow } from '../dom'
import { t } from '../i18n'
import { trackEvent } from '../stats'

export interface EdiExportNav {
  back(): void
}

/** Settings key for the remembered station + per-band equipment (JSON, core/edi.ts). */
export const EDI_STATION_SETTING = 'ediStation'

/** LP in an IARU contest: at most 100 W PEP (rules: IARU R1, ČRK point 5). */
const LP_MAX_W = 100

export class EdiExportScreen implements Screen {
  private readonly root = el('form', 'screen screen--form')
  private meta!: LogMeta // kept current after the contest fields are saved
  private saved!: EdiSettings // remembered station + per-band equipment, updated as typed

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly logId: string,
    private readonly nav: EdiExportNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {}

  private async render(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))
    this.meta = meta
    this.saved = parseEdiSettings(await this.platform.getSetting(EDI_STATION_SETTING))
    const prev = meta.edi

    const contest = fieldRow(t('edi.contest'), prev?.contest ?? meta.name)
    const contestErr = fieldError(contest, t('edi.required'))
    // The log's category; a log exported before categories existed: from its PSect.
    const first = qsos[0]?.timeOn ?? new Date()
    const initial: ContestCategory =
      meta.category ?? (prev?.section ? categoryFromSection(prev.section) : { ops: 'SO', iaru: isIaruContestDate(first), variant: 'full' })
    const headings: Array<() => void> = [] // band headings show the band's PSect
    const category = categoryPicker(initial, () => {
      syncOps()
      for (const h of headings) h()
    })
    const operators = fieldRow(t('edi.operators'), prev?.operators ?? '', { placeholder: 'OK1ABC;OK1XYZ' })
    const syncOps = (): void => {
      operators.row.hidden = category.value().ops !== 'MO'
    }
    syncOps()

    const name = fieldRow(t('edi.name'), this.saved.station.name)
    const email = fieldRow(t('edi.email'), this.saved.station.email)
    const emailErr = fieldError(email, t('edi.required'))
    for (const f of [name, email]) f.input.autocapitalize = 'off'
    email.input.type = 'email'
    const readStation = (): EdiStation => ({ name: name.input.value.trim(), email: email.input.value.trim() })
    for (const f of [name, email]) f.input.addEventListener('change', () => void this.remember({ station: readStation() }))

    const readContest = (): EdiContest | null => {
      const cat = category.value()
      const c: EdiContest = {
        contest: contest.input.value.trim(),
        section: ediSection(cat, '2m'), // what kQSO ≤ 1.10 shows; the file takes it per band
        operators: cat.ops === 'MO' ? operators.input.value.trim().toUpperCase() : '',
      }
      if (!c.contest) {
        contestErr.show()
        return null
      }
      return c
    }

    const blocks: HTMLElement[] = []
    const scores = ediBands(qsos, meta.myGrid)
    if (scores.length === 0) blocks.push(el('p', 'empty', t('edi.noBands')))
    for (const b of scores) {
      const ediName = ediBand(b.band)!
      const eq = equipmentFor(this.saved, b.band)
      const power = fieldRow(t('edi.power'), eq.power)
      const powerErr = fieldError(power, t('edi.powerInvalid'))
      const antenna = fieldRow(t('edi.antenna'), eq.antenna)
      const antennaErr = fieldError(antenna, t('edi.required'))
      const height = fieldRow(t('edi.antennaHeight'), eq.antennaHeight, { placeholder: '10;650' })
      const tx = fieldRow(t('edi.tx'), eq.tx)
      const rx = fieldRow(t('edi.rx'), eq.rx)
      for (const f of [antenna, tx, rx]) f.input.autocapitalize = 'off'
      power.input.inputMode = 'numeric'
      const readEq = (): EdiEquipment => ({
        power: power.input.value.trim(),
        antenna: antenna.input.value.trim(),
        antennaHeight: height.input.value.trim(),
        tx: tx.input.value.trim(),
        rx: rx.input.value.trim(),
      })
      for (const f of [power, antenna, height, tx, rx]) {
        f.input.addEventListener('change', () => void this.remember({ band: b.band, eq: readEq() }))
      }

      const status = el('p', 'form-status') // right under this band's button
      // The IARU rules' minimum header: section, e-mail, power, antenna (+ call/locator/band, always set).
      const exportBand = (): void => {
        const c = readContest()
        if (!c) return
        const st = readStation()
        const e = readEq()
        const invalid = !st.email ? emailErr : !/^\d+(\s*W)?$/i.test(e.power) ? powerErr : !e.antenna ? antennaErr : null
        if (invalid) {
          invalid.show()
          return
        }
        const cat = category.value()
        if (cat.iaru && cat.variant === 'lp' && LP_6H_BANDS.includes(b.band) && Number(e.power.replace(/\D/g, '')) > LP_MAX_W) {
          powerErr.show(t('edi.lpPower', { max: LP_MAX_W }))
          return
        }
        void this.export(qsos, b.band, c, cat, st, e, status)
      }

      const heading = el('h2', 'form-section')
      const paintHeading = (): void => {
        heading.textContent = t('edi.band', { band: ediName, section: ediSection(category.value(), b.band), qsos: b.qsos, points: b.points })
      }
      paintHeading()
      headings.push(paintHeading)
      const block = el('div', 'edi-band')
      block.append(
        heading,
        power.row,
        antenna.row,
        height.row,
        tx.row,
        rx.row,
        button(t('edi.exportBand', { band: ediName }), exportBand, 'btn btn--primary'),
        status,
      )
      blocks.push(block)
    }

    this.root.replaceChildren(
      el('div', 'bar', `${t('edi.title')} · ${meta.name}`),
      contest.row,
      ...category.rows,
      operators.row,
      el('h2', 'form-section', t('edi.stationTitle')),
      name.row,
      email.row,
      el('p', 'about', t('edi.bands')),
      ...blocks,
      button(`‹ ${t('common.back')}`, () => this.nav.back(), 'btn'),
    )
  }

  /** Save the station or one band's equipment right away, for the next contest. */
  private async remember(change: { station: EdiStation } | { band: string; eq: EdiEquipment }): Promise<void> {
    this.saved =
      'station' in change
        ? { ...this.saved, station: change.station }
        : { ...this.saved, bands: { ...this.saved.bands, [change.band]: change.eq } }
    await this.platform.setSetting(EDI_STATION_SETTING, serializeEdiSettings(this.saved))
  }

  private async export(
    qsos: readonly Qso[],
    band: string,
    contest: EdiContest,
    category: ContestCategory,
    station: EdiStation,
    eq: EdiEquipment,
    status: HTMLElement,
  ): Promise<void> {
    // Remember everything first, so a re-export or the next contest is prefilled.
    await this.remember({ station })
    await this.remember({ band, eq })
    if (JSON.stringify(this.meta.edi) !== JSON.stringify(contest) || JSON.stringify(this.meta.category) !== JSON.stringify(category)) {
      this.meta = { ...this.meta, edi: contest, category }
      await this.platform.rewriteLog(this.logId, writeLogFile(this.meta, qsos))
    }
    const file = ediFileName(category, band, this.meta.myCall)
    await this.platform.exportText(writeEdi(this.meta, qsos, band, contest, category, station, eq), file)
    trackEvent('export', { format: 'edi', band })
    status.textContent = t('edi.exported', { file })
  }
}
