// Logging screen. Real input line without <input>; two-phase
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
  matchKeyerCommand,
  hasContent,
  esmMessage,
  expandMacro,
  infoLabel,
  missingParts,
  padSerial,
  greeting,
  LiveDb,
  combineSources,
  dbDate,
  emptySuggestions,
  userHeader,
  isDupe,
  qsoPoints,
  bearingDeg,
  defaultReport,
  applySatellite,
  satelliteByLabel,
  SATELLITES,
  PROFILES,
} from '../../core/index'
import type { CoreState, SuggestionSource, LogMeta, PartialQso, Qso, KeyerCommand, MacroSlot } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button } from '../dom'
import { BUNDLED_DB_SETTING, bundledSource } from '../bundled-db'
import { t } from '../i18n'
import { alignColumns, allFit } from '../columns'
import { createKeyboard } from '../keyboard'
import type { KeyAction } from '../keys'
import type { KeyerController } from '../keyer'

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
const TX_SHOWN = 40 // keyboard mode: how much of the sent text the preview keeps
const hhmm = (d: Date): string => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
// Keyer macro buttons in the strip: slot + its short label (EXCH → EX, MYCALL → MY: with
// STOP it is seven buttons on a 360 px phone). INFO is labelled by the profile (REF / LOC).
const MACRO_BUTTONS: ReadonlyArray<readonly [MacroSlot, string | undefined]> = [
  ['CQ', 'CQ'],
  ['EXCH', 'EX'],
  ['TU', 'TU'],
  ['MYCALL', 'MY'],
  ['INFO', undefined],
  ['?', '?'],
]

export class LoggingScreen implements Screen {
  private meta!: LogMeta
  private state!: CoreState
  private line = ''
  private qsos: Qso[] = [] // current log, for DUPE + count
  private db: SuggestionSource = emptySuggestions
  private live = new LiveDb() // own worked stations; persisted on every commit
  private satLabel = '' // current satellite (Satellite profile only)
  // CW keyboard mode (K ⏎): typed words go out as CW, nothing goes into the QSO.
  private txMode = false
  private txWord = '' // the word being typed, not sent yet
  private txSent = '' // the tail of what went out, shown in the preview
  private notice = '' // one-shot result of a line command (W/D), shown in the strip until the next key

