// Logging screen (ch. 4, 5, 10, 11). Real input line without <input>; two-phase
// Enter; DUPE warning; strip suggestions + locator prefill from the callsign
// database (bundled set + live layer, calldb.ts); crash-journal mirror. One specific log, passed in by the App.

import {
  tokenize,
  classifyLine,
  parseLine,
  reduce,
  initialState,
  writeQso,
  readLogFile,
  writeLogFile,
  matchCommand,
  hasContent,
  LiveDb,
  combineSources,
  dbDate,
  emptySuggestions,
  userHeader,
  isDupe,
  qsoPoints,
  defaultReport,
  applySatellite,
  satelliteByLabel,
  SATELLITES,
  PROFILES,
} from '../../core/index'
import type { CoreState, SuggestionSource, LogMeta, PartialQso, Qso } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { BUNDLED_DB_SETTING, bundledSource } from '../bundled-db'
import { t } from '../i18n'
import { createKeyboard } from '../keyboard'
import type { KeyAction } from '../keys'

export interface LoggingNav {
  toLogList(): void
  toQsoList(): void
  editQso(index: number): void
  toHelp(): void
}

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))
const pad3 = (n: number): string => String(n).padStart(3, '0')
const RECENT_MAX = 30 // wide layout: rows rendered; CSS clips whatever doesn't fit
// Same breakpoint as the landscape layout in styles.css.
const WIDE = window.matchMedia('(min-aspect-ratio: 1/1)')
const hhmm = (d: Date): string => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`

export class LoggingScreen implements Screen {
  private meta!: LogMeta
  private state!: CoreState
  private line = ''
  private qsos: Qso[] = [] // current log, for DUPE + count
  private db: SuggestionSource = emptySuggestions
  private live = new LiveDb() // own worked stations; persisted on every commit
  private satLabel = '' // current satellite (Satellite profile only)
  private notice = '' // one-shot result of a line command (W/D), shown in the strip until the next key

  private readonly hdr = el('header', 'hdr')
  private readonly inputEl = el('div', 'inputline')
  private readonly previewEl = el('div', 'preview')
  private readonly stripEl = el('div', 'strip')
  private readonly recentEl = el('ol', 'recent') // wide layout only (hidden in portrait by CSS)
  private readonly banner = el('div', 'banner')
  private readonly onKeydown = (e: KeyboardEvent): void => this.onHardwareKey(e)
  private readonly onWideChange = (): void => this.renderStrip()

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly logId: string,
    private readonly nav: LoggingNav,
  ) {}

  mount(root: HTMLElement): void {
    this.banner.hidden = true
    this.meta = DEFAULT_META
    this.state = initialState(DEFAULT_META)
    const kb = createKeyboard((a) => this.onKey(a))
    // Portrait band order (ch. 4): header · input · preview · strip · keyboard.
    const screen = el('div', 'screen screen--log')
    screen.append(this.hdr, this.banner, this.inputEl, this.previewEl, this.stripEl, this.recentEl, kb)
    root.replaceChildren(screen)
    window.addEventListener('keydown', this.onKeydown)
    WIDE.addEventListener('change', this.onWideChange)
    void this.init()
  }

  unmount(): void {
    window.removeEventListener('keydown', this.onKeydown)
    WIDE.removeEventListener('change', this.onWideChange)
    this.platform.keepAwake(false)
  }

  private async init(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))
    this.meta = meta
    this.qsos = qsos
    // Callsign DB: the live layer always; the profile's bundled set unless switched
    // off in Settings. Read on every mount, so the switch applies without a restart.
    this.live = LiveDb.fromText(await this.platform.readCallDb())
    const setId = PROFILES[meta.profile].bundledDb
    const useBundled = (await this.platform.getSetting(BUNDLED_DB_SETTING)) !== '0'
    this.db = combineSources(setId && useBundled ? bundledSource(setId) : null, this.live)
    this.state = initialState(this.meta)
    // Satellite log: the bird is fixed at log creation (one log per pass). Apply it
    // so band/mode/SAT_NAME are set; the header just shows it (read-only).
    if (PROFILES[this.meta.profile].fixedBand) {
      const label = this.meta.satLabel ?? (await this.platform.getSetting('satLabel')) ?? ''
      const sat = satelliteByLabel(label) ?? SATELLITES[0]!
      this.satLabel = sat.label
      this.state = { ...this.state, sticky: applySatellite(this.state.sticky, sat, 'SSB') }
    }
    this.platform.keepAwake(true) // ch. 16
    await this.offerRecovery()
    this.renderRecent()
    this.renderAll()
  }

  // --- input -----------------------------------------------------------------

  private onHardwareKey(e: KeyboardEvent): void {
    const k = e.key
    if (k === 'Enter') return this.handled(e, { type: 'enter' })
    if (k === 'Backspace') return this.handled(e, { type: 'backspace' })
    if (k === ' ') return this.handled(e, { type: 'space' })
    if (/^[A-Za-z0-9/]$/.test(k)) return this.handled(e, { type: 'char', value: k.toUpperCase() })
  }

  private handled(e: KeyboardEvent, a: KeyAction): void {
    e.preventDefault()
    this.onKey(a)
  }

  private onKey(a: KeyAction): void {
    if (a.type !== 'enter') this.notice = ''
    switch (a.type) {
      case 'char':
        this.stampFirstKeystroke()
        this.line += a.value
        break
      case 'space':
        this.stampFirstKeystroke()
        this.line += ' '
        break
      case 'backspace':
        this.line = this.line.slice(0, -1)
        break
      case 'enter':
        void this.commit()
        return
    }
    this.renderAll()
  }

  private stampFirstKeystroke(): void {
    if (!this.state.partial.timeOn) {
      this.state = reduce(this.state, { type: 'firstKeystroke', at: new Date() }, this.meta).state
    }
  }

  private async commit(): Promise<void> {
    const hadContent = hasContent(this.state.partial)
    const r = reduce(this.state, { type: 'enter', line: this.line }, this.meta)
    this.state = r.state
    if (r.clearInput) this.line = ''

    if (r.command) {
      await this.runCommand(r.command, hadContent)
      this.renderAll()
      return
    }

    if (r.committed) {
      // VKV contest: stamp the auto-incremented sent serial (STX) at commit time.
      const committed = PROFILES[this.meta.profile].serialAfterCall
        ? { ...r.committed, sentSerial: pad3(this.qsos.length + 1) }
        : r.committed
      await this.platform.appendQso(this.logId, writeQso(committed))
      await this.platform.clearJournal(this.logId)
      this.qsos.push(committed)
      this.renderRecent()
      this.live.record(committed.call, committed.grid, dbDate(committed.timeOn))
      await this.platform.writeCallDb(this.live.toText(userHeader(new Date())))
      this.banner.hidden = true
    } else if (this.state.hasStarted && this.state.partial.call) {
      await this.platform.writeJournal(this.logId, serialize(this.state.partial))
    }
    this.renderAll()
  }

  // --- line commands (ch. 9.5) ----------------------------------------------

  private async runCommand(cmd: 'wipe' | 'deleteLast' | 'deleteLastBlocked', hadContent: boolean): Promise<void> {
    if (cmd === 'deleteLastBlocked') {
      this.notice = t('logging.deleteLastBlocked')
      return
    }
    // Both leave the accumulator empty → nothing left to recover after a crash.
    await this.platform.clearJournal(this.logId)
    this.banner.hidden = true
    if (cmd === 'wipe') {
      this.notice = hadContent ? t('logging.wiped') : ''
      return
    }
    const last = this.qsos[this.qsos.length - 1]
    if (!last) {
      this.notice = t('logging.nothingToDelete')
      return
    }
    // Deleting a SAVED QSO is the one destructive command → confirm, showing which.
    if (!confirm(t('logging.deleteLastConfirm', { qso: formatQso(last) }))) return
    this.qsos.pop()
    // Same path as the QSO edit screen: rewrite the whole file (ch. 13, rare).
    await this.platform.rewriteLog(this.logId, writeLogFile(this.meta, this.qsos))
    this.renderRecent()
    this.notice = t('logging.deletedLast', { qso: formatQso(last) })
  }

  // --- crash-journal recovery (ch. 13) --------------------------------------

  private async offerRecovery(): Promise<void> {
    const text = (await this.platform.readJournal(this.logId)).trim()
    if (!text) return
    let partial: PartialQso
    try {
      partial = revive(JSON.parse(text) as PartialQso)
    } catch {
      await this.platform.clearJournal(this.logId)
      return
    }
    this.banner.replaceChildren(
      el('span', undefined, t('logging.recover', { call: partial.call ?? '' }) + ' '),
      button(t('logging.recoverYes'), () => {
        this.state = { ...this.state, partial, hasStarted: true }
        this.banner.hidden = true
        this.renderAll()
      }),
      button(t('logging.recoverNo'), () => {
        void this.platform.clearJournal(this.logId)
        this.banner.hidden = true
      }),
    )
    this.banner.hidden = false
  }

  // --- rendering -------------------------------------------------------------

  private renderAll(): void {
    this.renderHeader()
    this.renderLine()
    this.renderPreview()
    this.renderStrip()
  }

  private renderHeader(): void {
    const s = this.state.sticky
    const mid = el('div', 'hdr-mid')
    const profile = PROFILES[this.meta.profile]
    if (profile.fixedBand) {
      // Satellite (chosen at log creation): bird + mode only — the up/down bands are
      // fixed by the bird and didn't fit the narrow Kompakt header.
      mid.append(el('b', 'hdr-sat', `${this.satLabel} ${s.mode}`))
    } else {
      mid.append(el('b', undefined, `${s.band} ${s.mode}`))
    }
    // VKV: show the next sent serial so the operator knows what to give out.
    if (profile.serialAfterCall) {
      mid.append(el('b', 'hdr-tx', `TX ${pad3(this.qsos.length + 1)}`))
    }
    this.hdr.replaceChildren(
      button(t('logging.navLogs'), () => this.close(), 'hdr-nav'),
      mid,
      button('?', () => this.nav.toHelp(), 'hdr-nav'),
      button(`QSO ${this.qsos.length} ›`, () => this.nav.toQsoList(), 'hdr-nav'),
    )
  }

  // No export prompt on close — it nagged on every exit; export lives in the log list.
  private close(): void {
    this.nav.toLogList()
  }

  private renderLine(): void {
    this.inputEl.replaceChildren(document.createTextNode(this.line), el('span', 'cursor'))
    // DUPE (ch. 10): invert the input line. Satellite dupe keys on call + SAT_NAME
    // (a station can be re-worked on another bird); VHF contest call + band; otherwise call + band + mode.
    const call = this.effectiveCall()
    const s = this.state.sticky
    const dupe =
      call !== undefined &&
      (PROFILES[this.meta.profile].fixedBand
        ? this.qsos.some((q) => q.call.toUpperCase() === call.toUpperCase() && q.satName === s.satName)
        : isDupe(this.qsos, call, s.band, this.dupeMode()))
    this.inputEl.classList.toggle('inputline--dupe', dupe)
  }

  private renderPreview(): void {
    const profile = PROFILES[this.meta.profile]
    // A lone W/D: show what Enter will do instead of parsing it (W would be a name).
    const cmd = matchCommand(this.line)
    if (cmd) {
      // D is refused while a QSO is unfinished — say so here, not only after Enter.
      const blocked = cmd === 'deleteLast' && hasContent(this.state.partial)
      const what = cmd === 'wipe' ? t('logging.cmdWipe') : blocked ? t('logging.cmdBlocked') : t('logging.cmdDeleteLast')
      this.previewEl.replaceChildren(fieldChip(this.line.trim(), what, blocked))
      return
    }
    // Dry-run the current line onto the accumulated QSO so the preview shows what
    // will actually be SAVED — filled fields, plus (for VKV) the still-missing ones.
    const { partial: p, tokens } = parseLine(this.line, this.state.sticky, this.state.partial, profile)
    const chips: HTMLElement[] = []
    if (p.call) {
      chips.push(fieldChip('CALL', p.call))
      chips.push(fieldChip('RST', p.reportRcvd ?? defaultReport(this.state.sticky.mode)))
      if (p.reportSent) chips.push(fieldChip('TX-RST', p.reportSent))
      if (profile.serialAfterCall) chips.push(fieldChip('NR', p.serial ?? '—', p.serial === undefined))
      // Locator is expected in VKV and Satellite exchanges → always show (— if missing).
      if (profile.serialAfterCall || profile.fixedBand || p.grid !== undefined) {
        chips.push(fieldChip('LOC', p.grid ?? '—', p.grid === undefined))
      }
      // VHF contest: the QSO's points (= km + 1, IARU R1) as soon as the locator is known.
      const qrb = profile.contest && p.grid !== undefined ? qsoPoints(this.meta.myGrid, p.grid) : undefined
      if (qrb !== undefined) chips.push(fieldChip('QRB', `${qrb} km`))
      if (p.theirRef) chips.push(fieldChip('REF', p.theirRef.value))
      if (p.name) chips.push(fieldChip('NAME', p.name))
    }
    for (const t of tokens) if (t.cls.type === 'unknown') chips.push(unknownChip(t.raw))
    this.previewEl.replaceChildren(...chips)
  }

  private renderStrip(): void {
    if (this.notice) {
      this.stripEl.replaceChildren(document.createTextNode(this.notice))
      return
    }
    const frag = this.line.trim()
    // ≥2 chars → callsign suggestions from history (ch. 10).
    if (frag.length >= 2) {
      const hits = this.db.search(frag, 3)
      if (hits.length > 0) {
        this.stripEl.replaceChildren(
          ...hits.map(({ call }) => {
            // Already worked on this band+mode → mark it (inverse), so a dupe stands out.
            const worked = isDupe(this.qsos, call, this.state.sticky.band, this.dupeMode())
            return this.suggestButton(call, () => this.fillCall(call), worked ? 'suggest suggest--worked' : 'suggest')
          }),
        )
        return
      }
    }
    // Completed call with a known locator → prefill chip (ch. 10).
    const call = this.state.partial.call
    const loc = call ? this.db.lookup(call)?.loc : undefined
    if (loc && this.state.partial.grid === undefined) {
      this.stripEl.replaceChildren(this.suggestButton(`+ ${loc}`, () => this.fillGrid(loc), 'suggest suggest--ghost'))
      return
    }
    // Default: last written QSO (ch. 10). The wide layout already lists it in the
    // recent-QSO column, so the strip stays empty there.
    const last = this.qsos.length > 0 ? this.qsos[this.qsos.length - 1] : undefined
    if (WIDE.matches) this.stripEl.replaceChildren()
    else this.stripEl.replaceChildren(document.createTextNode(last ? formatQso(last) : '—'))
  }

  /** Wide layout: the latest QSOs, newest at the bottom next to the input; tap to edit.
   *  Only re-rendered when the log changes, not per keystroke (e-ink repaints). */
  private renderRecent(): void {
    const from = Math.max(0, this.qsos.length - RECENT_MAX)
    this.recentEl.replaceChildren(
      ...this.qsos.slice(from).map((q, i) => {
        const li = el('li')
        li.append(button(formatQso(q), () => this.nav.editQso(from + i), 'recent-row'))
        return li
      }),
    )
  }

  private suggestButton(label: string, onTap: () => void, cls = 'suggest'): HTMLButtonElement {
    const b = el('button', cls, label)
    b.type = 'button'
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      onTap()
    })
    return b
  }

  private fillCall(call: string): void {
    this.stampFirstKeystroke()
    this.line = call
    this.renderAll()
  }

  private fillGrid(grid: string): void {
    this.state = { ...this.state, partial: { ...this.state.partial, grid } }
    this.renderAll()
  }

  /** Mode for the dupe check: a VHF contest counts each station once per band, any mode. */
  private dupeMode(): string | undefined {
    return PROFILES[this.meta.profile].contest ? undefined : this.state.sticky.mode
  }

  private effectiveCall(): string | undefined {
    // A call typed on the current line wins — it replaces the accumulated one on Enter.
    const partialCall = this.state.partial.call
    const tokens = classifyLine(tokenize(this.line), PROFILES[this.meta.profile], partialCall !== undefined)
    for (const { cls } of tokens) if (cls.type === 'call') return cls.value
    return partialCall
  }
}

// The single hardcoded fallback meta used only until init() loads the real log.
const DEFAULT_META: LogMeta = {
  name: 'kQSO',
  profile: 'aktivace',
  myCall: 'OK1CDJ',
  myGrid: 'JN79US',
  defaultSignal: { band: '40m', mode: 'SSB' },
}

// A parse-preview chip showing a QSO field that will be saved. `missing` renders it
// as an empty placeholder so the operator sees what is not yet filled (ch. 10).
function fieldChip(label: string, value: string, missing = false): HTMLElement {
  const e = el('span', missing ? 'tok tok--missing' : 'tok', value)
  e.append(el('small', undefined, label))
  return e
}

function unknownChip(raw: string): HTMLElement {
  const e = el('span', 'tok tok--unknown', raw)
  e.title = raw
  e.append(el('small', undefined, '?'))
  return e
}

function formatQso(q: Qso): string {
  const ref = q.theirRef ? ` ${q.theirRef.value}` : ''
  const grid = q.grid ? ` ${q.grid}` : ''
  const nums = q.sentSerial || q.serial ? ` #${q.sentSerial ?? '—'}/${q.serial ?? '—'}` : ''
  return `${hhmm(q.timeOn)} ${q.call} ${q.report.sent}/${q.report.rcvd}${nums}${grid}${ref}`
}

function serialize(p: PartialQso): string {
  return JSON.stringify(p, (_k, v) => (v instanceof Date ? v.toISOString() : v))
}

function revive(p: PartialQso): PartialQso {
  return p.timeOn ? { ...p, timeOn: new Date(p.timeOn as unknown as string) } : p
}
