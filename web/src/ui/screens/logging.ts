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
  applyMode,
  buildQso,
  matchTuneCommand,
  hasContent,
  esmMessage,
  expandMacro,
  infoLabel,
  cqLabel,
  missingParts,
  padSerial,
  greeting,
  LiveDb,
  combineSources,
  dbDate,
  qrvLabels,
  emptySuggestions,
  userHeader,
  isDupe,
  qsoPoints,
  bearingDeg,
  defaultReport,
  applySatellite,
  applyRadio,
  satelliteByLabel,
  SATELLITES,
  PROFILES,
  isSixHours,
  sixHourStatus,
  scoringFor,
  ringPoints,
  roomForBand,
  chatTarget,
  chatText,
  expandSked,
  kstStations,
  locatorToSet,
  matchSkedQrg,
  isActive,
  viewStations,
  SKED_DEFAULT,
} from '../../core/index'
import type { CoreState, SuggestionSource, LogMeta, PartialQso, Qso, StickyState, KeyerCommand, MacroSlot, SixHourPhase } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button, strokeIcon } from '../dom'
import { BUNDLED_DB_SETTING, bundledSource } from '../bundled-db'
import { t } from '../i18n'
import { alignColumns, allFit } from '../columns'
import { KEYBOARD_SETTING, createKeyboard, parseKeyboardMode } from '../keyboard'
import type { KeyboardMode } from '../keyboard'
import type { KeyAction } from '../keys'
import type { KeyerController } from '../keyer'
import { VOICE_MEMORIES } from '../rig'
import { matchShortcut, nextMode } from '../shortcuts'
import type { Shortcut } from '../shortcuts'
import { ContestBoard } from '../contest-board'
import type { RigController } from '../rig'
import { KST_SETTINGS, notSentWhy } from '../kst'
import type { KstController } from '../kst'
import type { ChatContext } from './chat'