  private readonly hdr = el('header', 'hdr')
  private readonly inputEl = el('div', 'inputline')
  private readonly previewEl = el('div', 'preview')
  private readonly stripEl = el('div', 'strip')
  private readonly recentEl = el('ol', 'recent') // wide layout only (hidden in portrait by CSS)
  private recentResize: ResizeObserver | undefined
  private recentWidth = 0
  private readonly banner = el('div', 'banner')
  private readonly onKeydown = (e: KeyboardEvent): void => this.onHardwareKey(e)
  private readonly onWideChange = (): void => this.renderStrip()
  private unsubscribeKeyer: (() => void) | undefined

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly keyer: KeyerController,
    private readonly logId: string,
    private readonly nav: LoggingNav,
  ) {}

  mount(root: HTMLElement): void {
    this.banner.hidden = true
    this.meta = DEFAULT_META
    this.state = initialState(DEFAULT_META)
    const kb = createKeyboard((a) => this.onKey(a))
    // Portrait band order: header · input · preview · strip · keyboard.
    const screen = el('div', 'screen screen--log')
    screen.append(this.hdr, this.banner, this.inputEl, this.previewEl, this.stripEl, this.recentEl, kb)
    root.replaceChildren(screen)
    window.addEventListener('keydown', this.onKeydown)
    WIDE.addEventListener('change', this.onWideChange)
    this.unsubscribeKeyer = this.keyer.subscribe(() => this.onKeyerChange())
    void this.init()
  }

  unmount(): void {
    window.removeEventListener('keydown', this.onKeydown)
    WIDE.removeEventListener('change', this.onWideChange)
    this.unsubscribeKeyer?.()
    this.exitTx()
    this.recentResize?.disconnect()
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
    this.platform.keepAwake(true)
    await this.offerRecovery()
    this.renderRecent()
    this.renderAll()
    if (!this.platform.nativeVersion) {
      // Re-check the alignment when the column width changes (rotation → wide layout).
      this.recentResize = new ResizeObserver(() => {
        if (this.recentEl.clientWidth !== this.recentWidth) this.renderRecent()
      })
      this.recentResize.observe(this.recentEl)
    }
  }

  // --- input -----------------------------------------------------------------

  private onHardwareKey(e: KeyboardEvent): void {
    const k = e.key
    if (k === 'Escape' && this.keyerOn()) {
      e.preventDefault()
      // Esc = STOP; with nothing on the air it leaves keyboard mode.
      if (this.txMode && !this.keyer.sending) this.exitTx()
      else void this.keyer.stop()
      this.renderAll()
      return
    }
    // Keyboard mode also takes the keyer's punctuation from a hardware keyboard.
    if (this.txMode && /^[?.,=+-]$/.test(k)) return this.handled(e, { type: 'char', value: k })
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
    if (this.txMode) return this.onTxKey(a)
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
    // Keyer commands (R / S / S20) only while CW keying is on — otherwise R / S stay a name.
    const kc = this.keyerOn() ? matchKeyerCommand(this.line) : undefined
    if (kc) {
      await this.runKeyerCommand(kc)
      this.renderAll()
      return
    }
    const hadContent = hasContent(this.state.partial)
    const before = { lineEmpty: this.line.trim() === '', hadContent, hadCall: this.state.partial.call !== undefined }
    const r = reduce(this.state, { type: 'enter', line: this.line }, this.meta)
    this.state = r.state
    if (r.clearInput) this.line = ''

    if (r.command) {
      await this.runCommand(r.command, hadContent)
      this.renderAll()
      return
    }

    let committed: Qso | undefined
    if (r.committed) {
      // VKV contest: stamp the auto-incremented sent serial (STX) at commit time.
      committed = PROFILES[this.meta.profile].serialAfterCall
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
    // ESM: Enter sends the macro for what it just did (after the save, so the macro
    // carries the saved QSO's call, report and number).
    if (this.esmOn()) {
      const slot = esmMessage(this.keyer.mode, before, {
        committed: committed !== undefined,
        hasCall: this.state.partial.call !== undefined,
        missing: missingParts(this.state.partial, PROFILES[this.meta.profile]),
      })
      if (slot) await this.sendMacro(slot, committed)
    }
  }

  /** ESM applies: keying on, CW, keyer connected, ESM switched on. */
  private esmOn(): boolean {
    return this.keyerOn() && this.keyer.connected && this.keyer.esm
  }

  // --- line commands ----------------------------------------------

  private async runCommand(cmd: 'wipe' | 'deleteLast' | 'deleteLastBlocked' | 'help', hadContent: boolean): Promise<void> {
    if (cmd === 'help') {
      this.nav.toHelp()
      return
    }
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
    // Same path as the QSO edit screen: rewrite the whole file (rare).
    await this.platform.rewriteLog(this.logId, writeLogFile(this.meta, this.qsos))
    this.renderRecent()
    this.notice = t('logging.deletedLast', { qso: formatQso(last) })
  }

  // --- CW keyer ------------------------------------------------------

  /** Keying on and the mode is CW: header, macros, R / S / S20 and Esc apply. */
  private keyerOn(): boolean {
    return this.keyer.activeFor(this.state.sticky.mode)
  }

  private async runKeyerCommand(kc: KeyerCommand): Promise<void> {
    this.line = ''
    // The command letter stamped the QSO time; drop it unless a QSO is under way.
    if (!hasContent(this.state.partial)) this.state = { ...this.state, partial: {}, hasStarted: false }
    if (kc.type === 'run' || kc.type === 'sp') {
      // No notice: the header shows RUN / S&P, and the strip keeps the macro buttons.
      await this.keyer.setMode(kc.type)
      this.notice = ''
    } else if (kc.type === 'connect') {
      this.notice = ''
      await this.keyer.reconnect()
    } else if (kc.type === 'esm') {
      // No notice: the header shows ESM.
      this.notice = ''
      await this.keyer.setEsm(!this.keyer.esm)
    } else if (kc.type === 'keyboard' || kc.type === 'text') {
      if (!this.keyer.connected) this.notice = t('logging.cmdSpeedOff')
      else if (kc.type === 'keyboard') this.enterTx()
      else {
        this.notice = ''
        await this.sendKeyed(kc.text)
      }
    } else if (!kc.inRange) {
      this.notice = t('logging.cmdSpeedRange')
    } else if (!this.keyer.connected) {
      this.notice = t('logging.cmdSpeedOff')
    } else {
      // No notice: the header shows the speed, and the strip keeps the macro buttons.
      await this.keyer.setSpeed(kc.wpm)
      this.notice = ''
    }
  }

  /** Expand a slot of the current profile × RUN / S&P and send it. Values come from
   *  what Enter would save now (typed line included). With no new call typed they all
   *  come from the last saved QSO — a repeat (AGN?) gets the same call, report and
   *  number again, not the next number; likewise `saved`, the QSO an ESM Enter has just
   *  saved (S&P sends its exchange with that QSO's number). */
  private async sendMacro(slot: MacroSlot, saved?: Qso): Promise<void> {
    const dry = parseLine(this.line, this.state.sticky, this.state.partial, PROFILES[this.meta.profile]).partial
    const last = this.qsos.length > 0 ? this.qsos[this.qsos.length - 1] : undefined
    const from = saved ?? (dry.call === undefined ? last : undefined)
    const common = { myCall: this.meta.myCall, myLoc: this.meta.myGrid, myRef: this.meta.myRef?.value, hi: greeting(new Date()) }
    const text = expandMacro(
      this.keyer.macroText(this.meta.profile, slot),
      from
        ? {
            ...common,
            call: from.call,
            rst: from.report.sent,
            nr: from.sentSerial ?? pad3(this.qsos.length),
            loc: from.grid,
            ref: from.theirRef?.value,
          }
        : {
            ...common,
            call: dry.call,
            rst: dry.reportSent ?? defaultReport(this.state.sticky.mode),
            nr: pad3(this.qsos.length + 1),
            loc: dry.grid,
            ref: dry.theirRef?.value,
          },
    )
    // An empty macro (INFO in the general profile until filled in) would do nothing silently.
    if (text === '') {
      this.notice = t('logging.macroEmpty', { slot: slot === 'INFO' ? infoLabel(this.meta.profile) : slot })
      this.renderStrip()
      return
    }
    await this.sendKeyed(text)
  }

  /** Send text as is; characters the keyer can't send are named in the strip. */
  private async sendKeyed(text: string): Promise<void> {
    const dropped = await this.keyer.send(text)
    if (dropped.length > 0) {
      this.notice = t('logging.keyerDropped', { chars: dropped.join(' ') })
      this.renderStrip()
    }
  }

  // --- CW keyboard mode (K ⏎) -------------------------------------------------
  // Space sends the word just typed (type-ahead, the keyer queues it); Backspace edits
  // only the unsent word; Enter sends it, an empty Enter ends the mode (so do KONEC,
  // Esc with nothing on the air, leaving the screen and a dropped keyer).

  private enterTx(): void {
    this.txMode = true
    this.txWord = ''
    this.txSent = ''
    this.notice = ''
  }

  private exitTx(): void {
    this.txMode = false
    this.txWord = ''
    this.txSent = ''
  }

  private onTxKey(a: KeyAction): void {
    this.notice = ''
    switch (a.type) {
      case 'char':
        this.txWord += a.value
        break
      case 'space':
        this.flushTx()
        break
      case 'backspace':
        this.txWord = this.txWord.slice(0, -1)
        break
      case 'enter':
        if (this.txWord.trim()) this.flushTx()
        else this.exitTx()
        break
    }
    this.renderAll()
  }

  private flushTx(): void {
    const word = this.txWord.trim()
    this.txWord = ''
    if (!word) return
    this.txSent = `${this.txSent} ${word}`.trim().slice(-TX_SHOWN)
    void this.sendKeyed(word)
  }

  private onKeyerChange(): void {
    const n = this.keyer.notice
    if (this.txMode && !this.keyer.connected) this.exitTx()
    if (n?.type === 'error') {
      this.notice = t('logging.keyerError', { what: n.what })
      this.keyer.clearNotice()
    } else if (n?.type === 'connectFailed') {
      this.notice = t('settings.keyerFailed', { msg: n.message })
      this.keyer.clearNotice()
    }
    this.renderAll()
  }

  /** STOP while the keyer is sending — always first in the strip, even before suggestions. */
  private stopButtons(): HTMLElement[] {
    if (!this.keyerOn() || !this.keyer.connected || !this.keyer.sending) return []
    return [this.suggestButton('STOP', () => void this.keyer.stop(), 'suggest suggest--stop')]
  }

  // --- crash-journal recovery --------------------------------------

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
    // Dry-run the current line onto the accumulated QSO once; the header (azimuth)
    // and the preview both show what will actually be saved.
    const dry = parseLine(this.line, this.state.sticky, this.state.partial, PROFILES[this.meta.profile])
    this.renderHeader(dry.partial)
    this.renderLine()
    this.renderPreview(dry)
    this.renderStrip()
  }

  private renderHeader(p: PartialQso): void {
    const s = this.state.sticky
    const mid = el('div', 'hdr-mid')
    const profile = PROFILES[this.meta.profile]
    if (profile.fixedBand) {
      // Satellite (chosen at log creation): bird + mode only — the up/down bands are
      // fixed by the bird and didn't fit the narrow Kompakt header.
      mid.append(el('b', 'hdr-sat', `${this.satLabel} ${s.mode}`))
    } else {
      // With the keyer badge the mode is CW by definition — drop it, the header is tight.
      mid.append(el('b', undefined, this.keyerOn() ? s.band : `${s.band} ${s.mode}`))
    }
    // VKV: show the next sent serial so the operator knows what to give out (boxed, no
    // "TX" label — the header is tight on a phone).
    if (profile.serialAfterCall) {
      const b = el('b', 'hdr-tx', pad3(this.qsos.length + 1))
      b.title = 'TX'
      mid.append(b)
    }
    // VHF contest: where to point the antenna. A typed locator wins; else the one the
    // callsign database knows for the call, greyed like its + LOC suggestion.
    // CW keyer: RUN / S&P + speed, and whether the link is up (✕ = not connected, tap = connect).
    if (this.keyerOn()) {
      const link = this.keyer.link
      const wpm = this.keyer.wpm
      const state = link === 'off' ? ' ✕' : link === 'connecting' ? ' …' : wpm !== undefined ? ` ${wpm}` : ''
      // Keyboard mode: TX instead of RUN / S&P, inverted. ·ESM = Enter sends the macros.
      const what = this.txMode ? 'TX' : `${this.keyer.mode === 'run' ? 'RUN' : 'S&P'}${this.keyer.esm ? '·ESM' : ''}`
      const label = `${what}${state}`
      const cls = link !== 'on' ? 'hdr-keyer hdr-keyer--off' : this.txMode ? 'hdr-keyer hdr-keyer--tx' : 'hdr-keyer'
      mid.append(button(label, () => void this.keyer.reconnect(), cls))
    }
    if (profile.contest) {
      const known = p.grid === undefined && p.call !== undefined ? this.db.lookup(p.call)?.loc : undefined
      const az = bearingDeg(this.meta.myGrid, p.grid ?? known ?? '')
      if (az !== undefined) mid.append(el('b', known ? 'hdr-az hdr-az--guess' : 'hdr-az', `${az}°`))
    }
    this.hdr.replaceChildren(
      this.navLogsButton(),
      mid,
      button('?', () => this.nav.toHelp(), 'hdr-nav'),
      button(`QSO ${this.qsos.length} ›`, () => this.nav.toQsoList(), 'hdr-nav'),
    )
  }

  /** "‹ Logy"; on a narrow phone only "‹" (styles.css), so the header middle fits. */
  private navLogsButton(): HTMLButtonElement {
    const b = button('‹', () => this.close(), 'hdr-nav')
    b.title = t('logging.navLogs')
    b.append(el('span', 'hdr-nav-word', ` ${t('logging.navLogs')}`))
    return b
  }

  // No export prompt on close — it nagged on every exit; export lives in the log list.
  private close(): void {
    this.nav.toLogList()
  }

  private renderLine(): void {
    this.inputEl.classList.toggle('inputline--tx', this.txMode)
    if (this.txMode) {
      this.inputEl.replaceChildren(el('span', 'tx-prompt', 'CW›'), document.createTextNode(` ${this.txWord}`), el('span', 'cursor'))
      this.inputEl.classList.remove('inputline--dupe')
      return
    }
    this.inputEl.replaceChildren(document.createTextNode(this.line), el('span', 'cursor'))
    // DUPE: invert the input line. Satellite dupe keys on call + SAT_NAME
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

  private renderPreview(dry: ReturnType<typeof parseLine>): void {
    if (this.txMode) {
      // What went out so far, else how the mode works.
      this.previewEl.replaceChildren(el('span', 'tx-sent', this.txSent || t('logging.txHint')))
      return
    }
    const profile = PROFILES[this.meta.profile]
    // Keyer R / S / S20: what Enter will do (only while CW keying is on).
    const kc = this.keyerOn() ? matchKeyerCommand(this.line) : undefined
    if (kc) {
      const { what, bad } = this.keyerCommandPreview(kc)
      this.previewEl.replaceChildren(fieldChip(kc.type === 'text' ? 'K' : this.line.trim(), what, bad))
      return
    }
    // A lone W/D: show what Enter will do instead of parsing it (W would be a name).
    const cmd = matchCommand(this.line)
    if (cmd) {
      // D is refused while a QSO is unfinished — say so here, not only after Enter.
      const blocked = cmd === 'deleteLast' && hasContent(this.state.partial)
      const what =
        cmd === 'wipe'
          ? t('logging.cmdWipe')
          : cmd === 'help'
            ? t('logging.cmdHelp')
            : blocked
              ? t('logging.cmdBlocked')
              : t('logging.cmdDeleteLast')
      this.previewEl.replaceChildren(fieldChip(this.line.trim(), what, blocked))
      return
    }
    // The dry run (renderAll): filled fields, plus (for VKV) the still-missing ones.
    const { partial: p, tokens } = dry
    const chips: HTMLElement[] = []
    if (p.call) {
      chips.push(fieldChip('CALL', p.call))
      chips.push(fieldChip('RST', p.reportRcvd ?? defaultReport(this.state.sticky.mode)))
      if (p.reportSent) chips.push(fieldChip('TX-RST', p.reportSent))
      if (profile.serialAfterCall) chips.push(fieldChip('NR', p.serial !== undefined ? padSerial(p.serial) : '—', p.serial === undefined))
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
    const loc = this.macrosShown() ? this.locSuggestion() : undefined
    if (loc) chips.push(this.suggestButton(`+ ${loc}`, () => this.fillGrid(loc), 'suggest suggest--ghost suggest--inline'))
    this.previewEl.replaceChildren(...chips)
  }

  /** The callsign database's locator for the call just entered, while none is typed. */
  private locSuggestion(): string | undefined {
    const call = this.state.partial.call
    return call && this.state.partial.grid === undefined ? this.db.lookup(call)?.loc : undefined
  }

  /** The keyer's macro buttons own the strip (CW keying on, keyer connected). */
  private macrosShown(): boolean {
    return this.keyerOn() && this.keyer.connected
  }

  /** What Enter will do with a keyer command, and whether it can't. */
  private keyerCommandPreview(kc: KeyerCommand): { what: string; bad: boolean } {
    const off = !this.keyer.connected
    switch (kc.type) {
      case 'run':
        return { what: t('logging.cmdRun'), bad: false }
      case 'sp':
        return { what: t('logging.cmdSp'), bad: false }
      case 'connect':
        return this.keyer.link === 'off'
          ? { what: t('logging.cmdConnect'), bad: false }
          : { what: t('logging.cmdConnected'), bad: true }
      case 'esm':
        return { what: t(this.keyer.esm ? 'logging.cmdEsmOff' : 'logging.cmdEsmOn'), bad: false }
      case 'keyboard':
        return off ? { what: t('logging.cmdSpeedOff'), bad: true } : { what: t('logging.cmdKeyboard'), bad: false }
      case 'text':
        return off ? { what: t('logging.cmdSpeedOff'), bad: true } : { what: t('logging.cmdText', { text: kc.text }), bad: false }
      case 'speed':
        if (!kc.inRange) return { what: t('logging.cmdSpeedRange'), bad: true }
        return off ? { what: t('logging.cmdSpeedOff'), bad: true } : { what: t('logging.cmdSpeed', { wpm: kc.wpm }), bad: false }
    }
  }

  private renderStrip(): void {
    const stop = this.stopButtons()
    // Keyboard mode: only STOP and the way out.
    if (this.txMode) {
      const end = this.suggestButton(t('logging.txEnd'), () => {
        this.flushTx()
        this.exitTx()
        this.renderAll()
      })
      this.stripEl.replaceChildren(...stop, end, ...(this.notice ? [document.createTextNode(this.notice)] : []))
      return
    }
    if (this.notice) {
      this.stripEl.replaceChildren(...stop, document.createTextNode(this.notice))
      return
    }
    const frag = this.line.trim()
    // ≥2 chars → callsign suggestions from history.
    if (frag.length >= 2) {
      const hits = this.db.search(frag, 3)
      if (hits.length > 0) {
        this.stripEl.replaceChildren(
          ...stop,
          ...hits.map(({ call }) => {
            // Already worked on this band+mode → mark it (inverse), so a dupe stands out.
            const worked = isDupe(this.qsos, call, this.state.sticky.band, this.dupeMode())
            return this.suggestButton(call, () => this.fillCall(call), worked ? 'suggest suggest--worked' : 'suggest')
          }),
        )
        return
      }
    }
    // Completed call with a known locator → prefill chip. With the keyer's macros in the
    // strip it moves to the preview line instead (renderPreview), the macros stay.
    const loc = this.locSuggestion()
    if (loc && !this.macrosShown()) {
      this.stripEl.replaceChildren(...stop, this.suggestButton(`+ ${loc}`, () => this.fillGrid(loc), 'suggest suggest--ghost'))
      return
    }
    // CW keyer connected: the macro buttons take the strip (nothing to suggest now).
    if (this.macrosShown()) {
      this.stripEl.replaceChildren(
        ...stop,
        ...MACRO_BUTTONS.map(([slot, label]) =>
          this.suggestButton(label ?? infoLabel(this.meta.profile), () => void this.sendMacro(slot), 'suggest suggest--macro'),
        ),
      )
      return
    }
    // CW keyer dropped: offer the reconnect where the macros were.
    if (this.keyerOn() && this.keyer.link === 'off') {
      this.stripEl.replaceChildren(this.suggestButton(t('logging.keyerReconnect'), () => void this.keyer.reconnect()))
      return
    }
    // Default: last written QSO. The wide layout already lists it in the
    // recent-QSO column, so the strip stays empty there.
    const last = this.qsos.length > 0 ? this.qsos[this.qsos.length - 1] : undefined
    if (WIDE.matches) this.stripEl.replaceChildren()
    else this.stripEl.replaceChildren(document.createTextNode(last ? formatQso(last) : '—'))
  }

  /** Wide layout: the latest QSOs, newest at the bottom next to the input; tap to edit.
   *  Only re-rendered when the log or the column width changes, not per keystroke
   *  (e-ink repaints). On the web the columns are aligned when every row fits. */
  private renderRecent(): void {
    this.recentWidth = this.recentEl.clientWidth
    const from = Math.max(0, this.qsos.length - RECENT_MAX)
    const shown = this.qsos.slice(from)
    const fill = (texts: readonly string[], cls: string): void => {
      this.recentEl.replaceChildren(
        ...texts.map((text, i) => {
          const li = el('li')
          li.append(button(text, () => this.nav.editQso(from + i), cls))
          return li
        }),
      )
    }
    if (!this.platform.nativeVersion && shown.length > 0) {
      fill(alignColumns(shown.map(recentCells)), 'recent-row recent-row--aligned')
      if (allFit(this.recentEl.querySelectorAll<HTMLElement>('.recent-row'))) return
    }
    fill(shown.map(formatQso), 'recent-row')
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
// as an empty placeholder so the operator sees what is not yet filled.
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

/** formatQso() split into columns for the aligned recent-QSO rows. */
function recentCells(q: Qso): string[] {
  return [
    hhmm(q.timeOn),
    q.call,
    `${q.report.sent}/${q.report.rcvd}`,
    q.sentSerial || q.serial ? `#${q.sentSerial ?? '—'}/${q.serial ?? '—'}` : '',
    q.grid ?? '',
    q.theirRef?.value ?? '',
  ]
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