export interface LoggingNav {
  toLogList(): void
  toQsoList(): void
  editQso(index: number): void
  toHelp(): void
  toChat(ctx: ChatContext): void
}

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))
const pad3 = (n: number): string => String(n).padStart(3, '0')
const RECENT_MAX = 30 // wide layout: rows rendered; CSS clips whatever doesn't fit
// Same breakpoint as the landscape layout in styles.css.
const WIDE = window.matchMedia('(min-aspect-ratio: 1/1)')
// The contest board needs the log column + its own 22rem beside it.
const BOARD_MIN_WIDTH = 720
// Last read keyboard setting: the next mount lays out right away, init() re-reads it.
let keyboardMode: KeyboardMode = 'kqso'
// System keyboard: the hidden <input> holds SENTINEL + the line, so Backspace on an
// empty line still deletes something (Android sends no key for it, only an input event).
const SENTINEL = '\u00a0'
const TX_SHOWN = 40 // keyboard mode: how much of the sent text the preview keeps
const hhmm = (d: Date): string => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
// Keyer macro buttons in the strip: slot + its short label (EXCH → EX, MYCALL → MY: with
// STOP it is seven buttons on a 360 px phone). CQ is labelled by the mode (CQ / DE), INFO
// by the profile (REF / LOC / INFO).
const MACRO_BUTTONS: ReadonlyArray<readonly [MacroSlot, string | undefined]> = [
  ['CQ', undefined],
  ['EXCH', 'EX'],
  ['TU', 'TU'],
  ['MYCALL', 'MY'],
  ['INFO', undefined],
  ['?', '?'],
]
// Hardware keyboard F5 F6 F7 F8 F11 F12 (shortcuts.ts F_KEYS) → these macros, as in Tučňák.
const F_SLOTS: readonly MacroSlot[] = ['CQ', 'EXCH', 'TU', '?', 'MYCALL', 'INFO']
// ON4KST chat: a line bubble for the header button; rows of the station list under the board.
const CHAT_ICON = 'M4 5h16v11H10l-4 4v-4H4z'
const CHAT_ROWS = 30 // rendered; CSS clips whatever doesn't fit under the board

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
  // ON4KST: the last message to me, under the header until the next one (tap = answer).
  private readonly chatEl = el('button', 'chatline')
  private readonly topEl = el('div', 'logtop')
  // Right column in the wide contest layout: the board, under it the chat's active stations.
  private readonly sideEl = el('div', 'side')
  private readonly stationsEl = el('div', 'kst-side')
  private stationsKey = '' // what the station list shows (re-render on change only: e-ink)
  private skedTemplate = SKED_DEFAULT
  private readonly inputEl = el('div', 'inputline')
  private readonly previewEl = el('div', 'preview')
  private readonly stripEl = el('div', 'strip')
  private readonly recentEl = el('ol', 'recent') // wide layout only (hidden in portrait by CSS)
  private recentResize: ResizeObserver | undefined
  private recentWidth = 0
  private recentBand = '' // VHF contest: the band the recent list shows (re-render on a change)
  private readonly banner = el('div', 'banner')
  // VHF contest, wide layout without our keyboard: big QSO count + stats on the right.
  private readonly board = new ContestBoard()
  // VHF contest: the locator filled in from this log, for which call, and the partial QSO it went
  // into — valid only while that very partial is current (any other change to it ends it).
  private autoGrid: { call: string; grid: string; partial: PartialQso } | undefined
  private boardTimer: ReturnType<typeof setTimeout> | undefined // the first tick, then the interval (clearInterval clears either)
  private readonly screenEl = el('div', 'screen screen--log')
  private readonly kbEl = createKeyboard((a) => this.onKey(a))
  private readonly sysInput = this.createSysInput()
  private sysMirror = SENTINEL // what the hidden input held after the last sync
  private composing = false // IME composition running: don't touch the input's value
  private readonly onKeydown = (e: KeyboardEvent): void => this.onHardwareKey(e)
  // Rotation, a system keyboard, a resized window: the board may come or go (no-op otherwise).
  private readonly onResize = (): void => this.applyBoard()
  private readonly onWideChange = (): void => {
    this.renderStrip()
    this.applyBoard()
  }
  private unsubscribeKeyer: (() => void) | undefined
  private unsubscribeKst: (() => void) | undefined
  private unsubscribeRig: (() => void) | undefined
  private rigShown = '' // what the header last showed from the radio (re-render on change only: e-ink)
  private rigUp = false // the radio was driving this log at the last sync
  private loaded = false // init() has read the log
  // 6-hour entry: the header badge (time left), refreshed once a minute — e-ink friendly.
  private sixHEl: HTMLElement | undefined
  private sixHPhase: SixHourPhase | undefined // last seen phase: a banner on part 2 / over
  private sixHTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly keyer: KeyerController,
    private readonly rig: RigController,
    private readonly kst: KstController,
    private readonly logId: string,
    private readonly nav: LoggingNav,
    private readonly initialLine = '', // typed in on open (the chat's "Log": call + locator)
  ) {}

  mount(root: HTMLElement): void {
    this.banner.hidden = true
    this.meta = DEFAULT_META
    this.state = initialState(DEFAULT_META)
    // Portrait band order: header · input · preview · strip · keyboard.
    this.chatEl.type = 'button'
    this.chatEl.hidden = true
    this.chatEl.addEventListener('click', () => this.answerChat())
    this.topEl.replaceChildren(this.hdr, this.chatEl)
    this.sideEl.replaceChildren(this.board.el, this.stationsEl)
    this.sideEl.hidden = true
    this.screenEl.replaceChildren(this.topEl, this.banner, this.inputEl, this.previewEl, this.stripEl, this.recentEl, this.sideEl, this.kbEl, this.sysInput)
    this.applyKeyboard()
    root.replaceChildren(this.screenEl)
    window.addEventListener('keydown', this.onKeydown)
    window.addEventListener('resize', this.onResize)
    WIDE.addEventListener('change', this.onWideChange)
    this.unsubscribeKeyer = this.keyer.subscribe(() => this.onKeyerChange())
    this.unsubscribeRig = this.rig.subscribe(() => this.onRigChange())
    this.unsubscribeKst = this.kst.subscribe(() => this.onKstChange())
    void this.init()
  }

  unmount(): void {
    window.removeEventListener('keydown', this.onKeydown)
    window.removeEventListener('resize', this.onResize)
    WIDE.removeEventListener('change', this.onWideChange)
    this.unsubscribeKeyer?.()
    this.unsubscribeRig?.()
    this.unsubscribeKst?.()
    this.exitTx()
    this.recentResize?.disconnect()
    clearInterval(this.sixHTimer)
    clearInterval(this.boardTimer)
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
    keyboardMode = parseKeyboardMode(await this.platform.getSetting(KEYBOARD_SETTING))
    this.applyKeyboard()
    this.db = combineSources(setId && useBundled ? bundledSource(setId) : null, this.live)
    this.state = initialState(this.meta, qsos[qsos.length - 1])
    // Satellite log: the bird is fixed at log creation (one log per pass). Apply it
    // so band/mode/SAT_NAME are set; the header just shows it (read-only).
    if (PROFILES[this.meta.profile].fixedBand) {
      const label = this.meta.satLabel ?? (await this.platform.getSetting('satLabel')) ?? ''
      const sat = satelliteByLabel(label) ?? SATELLITES[0]!
      this.satLabel = sat.label
      // Linear birds keep the last QSO's mode (SSB / CW); SSB for a new log.
      this.state = { ...this.state, sticky: applySatellite(this.state.sticky, sat, qsos.length > 0 ? this.state.sticky.mode : 'SSB') }
    }
    this.skedTemplate = (await this.platform.getSetting(KST_SETTINGS.sked)) || SKED_DEFAULT
    if (this.initialLine) {
      this.stampFirstKeystroke()
      this.line = this.initialLine
    }
    this.loaded = true
    this.applyBoard()
    if (this.meta.category?.variant === '6h') {
      this.sixHPhase = this.sixH()?.phase // no banner for what happened before opening the log
      this.sixHTimer = setInterval(() => this.tickSixH(), 60_000)
    }
    this.syncRig()
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

  /** Show our keyboard, or hide it for the system keyboard / a hardware one. */
  private applyKeyboard(): void {
    this.kbEl.hidden = keyboardMode !== 'kqso'
    this.screenEl.classList.toggle('screen--nokb', keyboardMode !== 'kqso')
    this.screenEl.classList.toggle('screen--syskb', keyboardMode === 'system')
    this.sysInput.disabled = keyboardMode !== 'system'
    if (keyboardMode === 'system') {
      this.syncSysInput()
      this.sysInput.focus({ preventScroll: true })
    }
    this.applyBoard()
  }

  /** The contest board: VHF contest, no kQSO keyboard, the device held in landscape and
   *  wide enough. Landscape by the screen, not the viewport: a system keyboard sliding up
   *  makes a portrait phone's viewport wider than tall (the Kompakt showed the board). */
  private applyBoard(): void {
    // The wide layout (CSS) holds the board; screen.orientation (Android, iOS 16.4+) tells
    // a turned device from a keyboard-shortened viewport. Without it: the wide layout alone.
    const turned = screen.orientation ? screen.orientation.type.startsWith('landscape') : true
    const landscape = WIDE.matches && turned && window.innerWidth >= BOARD_MIN_WIDTH
    const shown = this.loaded && landscape && keyboardMode !== 'kqso' && PROFILES[this.meta.profile].contest
    this.screenEl.classList.toggle('screen--board', shown)
    if (shown === !this.board.el.hidden) return
    this.board.el.hidden = !shown
    this.sideEl.hidden = !shown
    clearInterval(this.boardTimer)
    this.boardTimer = undefined
    if (!shown) return
    this.updateBoard()
    // First tick on the next whole period (e-ink: the minute), so the clock doesn't lag up to a minute.
    const ms = this.board.tickMs
    const tick = (): void => {
      this.board.tick(new Date())
      this.renderStations() // "active" ages out with time
    }
    this.boardTimer = setTimeout(() => {
      tick()
      this.boardTimer = setInterval(tick, ms)
    }, ms - (Date.now() % ms))
  }

  private updateBoard(): void {
    if (!this.board.el.hidden) this.board.update(this.qsos, this.state.sticky.band, this.meta.myGrid, scoringFor(this.meta.category), pad3(this.qsos.length + 1))
    this.renderStations()
  }

  /** The hidden <input> that brings up the system keyboard; a tap on the input line focuses it. */
  private createSysInput(): HTMLInputElement {
    const i = el('input', 'sysinput')
    i.type = 'text'
    i.inputMode = 'text'
    i.enterKeyHint = 'send'
    i.autocomplete = 'off'
    i.spellcheck = false
    i.setAttribute('autocapitalize', 'characters')
    i.setAttribute('autocorrect', 'off')
    i.setAttribute('aria-label', t('settings.keyboardSystem'))
    i.addEventListener('input', (e) => this.onSysInput(e as InputEvent))
    i.addEventListener('compositionstart', () => (this.composing = true))
    i.addEventListener('compositionend', () => {
      this.composing = false
      this.syncSysInput()
    })
    this.inputEl.addEventListener('click', () => {
      if (keyboardMode === 'system') i.focus({ preventScroll: true })
    })
    return i
  }

  /** Turn what the system keyboard changed (a diff against the last sync) into key actions. */
  private onSysInput(e: InputEvent): void {
    const now = this.sysInput.value
    const was = this.sysMirror
    let p = 0
    while (p < now.length && p < was.length && now[p] === was[p]) p++
    const actions: KeyAction[] = []
    for (let n = was.length - p; n > 0; n--) actions.push({ type: 'backspace' })
    // A chat line (@CALL text) takes any text as typed; '@' starts one on an empty line.
    let chat = this.line.slice(0, Math.max(0, this.line.length - (was.length - p))).startsWith('@')
    let empty = this.line.length - (was.length - p) <= 0
    for (const ch of now.slice(p)) {
      if (ch === SENTINEL) continue
      if (ch === '@' && empty && this.chatOn()) chat = true
      empty = false
      if (chat && ch !== ' ' && ch !== '\n' && ch >= ' ') actions.push({ type: 'char', value: ch })
      else if (ch === ' ') actions.push({ type: 'space' })
      else if (ch === '\n') actions.push({ type: 'enter' })
      else if (/^[A-Za-z0-9/]$/.test(ch)) actions.push({ type: 'char', value: ch.toUpperCase() })
      else if (this.txMode && /^[?.,=+-]$/.test(ch)) actions.push({ type: 'char', value: ch })
    }
    this.sysMirror = now
    for (const a of actions) this.onKey(a)
    if (!e.isComposing && !this.composing) this.syncSysInput()
  }

  /** Put the current line back into the hidden input (after our keys / Enter / a suggestion tap). */
  private syncSysInput(): void {
    if (keyboardMode !== 'system') return
    const want = SENTINEL + (this.txMode ? this.txWord : this.line)
    if (this.sysInput.value !== want) this.sysInput.value = want
    this.sysMirror = want
    this.sysInput.setSelectionRange(want.length, want.length)
  }

  private onHardwareKey(e: KeyboardEvent): void {
    const k = e.key
    // Shortcuts first (also in the system keyboard's input); one that doesn't apply now
    // lets the key through (F5 without the keyer still reloads).
    // A chat line takes what macOS Option types ('@' is Option+L on a German Mac) — that is
    // another character than the key's letter; Alt+letter elsewhere stays a shortcut.
    const optionChar =
      e.altKey && !e.ctrlKey && !e.metaKey && k.length === 1 && e.code.startsWith('Key') && k.toLowerCase() !== e.code.slice(3).toLowerCase()
    const chatTyping = optionChar && (this.isChatLine() || (k === '@' && this.line === '' && this.chatOn()))
    const sc = chatTyping ? undefined : matchShortcut(e)
    if (sc && this.runShortcut(sc)) {
      e.preventDefault()
      return
    }
    // In the system keyboard's input only Enter / Esc go this way; characters and
    // Backspace come as input events (Android's soft keys have no key value).
    if (e.target === this.sysInput && k !== 'Enter' && k !== 'Escape') return
    if (k === 'Escape' && this.rig.voicePlaying) {
      e.preventDefault()
      void this.rig.stopVoice()
      return
    }
    // Esc = STOP first; with nothing on the air it leaves keyboard mode. A typed line
    // with nothing on the air goes instead (below).
    if (k === 'Escape' && this.keyerOn() && (this.txMode || this.keyer.sending || this.line.trim() === '')) {
      e.preventDefault()
      if (this.txMode && !this.keyer.sending) this.exitTx()
      else void this.keyer.stop()
      this.renderAll()
      return
    }
    if (k === 'Escape' && !this.txMode && this.line !== '') {
      e.preventDefault()
      this.clearLine()
      return
    }
    // A chat line (@CALL text) takes any character as typed; '@' starts one on an empty line.
    // AltGr (Ctrl+Alt on Windows: '@' on a Czech keyboard) and macOS Option still type.
    const chatChar = k.length === 1 && (this.isChatLine() || (k === '@' && this.line === '' && this.chatOn()))
    if (chatChar && ((!e.ctrlKey && !e.metaKey) || e.getModifierState('AltGraph'))) return this.handled(e, { type: 'char', value: k })
    // Alt / Ctrl / Cmd + a key that is no shortcut here: not typing, leave it to the browser.
    if (e.altKey || e.ctrlKey || e.metaKey) return
    // Keyboard mode also takes the keyer's punctuation from a hardware keyboard.
    if (this.txMode && /^[?.,=+-]$/.test(k)) return this.handled(e, { type: 'char', value: k })
    if (k === 'Enter') return this.handled(e, { type: 'enter' })
    if (k === 'Backspace') return this.handled(e, { type: 'backspace' })
    if (k === ' ') return this.handled(e, { type: 'space' })
    if (/^[A-Za-z0-9/]$/.test(k)) return this.handled(e, { type: 'char', value: k.toUpperCase() })
  }

  /** Esc on a typed line: drop just that text (a call only looked up in the log). What
   *  Enter already took in stays — discarding the QSO is Alt+W / W. The time its first
   *  key stamped goes too when nothing else is under way, as with W. */
  private clearLine(): void {
    this.line = ''
    this.notice = ''
    if (!hasContent(this.state.partial)) this.state = { ...this.state, partial: {}, hasStarted: false }
    this.renderAll()
  }

  /** Run a hardware-keyboard shortcut; false when it doesn't apply now (the key goes on). */
  private runShortcut(sc: Shortcut): boolean {
    // CW keyboard mode: only the macros, the speed and Alt+K (leave it).
    if (this.txMode && sc.type !== 'memory' && sc.type !== 'speed' && !(sc.type === 'keyer' && sc.letter === 'K')) return false
    switch (sc.type) {
      case 'memory': {
        const slot = F_SLOTS[sc.index]
        if (slot && this.macrosShown()) {
          void this.sendMacro(slot)
          return true
        }
        const voice = VOICE_MEMORIES[sc.index]
        if (voice !== undefined && this.voiceShown()) {
          void this.rig.playVoice(voice)
          return true
        }
        return false
      }
      case 'speed': {
        const wpm = this.keyer.wpm
        if (!this.keyerOn() || !this.keyer.connected || wpm === undefined) return false
        void this.keyer.setSpeed(wpm + sc.delta)
        return true
      }
      case 'line':
        void this.lineShortcut(sc.letter)
        return true
      case 'keyer':
        if (!this.keyerOn()) return false
        if (this.txMode) {
          this.exitTx()
          this.renderAll()
        } else void this.runKeyerCommand(matchKeyerCommand(sc.letter)!, true).then(() => this.renderAll())
        return true
      case 'loc': {
        const grid = this.locSuggestion()
        if (!grid) return false
        this.fillGrid(grid)
        return true
      }
      case 'mode':
        this.cycleMode()
        return true
      case 'list':
        this.nav.toQsoList()
        return true
      case 'back':
        this.close()
        return true
      case 'save':
        void this.saveNow()
        return true
      case 'esm':
        if (!this.keyerOn()) return false
        void this.runKeyerCommand({ type: 'esm' }, true).then(() => this.renderAll())
        return true
      case 'chat':
        if (!this.chatOn()) return false
        this.openChat()
        return true
      case 'skedQrg':
        if (!this.chatOn()) return false
        // An empty line: G with the current QRG, ready to change; else just say what it is.
        if (this.line.trim() === '') this.line = `G ${this.kst.skedQrg(this.state.sticky.band)}`.trimEnd() + ' '
        else this.notice = this.skedQrgNow()
        this.renderAll()
        return true
    }
  }

  /** Alt+W / D / H / E = the line command, as if typed alone + Enter. Alt+D keeps the typed
   *  line and its QSO time (deletes the last QSO without losing what's being typed); Alt+W
   *  discards it; H / E leave the screen, where only an entered call comes back (journal). */
  private async lineShortcut(letter: 'W' | 'D' | 'H' | 'E'): Promise<void> {
    // E with nothing saved yet stays here (a notice), so it keeps the line too.
    const keep = letter === 'D' || (letter === 'E' && this.qsos.length === 0) ? this.line : ''
    const timeOn = this.state.partial.timeOn
    this.line = letter
    await this.commit()
    if (keep.trim() !== '' && timeOn && !this.state.partial.timeOn) {
      this.state = { ...this.state, partial: { ...this.state.partial, timeOn }, hasStarted: true }
    }
    this.line = keep
    this.renderAll()
  }

  /** Ctrl+Enter: take the typed line in and save the QSO when it has all it needs. The
   *  line's own Enter sends no ESM macro — the save's does (RUN: TU, S&P: EXCH). */
  private async saveNow(): Promise<void> {
    // A command on the line (W, E, R, F28300 …) just runs, as with Enter — no save after it
    // (E / H have left the screen by then).
    const l = this.line
    if (matchCommand(l) || (this.rig.enabled && matchTuneCommand(l) !== undefined) || (this.keyerOn() && matchKeyerCommand(l))) {
      await this.commit()
      return
    }
    if (this.line.trim() !== '') await this.commit(false)
    if (this.line.trim() === '' && this.state.hasStarted && buildQso(this.lineState().partial, this.state.sticky, this.meta)) await this.commit()
  }

  /** Alt+M: CW → SSB → FM, as if typed; a radio connected tunes to it. */
  private cycleMode(): void {
    const mode = nextMode(this.state.sticky.mode)
    this.state = { ...this.state, sticky: applyMode(this.state.sticky, mode) }
    if (this.rigSets()) void this.rig.tune(undefined, mode)
    this.renderAll()
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
        // A chat line is no QSO: no QSO time.
        if (!this.isChatLine() && !(a.value === '@' && this.line === '')) this.stampFirstKeystroke()
        this.line += a.value
        break
      case 'space':
        if (!this.isChatLine()) this.stampFirstKeystroke()
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

  /** Enter. `esm` false: no ESM macro for it (Ctrl+Enter's first step). */
  private async commit(esm = true): Promise<void> {
    // @CALL text: goes to the ON4KST chat, nothing into the QSO.
    if (this.isChatLine()) {
      this.sendChat()
      return
    }
    // O ⏎: the chat (only where there is one — else O stays input).
    if (this.chatOn() && this.line.trim().toUpperCase() === 'O') {
      this.line = ''
      if (!hasContent(this.state.partial)) this.state = { ...this.state, partial: {}, hasStarted: false }
      this.openChat()
      return
    }
    // G 144.300 ⏎: the band's sked QRG for {QRG}; G ⏎ shows it, G - ⏎ clears it.
    const qrg = this.chatOn() ? matchSkedQrg(this.line) : undefined
    if (qrg !== undefined) {
      if (qrg) this.kst.setSkedQrg(this.state.sticky.band, qrg === '-' ? '' : qrg)
      this.line = ''
      if (!hasContent(this.state.partial)) this.state = { ...this.state, partial: {}, hasStarted: false }
      this.notice = this.skedQrgNow()
      this.renderAll()
      return
    }
    // F28300: tune the radio (only with the radio switched on — else F… is just input).
    const hz = this.rig.enabled ? matchTuneCommand(this.line) : undefined
    if (hz !== undefined) {
      this.line = ''
      await this.rig.tuneTo(hz)
      this.renderAll()
      return
    }
    // Keyer commands (R / S / S20) only while CW keying is on — otherwise R / S stay a name.
    const kc = this.keyerOn() ? matchKeyerCommand(this.line) : undefined
    if (kc) {
      await this.runKeyerCommand(kc)
      this.renderAll()
      return
    }
    const hadContent = hasContent(this.state.partial)
    const before = { lineEmpty: this.line.trim() === '', hadContent, hadCall: this.state.partial.call !== undefined }
    const prev = this.state.sticky
    const typedGrid = classifyLine(tokenize(this.line), PROFILES[this.meta.profile], this.state.partial.call !== undefined).some(
      (t) => t.cls.type === 'locator',
    )
    const r = reduce(this.lineState(), { type: 'enter', line: this.line }, this.meta)
    this.state = r.state
    if (r.clearInput) this.line = ''
    // VHF contest, worked already on another band (going up the bands with a station): its locator
    // goes straight in. Elsewhere a log spans days and stations move — only the suggestion chip.
    const p = this.state.partial
    const a = this.autoGrid
    // Still the filled-in locator of the same call (e.g. the serial came on this line)? Keep tracking it.
    this.autoGrid =
      a && !r.committed && !typedGrid && p.call?.toUpperCase() === a.call && p.grid === a.grid ? { ...a, partial: p } : undefined
    if (!r.committed && p.call !== undefined && p.grid === undefined && PROFILES[this.meta.profile].contest) {
      const grid = this.loggedLoc(p.call)
      if (grid) {
        const partial = { ...p, grid }
        this.state = { ...this.state, partial }
        this.autoGrid = { call: p.call.toUpperCase(), grid, partial }
      }
    }
    // Radio connected: a typed band / mode tunes it; its transceive then confirms.
    const next = this.state.sticky
    if (this.rigSets() && (next.band !== prev.band || next.mode !== prev.mode)) {
      void this.rig.tune(next.band !== prev.band ? next.band : undefined, next.mode !== prev.mode ? next.mode : undefined)
    }

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
      // The band joins the call's QRV bands — not via a satellite (that's the uplink, not where it's QRV).
      const band = PROFILES[this.meta.profile].fixedBand ? undefined : committed.signal.band
      this.live.record(committed.call, committed.grid, dbDate(committed.timeOn), band)
      await this.platform.writeCallDb(this.live.toText(userHeader(new Date())))
      this.banner.hidden = true
      this.tickSixH()
    } else if (this.state.hasStarted && this.state.partial.call) {
      await this.platform.writeJournal(this.logId, serialize(this.state.partial))
    }
    this.renderAll()
    // ESM: Enter sends the macro for what it just did (after the save, so the macro
    // carries the saved QSO's call, report and number).
    if (esm && this.esmOn()) {
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

  private async runCommand(cmd: 'wipe' | 'deleteLast' | 'deleteLastBlocked' | 'help' | 'editLast', hadContent: boolean): Promise<void> {
    if (cmd === 'help') {
      this.nav.toHelp()
      return
    }
    if (cmd === 'editLast') {
      if (this.qsos.length === 0) this.notice = t('logging.nothingToEdit')
      else this.nav.editQso(this.qsos.length - 1)
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

  /** `keepLine`: from a shortcut (Alt+R …) — the typed line and the QSO under way stay. */
  private async runKeyerCommand(kc: KeyerCommand, keepLine = false): Promise<void> {
    if (!keepLine) {
      this.line = ''
      // The command letter stamped the QSO time; drop it unless a QSO is under way.
      if (!hasContent(this.state.partial)) this.state = { ...this.state, partial: {}, hasStarted: false }
    }
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
    const dry = parseLine(this.line, this.state.sticky, this.lineState().partial, PROFILES[this.meta.profile]).partial
    const last = this.qsos.length > 0 ? this.qsos[this.qsos.length - 1] : undefined
    const from = saved ?? (dry.call === undefined ? last : undefined)
    const common = { myCall: this.meta.myCall, myLoc: this.meta.myGrid, myRef: this.meta.myRefs?.map((r) => r.value).join(' '), hi: greeting(new Date()) }
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

  // --- radio (IC-705, or an Icom via the keyer) -------------------------

  /** The radio sets band / mode / FREQ: connected, and not a satellite log (the bird does). */
  private rigSets(): boolean {
    return this.rig.controls && !PROFILES[this.meta.profile].fixedBand
  }

  /** Radio's frequency / mode → sticky state. Without the radio, a FREQ it gave is dropped
   *  (band and mode stay as they were last). */
  private syncRig(): void {
    // The radio just started driving this log: keep the log's band if the radio can't be
    // there (VHF contest reopened on 23 cm) instead of dragging it to the radio's band.
    const up = this.loaded && this.rigSets()
    if (up && !this.rigUp) this.rig.adopt(this.state.sticky.band)
    this.rigUp = up
    const s = this.state.sticky
    // Detached (the log on a band the radio doesn't work): only an F… frequency applies.
    if (this.rigSets() && this.rig.detached) {
      const hz = this.rig.awayHz
      if (hz !== undefined) this.state = { ...this.state, sticky: applyRadio(s, hz, undefined) }
    } else if (this.rigSets()) this.state = { ...this.state, sticky: applyRadio(s, this.rig.logFreqHz, this.rig.mode) }
    else if (s.freq !== undefined && !PROFILES[this.meta.profile].fixedBand) this.state = { ...this.state, sticky: applyRadio(s, undefined, undefined) }
  }

  private onRigChange(): void {
    const n = this.rig.notice
    let changed = false
    if (n) {
      this.notice =
        n.type === 'tuneFailed'
          ? t('logging.rigTuneFailed')
          : n.type === 'voiceFailed'
            ? t('logging.rigVoiceFailed', { n: n.memory })
            : n.type === 'firmware'
              ? t('settings.rigFirmware')
              : t('settings.rigFailed', { msg: n.message })
      this.rig.clearNotice()
      changed = true
    }
    this.syncRig()
    // Every VFO step lands here; redraw only when something shown changes.
    const s = this.state.sticky
    const shown = `${this.rig.link}|${this.rig.ready}|${this.rig.detached}|${this.rig.xvertBand}|${this.rig.mode}|${this.rig.voicePlaying}|${s.band}|${s.mode}|${this.keyer.connected}`
    if (shown !== this.rigShown) changed = true
    this.rigShown = shown
    if (changed) this.renderAll()
  }

  private onKeyerChange(): void {
    const n = this.keyer.notice
    if (this.txMode && !this.keyer.connected) this.exitTx()
    if (n?.type === 'error') {
      const key = n.what === 'mode' ? 'logging.rigNotCw' : undefined
      this.notice = key ? t(key) : t('logging.keyerError', { what: n.what })
      this.keyer.clearNotice()
    } else if (n?.type === 'connectFailed') {
      this.notice = t('settings.keyerFailed', { msg: n.message })
      this.keyer.clearNotice()
    }
    this.renderAll()
  }

  /** STOP while the keyer is sending — always first in the strip, even before suggestions. */
  private stopButtons(): HTMLElement[] {
    if (this.rig.voicePlaying) return [this.suggestButton('STOP', () => void this.rig.stopVoice(), 'suggest suggest--stop')]
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

  /** 6-hour entry on the current band: the phase and time left; undefined otherwise. */
  private sixH(): ReturnType<typeof sixHourStatus> | undefined {
    const band = this.state.sticky.band
    if (!PROFILES[this.meta.profile].contest || !isSixHours(this.meta.category, band)) return undefined
    return sixHourStatus(
      this.qsos.filter((q) => q.signal.band === band).map((q) => q.timeOn),
      new Date(),
    )
  }

  /** Update the 6H badge in place (no full re-render: e-ink) and tell once when part 2
   *  starts after the break and when the 6 hours are used up. */
  private tickSixH(): void {
    const st = this.sixH()
    if (this.sixHEl && st) {
      const [text, cls] = sixHBadge(st)
      if (this.sixHEl.textContent !== text) this.sixHEl.textContent = text
      this.sixHEl.className = cls
    }
    const phase = st?.phase
    if (phase === this.sixHPhase) return
    const was = this.sixHPhase
    this.sixHPhase = phase
    if (phase === 'part2' && was === 'break') this.sixHNotice(t('logging.sixHPart2', { left: hm(st!.leftMs) }))
    else if (phase === 'over' && was !== undefined) this.sixHNotice(t('logging.sixHOver'))
  }

  private sixHNotice(text: string): void {
    this.banner.replaceChildren(el('span', undefined, `${text} `), button('OK', () => (this.banner.hidden = true)))
    this.banner.hidden = false
  }

  // --- rendering -------------------------------------------------------------

  private renderAll(): void {
    // Dry-run the current line onto the accumulated QSO once; the header (azimuth)
    // and the preview both show what will actually be saved.
    const dry = parseLine(this.line, this.state.sticky, this.lineState().partial, PROFILES[this.meta.profile])
    if (PROFILES[this.meta.profile].contest && this.state.sticky.band !== this.recentBand) this.renderRecent()
    // The chat follows the log's band (another room reconnects).
    const room = this.chatOn() ? roomForBand(this.state.sticky.band) : undefined
    if (room && this.kst.wanted) this.kst.setRoom(room)
    this.renderChatLine()
    this.renderHeader(dry.partial)
    this.renderLine(dry.sticky)
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
      const link = this.keyer.outLink
      const wpm = this.keyer.wpm
      const state = link === 'off' ? ' ✕' : link === 'connecting' ? ' …' : wpm !== undefined ? ` ${wpm}` : ''
      // Keyboard mode: TX instead of RUN / S&P, inverted. ·ESM = Enter sends the macros.
      const what = this.txMode ? 'TX' : `${this.keyer.mode === 'run' ? 'RUN' : 'S&P'}${this.keyer.esm ? '·ESM' : ''}`
      const label = `${what}${state}`
      const cls = link !== 'on' ? 'hdr-keyer hdr-keyer--off' : this.txMode ? 'hdr-keyer hdr-keyer--tx' : 'hdr-keyer'
      mid.append(button(label, () => void this.keyer.reconnect(), cls))
    }
    // Radio (705, 7300 …): up (band / mode from the radio), connecting, or ✕ (tap = connect).
    if (this.rig.enabled && !profile.fixedBand) {
      // XV = the radio on a transverter's IF; – = the log on a band the radio doesn't work.
      const up = this.rig.controls
      const state = !up ? (this.rig.link === 'off' ? ' ✕' : ' …') : this.rig.detached ? ' –' : this.rig.xvertBand ? ' XV' : ''
      mid.append(button(`${this.rig.label}${state}`, () => void this.rig.reconnect(), up && !this.rig.detached ? 'hdr-keyer' : 'hdr-keyer hdr-keyer--off'))
    }
    if (profile.contest) {
      const known = p.grid === undefined && p.call !== undefined ? this.knownLoc(p.call) : undefined
      const az = bearingDeg(this.meta.myGrid, p.grid ?? known ?? '')
      if (az !== undefined) mid.append(el('b', known ? 'hdr-az hdr-az--guess' : 'hdr-az', `${az}°`))
    }
    // 6-hour entry: the time left (in brackets during the break, struck out when used up).
    const six = this.sixH()
    this.sixHEl = undefined
    if (six) {
      const [text, cls] = sixHBadge(six)
      this.sixHEl = el('b', cls, text)
      mid.append(this.sixHEl)
    }
    this.hdr.replaceChildren(
      this.navLogsButton(),
      mid,
      ...(this.chatOn() ? [this.chatButton()] : []),
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

  /** `sticky`: after this line's band / mode, so `2G OK1EM` checks the dupe on 13cm. */
  private renderLine(sticky: StickyState): void {
    if (!this.composing) this.syncSysInput()
    this.inputEl.classList.toggle('inputline--tx', this.txMode)
    if (this.txMode) {
      this.inputEl.replaceChildren(el('span', 'tx-prompt', 'CW›'), document.createTextNode(` ${this.txWord}`), el('span', 'cursor'))
      this.inputEl.classList.remove('inputline--dupe')
      return
    }
    this.inputEl.replaceChildren(document.createTextNode(this.line), el('span', 'cursor'))
    this.inputEl.classList.toggle('inputline--chat', this.isChatLine())
    if (this.isChatLine()) {
      this.inputEl.classList.remove('inputline--dupe')
      return
    }
    // DUPE: invert the input line. Satellite dupe keys on call + SAT_NAME
    // (a station can be re-worked on another bird); VHF contest call + band; otherwise call + band + mode.
    const call = this.effectiveCall()
    const s = sticky
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
    const hz = this.rig.enabled ? matchTuneCommand(this.line) : undefined
    if (hz !== undefined) {
      const on = this.rig.controls
      this.previewEl.replaceChildren(
        fieldChip('F', on ? t('logging.cmdTune', { mhz: (hz / 1e6).toFixed(3) }) : t('logging.cmdRigOff'), !on),
      )
      return
    }
    // Keyer R / S / S20: what Enter will do (only while CW keying is on).
    const kc = this.keyerOn() ? matchKeyerCommand(this.line) : undefined
    if (kc) {
      const { what, bad } = this.keyerCommandPreview(kc)
      this.previewEl.replaceChildren(fieldChip(kc.type === 'text' ? 'K' : this.line.trim(), what, bad))
      return
    }
    // @CALL text: where the chat message goes, and whether it can go now.
    if (this.isChatLine()) {
      const to = chatTarget(this.line)
      const on = this.kst.link === 'on'
      const text = chatText(this.line) !== undefined
      const where = to ? `→ ${to}` : t('kst.public')
      this.previewEl.replaceChildren(
        fieldChip('KST', !on ? t('kst.notSent') : text ? where : `${where} · ${t('kst.noText')}`, !on || !text),
      )
      return
    }
    if (this.chatOn() && this.line.trim().toUpperCase() === 'O') {
      this.previewEl.replaceChildren(fieldChip('O', t('kst.cmdOpen')))
      return
    }
    const qrg = this.chatOn() ? matchSkedQrg(this.line) : undefined
    if (qrg !== undefined) {
      const band = this.state.sticky.band
      const what = !qrg ? this.skedQrgNow() : qrg === '-' ? t('kst.skedQrgClear', { band }) : t('kst.skedQrgSet', { band, qrg })
      this.previewEl.replaceChildren(fieldChip('G', what))
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
            : cmd === 'editLast'
              ? t('logging.cmdEdit')
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
      // VHF contest: the QSO's points (= km + 1, IARU R1) as soon as the locator is known;
      // Provozní aktiv / FM pohár score by large-square rings — those points next to it.
      if (profile.contest && p.grid !== undefined) chips.push(...this.pointChips(p.grid))
      if (profile.contest) chips.push(...this.qrvChip(p.call, dry.sticky.band))
      if (p.theirRef) chips.push(fieldChip('REF', p.theirRef.value))
      if (p.name) chips.push(fieldChip('NAME', p.name))
    } else if (p.grid !== undefined) {
      // VHF contest: the locator heard first; the QSO waits for the call.
      chips.push(fieldChip('CALL', '—', true), fieldChip('LOC', p.grid))
      if (profile.contest) chips.push(...this.pointChips(p.grid))
    }
    // FM pohár: only FM on 145 / 433 MHz counts — say so before the QSO is logged.
    if (profile.contest && this.meta.category?.contest === 'fm') {
      const s = this.state.sticky
      if (s.mode !== 'FM' || (s.band !== '2m' && s.band !== '70cm')) chips.push(fieldChip('FM', t('logging.fmOnly'), true))
    }
    for (const t of tokens) if (t.cls.type === 'unknown') chips.push(unknownChip(t.raw))
    // With the macros / voice memories in the strip, the database's suggestions go here.
    const inline = this.macrosShown() || this.voiceShown()
    const loc = inline ? this.locSuggestion() : undefined
    if (loc) chips.push(this.suggestButton(`+ ${loc}`, () => this.fillGrid(loc), 'suggest suggest--ghost suggest--inline'))
    if (inline) for (const b of this.callsAtLocator('suggest suggest--inline')) chips.push(b)
    this.previewEl.replaceChildren(...chips)
  }

  /** QRB in km, and the ring points where the contest scores by large squares. */
  private pointChips(grid: string): HTMLElement[] {
    const km = qsoPoints(this.meta.myGrid, grid)
    if (km === undefined) return []
    const chips = [fieldChip('QRB', `${km} km`)]
    const rings = scoringFor(this.meta.category).rings ? ringPoints(this.meta.myGrid, grid) : undefined
    if (rings !== undefined) chips.push(fieldChip(t('logging.pts'), String(rings)))
    return chips
  }

  /** VHF contest: the other bands the database knows the call on (as Tučňák shows them);
   *  `band` is the QSO's, a band typed on this line included. Bands already worked are struck out. */
  private qrvChip(call: string, band: string): HTMLElement[] {
    const bands = qrvLabels(this.db.lookup(call)?.qrv, band)
    if (bands.length === 0) return []
    const chip = el('span', 'tok')
    bands.forEach(({ band: b, label }, i) => {
      if (i > 0) chip.append(' ')
      chip.append(isDupe(this.qsos, call, b, this.dupeMode()) ? el('s', undefined, label) : label)
    })
    chip.append(el('small', undefined, 'QRV'))
    return [chip]
  }

  /** The call's locator in this log (the latest QSO with one), if worked already. */
  private loggedLoc(call: string): string | undefined {
    const c = call.toUpperCase()
    for (let i = this.qsos.length - 1; i >= 0; i--) {
      const q = this.qsos[i]
      if (q && q.grid && q.call.toUpperCase() === c) return q.grid
    }
    return undefined
  }

  /** The call's locator: from this log when worked already (another band), else the database's. */
  private knownLoc(call: string): string | undefined {
    return this.loggedLoc(call) ?? this.db.lookup(call)?.loc
  }

  /** The known locator for the call just entered, while none is typed. */
  private locSuggestion(): string | undefined {
    const call = this.state.partial.call
    return call && this.state.partial.grid === undefined ? this.knownLoc(call) : undefined
  }

  /** Locator entered before the call (VHF contest): buttons for the calls the database
   *  knows there, a tap fills the call in. Worked ones inverted, as in the strip. */
  private callsAtLocator(cls: string): HTMLElement[] {
    const { call, grid } = this.state.partial
    if (call !== undefined || grid === undefined || this.line.trim().length >= 2) return []
    return this.db.byLocator(grid, 3).map(({ call: c }) => {
      const worked = isDupe(this.qsos, c, this.state.sticky.band, this.dupeMode())
      return this.suggestButton(c, () => this.fillCall(c), worked ? `${cls} suggest--worked` : cls)
    })
  }

  /** The keyer's macro buttons own the strip (CW keying on, keyer connected). */
  private macrosShown(): boolean {
    return this.keyerOn() && this.keyer.connected
  }

  /** The radio's voice memories own the strip: a radio that has them, connected, in SSB / FM (its mode). */
  private voiceShown(): boolean {
    const m = this.rig.mode
    return this.rig.voice && (m === 'SSB' || m === 'FM')
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
        return this.keyer.outLink === 'off'
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
    // @OK1… → the chat's stations with that start; a tap addresses one.
    if (this.isChatLine()) {
      const start = chatTarget(this.line) ?? ''
      const hits = !frag.includes(' ') && start.length >= 1 ? [...this.kst.chat.users.keys()].filter((c) => c.startsWith(start) && !this.kst.isMuted(c)).slice(0, 3) : []
      this.stripEl.replaceChildren(...stop, ...hits.map((c) => this.suggestButton(c, () => this.addressChat(c))))
      return
    }
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
    // Locator before the call (VHF contest) → the calls known there.
    const atLoc = this.macrosShown() || this.voiceShown() ? [] : this.callsAtLocator('suggest')
    if (atLoc.length > 0) {
      this.stripEl.replaceChildren(...stop, ...atLoc)
      return
    }
    // Completed call with a known locator → prefill chip. With the keyer's macros in the
    // strip it moves to the preview line instead (renderPreview), the macros stay.
    const loc = this.locSuggestion()
    if (loc && !this.macrosShown() && !this.voiceShown()) {
      this.stripEl.replaceChildren(...stop, this.suggestButton(`+ ${loc}`, () => this.fillGrid(loc), 'suggest suggest--ghost'))
      return
    }
    // CW keyer connected: the macro buttons take the strip (nothing to suggest now).
    if (this.macrosShown()) {
      this.stripEl.replaceChildren(
        ...stop,
        ...MACRO_BUTTONS.map(([slot, label]) =>
          this.suggestButton(
            label ?? (slot === 'CQ' ? cqLabel(this.keyer.mode) : infoLabel(this.meta.profile)),
            () => void this.sendMacro(slot),
            'suggest suggest--macro',
          ),
        ),
      )
      return
    }
    // Radio in SSB / FM: its voice memories, as the macros in CW.
    if (this.voiceShown()) {
      this.stripEl.replaceChildren(
        ...stop,
        ...VOICE_MEMORIES.map((n) => this.suggestButton(`T${n}`, () => void this.rig.playVoice(n), 'suggest suggest--macro')),
      )
      return
    }
    // CW keyer dropped: offer the reconnect where the macros were.
    if (this.keyerOn() && this.keyer.outLink === 'off') {
      this.stripEl.replaceChildren(this.suggestButton(t('logging.keyerReconnect'), () => void this.keyer.reconnect()))
      return
    }
    // Default: last written QSO. The wide layout (and portrait without our keyboard)
    // already lists it in the recent-QSO column, so the strip stays empty there.
    const last = this.qsos.length > 0 ? this.qsos[this.qsos.length - 1] : undefined
    if (WIDE.matches || keyboardMode !== 'kqso') this.stripEl.replaceChildren()
    else this.stripEl.replaceChildren(document.createTextNode(last ? formatQso(last) : '—'))
  }

  /** Wide layout: the latest QSOs, newest at the bottom next to the input; tap to edit.
   *  Only re-rendered when the log or the column width changes, not per keystroke
   *  (e-ink repaints). On the web the columns are aligned when every row fits. */
  private renderRecent(): void {
    this.recentWidth = this.recentEl.clientWidth
    // VHF contest: only the current band's QSOs — the bands don't mix on the screen.
    const band = PROFILES[this.meta.profile].contest ? this.state.sticky.band : ''
    this.recentBand = band
    this.updateBoard()
    const indices = this.qsos.flatMap((q, i) => (band === '' || q.signal.band === band ? [i] : [])).slice(-RECENT_MAX)
    const shown = indices.map((i) => this.qsos[i]!)
    const fill = (texts: readonly string[], cls: string): void => {
      this.recentEl.replaceChildren(
        ...texts.map((text, n) => {
          const li = el('li')
          const index = indices[n]! // edit by the position in the whole log
          li.append(button(text, () => this.nav.editQso(index), cls))
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

  // --- ON4KST chat ------------------------------------------------------------

  /** The chat is offered: a VHF contest on a band with a chat room, and a way to connect. */
  private chatOn(): boolean {
    return this.kst.available && this.loaded && PROFILES[this.meta.profile].contest && roomForBand(this.state.sticky.band) !== undefined
  }

  private isChatLine(): boolean {
    return this.line.startsWith('@')
  }

  private openChat(): void {
    const s = this.state.sticky
    this.nav.toChat({ band: s.band, mode: s.mode, freqMHz: s.freq })
  }

  /** The header's bubble: the number of messages to me not read yet; dashed while not connected. */
  private chatButton(): HTMLButtonElement {
    const k = this.kst
    const b = button('', () => this.openChat(), k.link === 'on' ? 'hdr-nav hdr-chat' : 'hdr-nav hdr-chat hdr-chat--off')
    b.title = t('kst.title')
    b.append(strokeIcon(CHAT_ICON, 'icon'))
    if (k.unread > 0) b.append(el('b', undefined, String(k.unread)))
    return b
  }

  private onKstChange(): void {
    if (!this.loaded) return
    this.renderHeader(parseLine(this.line, this.state.sticky, this.lineState().partial, PROFILES[this.meta.profile]).partial)
    this.renderChatLine()
    this.renderStations()
    if (this.isChatLine()) {
      this.renderPreview(parseLine(this.line, this.state.sticky, this.lineState().partial, PROFILES[this.meta.profile]))
    }
  }

  /** The last message to me under the header, while the chat is connected. */
  private renderChatLine(): void {
    const m = this.chatOn() && this.kst.link === 'on' ? this.kst.lastForMe : undefined
    this.chatEl.hidden = m === undefined
    if (!m) return
    const d = new Date(m.ts * 1000)
    const text = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} ${m.call}: ${m.text}`
    if (this.chatEl.textContent !== text) this.chatEl.textContent = text
  }

  /** A tap on the chat line: "@CALL " to answer. */
  private answerChat(): void {
    const m = this.kst.lastForMe
    if (m) this.addressChat(m.call)
  }

  private addressChat(call: string, text = ''): void {
    this.notice = ''
    this.line = `@${call} ${text}`
    this.renderAll()
  }

  private setKstLocator(loc: string): void {
    if (!this.kst.setLocator(loc)) {
      this.notice = notSentWhy(this.kst)
      this.renderAll()
    }
  }

  private sendChat(): void {
    if (this.kst.send(this.line)) {
      this.line = ''
      this.notice = ''
    } else this.notice = notSentWhy(this.kst, this.line)
    this.renderAll()
  }

  /** Under the board: the chat's active stations, filtered and sorted as in the chat
   *  (KstController.view); a tap addresses one, S fills in the sked request. Rewritten only on change. */
  private renderStations(): void {
    if (this.sideEl.hidden || !this.chatOn() || (!this.kst.wanted && this.kst.link !== 'on')) {
      if (this.stationsKey !== '') this.stationsEl.replaceChildren()
      this.stationsKey = ''
      return
    }
    const band = this.state.sticky.band
    const now = Date.now() / 1000
    const rows = viewStations(
      kstStations(this.kst.chat, this.meta.myGrid, (c) => isDupe(this.qsos, c, band)).filter((s) => isActive(s, now) && !this.kst.isMuted(s.call)),
      this.kst.view,
    ).slice(0, CHAT_ROWS)
    const head = this.kst.link === 'on' ? t('kst.active', { n: rows.length }) : this.kst.link === 'off' || this.kst.link === 'failed' ? t('kst.off') : t('kst.connecting')
    const loc = this.kst.link === 'on' ? locatorToSet(this.kst.locator, this.meta.myGrid) : undefined
    const key = [this.kst.room, head, loc, ...rows.map((s) => `${s.call}|${s.loc}|${s.km}|${s.az}|${s.isNew}|${s.worked}|${s.away}`)].join(';')
    if (key === this.stationsKey) return
    this.stationsKey = key
    const title = el('div', 'kst-side-head', `KST · ${head}`)
    const list = el('ol', 'kst-side-list')
    if (loc) {
      // ON4KST has me elsewhere: the others' QRB is wrong — a tap sends /SETLOC.
      const li = el('li')
      const set = this.suggestButton(`${t('kst.setLoc', { loc })} (ON4KST ${this.kst.locator ?? ''})`, () => this.setKstLocator(loc), 'kst-side-row kst-side-row--new')
      set.title = t('kst.locDiffers', { kst: this.kst.locator ?? '', log: loc })
      li.append(set)
      list.append(li)
    }
    for (const s of rows) {
      const li = el('li')
      const row = this.suggestButton(`${s.call.padEnd(10)} ${s.loc.padEnd(6)} ${String(s.km ?? '').padStart(4)} ${String(s.az ?? '').padStart(3)}°`, () => this.addressChat(s.call), ['kst-side-row', s.isNew ? 'kst-side-row--new' : '', s.worked ? 'kst-side-row--worked' : '', s.away ? 'kst-side-row--away' : ''].filter(Boolean).join(' '))
      const sked = this.suggestButton('S', () => this.addressChat(s.call, this.skedText()), 'kst-side-sked')
      sked.title = t('kst.sked')
      li.append(row, sked)
      list.append(li)
    }
    if (rows.length === 0 && this.kst.link === 'on') list.append(el('li', 'about', t('kst.noActive')))
    this.stationsEl.replaceChildren(title, list)
  }

  private skedText(): string {
    const s = this.state.sticky
    return expandSked(this.skedTemplate, { qrgMHz: s.freq, skedQrg: this.kst.skedQrg(s.band), mode: s.mode, loc: this.meta.myGrid })
  }

  /** "Sked QRG 2m: 144.300" (or not set). */
  private skedQrgNow(): string {
    const band = this.state.sticky.band
    return t('kst.skedQrgIs', { band, qrg: this.kst.skedQrg(band) || t('kst.skedQrgNone') })
  }

  /** The state the current line applies to: a locator filled in for another call is dropped
   *  (OK1ABC filled, then corrected to OK1ABD — not OK1ABC's locator). */
  private lineState(): CoreState {
    const a = this.autoGrid
    const p = this.state.partial
    if (!a || p !== a.partial || this.effectiveCall()?.toUpperCase() === a.call) return this.state
    const { grid: _drop, ...rest } = p
    return { ...this.state, partial: rest }
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

/** "3:42" from milliseconds (hours:minutes, rounded down). */
function hm(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

/** The 6H header badge: text and class for the phase. */
function sixHBadge(st: { readonly phase: SixHourPhase; readonly leftMs: number }): [string, string] {
  if (st.phase === 'over') return ['6H 0:00', 'hdr-6h hdr-6h--over']
  if (st.phase === 'break') return [`6H (${hm(st.leftMs)})`, 'hdr-6h hdr-6h--break']
  return [`6H ${hm(st.leftMs)}`, 'hdr-6h']
}
