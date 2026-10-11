// Radio controller, one for the whole app (the link survives screen changes). Owns the
// CivProtocol over one of two transports: the IC-705's own Bluetooth (platform.rig,
// handshake first), or any Icom on the keyer's CI-V bus (KeyerCivTransport, ui/keyer-civ.ts).
// The radio's frequency and mode (CI-V transceive), tuning from the logging line; what
// the radio can do comes from its definition (core/rigmodel.ts). CW through the radio
// is KeyerController's (CivCwOutput over this protocol). Nothing happens until the radio
// is switched on.

import {
  CivProtocol,
  IC705,
  RIG_ADDR,
  bandForFreq,
  bandSpot,
  civCommand,
  civModeFor,
  ifBand,
  modelById,
  modelForAddr,
  parseXverts,
  rigHasBand,
  rigTunes,
  toIf,
  toRf,
  modeFromCiv,
  parseBandStack,
  playVoice,
  readBandStack,
  readFreq,
  readMode,
  readTx,
  setFreq,
  setMode,
} from '../core/index'
import type { RigEvent, RigModel, Timers, Xvert } from '../core/index'
import type { KQSOPlatform, KeyerLinkState, RigTransport } from '../platform/index'
import { switchOn } from './dom'
import type { KeyerCivTransport } from './keyer-civ'

export const RIG_SETTINGS = {
  enabled: 'rigEnabled', // '1' / '0', default off
  source: 'rigSource', // 'ic705' (its own Bluetooth, APK) | 'keyer' (CI-V through the keyer)
  model: 'rigModel', // radio via the keyer: 'auto' (by its address) or a RigModel id
  options: 'rigOptions', // JSON string[]: bands of optional units switched on (IC-910 23 cm)
  clientId: 'rigClientId', // random UUID: with the name, how the radio knows this install
  xvert: 'rigXvert', // '1' / '0', default off — transverters on
  xverts: 'rigXverts', // JSON Xvert[] (core/xvert.ts)
} as const

export type RigSource = 'ic705' | 'keyer'

/** Name shown in the radio's paired device list (16 characters at most). */
const RIG_CLIENT_NAME = 'kQSO'

export type RigNotice =
  | { readonly type: 'connectFailed'; readonly message: string }
  | { readonly type: 'firmware' } // the keyer has no CI-V tunnel (firmware before 2.1.0)
  | { readonly type: 'tuneFailed' } // the radio refused a frequency / mode from the line
  | { readonly type: 'voiceFailed'; readonly memory: number } // empty memory, or not a phone mode

const RETRY_MS = 1500
/** Keeps the radio's output flowing (Ic705Protocol: it sends only after a write). */
const POLL_MS = 250
/** Voice memory: when to start asking whether the radio is still transmitting, and how often. */
const VOICE_FIRST_MS = 800
const VOICE_POLL_MS = 300

/** Voice TX memories offered in the strip (the radio has T1–T8). */
export const VOICE_MEMORIES = [1, 2, 3, 4] as const

export const browserTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id as number),
}

/** A v4 UUID. crypto.randomUUID needs a secure context, which the iOS shell's own
 *  URL scheme may not count as; getRandomValues works everywhere. */
function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export class RigController {
  readonly available: boolean
  enabled = false
  /** Where the radio is: the IC-705's own Bluetooth, or the keyer's CI-V bus. */
  source: RigSource
  /** Radio via the keyer: 'auto' (by the address the keyer found) or a RigModel id. */
  modelChoice = 'auto'
  /** Bands of optional units switched on (IC-910 23 cm). */
  options: string[] = []
  link: KeyerLinkState = 'off'
  /** Handshake done: CI-V commands work. */
  ready = false
  name: string | undefined
  freqHz: number | undefined
  private modeCode: number | undefined
  notice: RigNotice | undefined
  /** A voice memory is on the air (STOP in the strip). */
  voicePlaying = false
  private voiceRun = 0 // bumped by every play / stop: an older watch sees it and quits
  /** Transverters switched on, and their table. */
  xvertOn = false
  xverts: readonly Xvert[] = []
  /** The log is on a transverter band: the radio sits on its IF. */
  private xv: Xvert | undefined
  /** The log is on a band the radio doesn't work (and no transverter): the radio is left
   *  alone until a radio band is typed or the radio itself goes to another band. */
  private away: { readonly band: string; readonly radioBand: string | undefined; readonly hz?: number } | undefined
  /** adopt() waiting for the radio's first frequency. */
  private adopting: string | undefined
  /** The protocol, for CW through the radio (KeyerController). */
  readonly proto: CivProtocol | undefined

  private readonly ic705: RigTransport | undefined
  private keyerTr: KeyerCivTransport | undefined
  private readonly listeners = new Set<() => void>()
  private clientId = ''
  private pollTimer: number | undefined
  private wantLink = false
  private retried = false

  constructor(private readonly platform: KQSOPlatform) {
    const tr = platform.rig
    this.ic705 = tr
    this.available = tr !== undefined || platform.keyer !== undefined
    this.source = tr ? 'ic705' : 'keyer'
    if (!this.available) return
    this.proto = new CivProtocol(
      (bytes) => {
        const t = this.transport
        if (!t) return
        for (let i = 0; i < bytes.length; i += t.mtu) t.write(bytes.slice(i, i + t.mtu))
      },
      (ev) => this.onEvent(ev),
      browserTimers,
      this.source === 'ic705' ? RIG_ADDR : undefined,
    )
    tr?.onData((bytes) => {
      if (this.source === 'ic705') this.proto?.receive(bytes)
    })
    tr?.onState((s, name) => {
      if (this.source === 'ic705') this.onLink(s, name)
    })
  }

  /** The keyer's CI-V tunnel (KeyerController.civLink) — it needs this controller's
   *  protocol first, hence not in the constructor. */
  attachKeyer(tr: KeyerCivTransport | undefined): void {
    this.keyerTr = tr
    tr?.onData((bytes) => {
      if (this.source === 'keyer') this.proto?.receive(bytes)
    })
    tr?.onState((s, name) => {
      if (this.source === 'keyer') this.onLink(s, name)
    })
  }

  private get transport(): RigTransport | undefined {
    return this.source === 'ic705' ? this.ic705 : this.keyerTr
  }

  /** Both ways to a radio exist here (APK); otherwise Settings shows no choice. */
  get sourceChoice(): boolean {
    return this.ic705 !== undefined && this.platform.keyer !== undefined
  }

  /** What the radio is and can do. Via the keyer: chosen in Settings, else by the
   *  address the keyer found. */
  get model(): RigModel {
    if (this.source === 'ic705') return IC705
    return (this.modelChoice === 'auto' ? undefined : modelById(this.modelChoice)) ?? this.detectedModel
  }

  /** Via the keyer: the model at the address the keyer found (Settings: "Auto (…)"). */
  get detectedModel(): RigModel {
    return modelForAddr(this.keyerTr?.addr)
  }

  /** Via the keyer: the radio's CI-V address as the keyer found it. */
  get addr(): number | undefined {
    return this.source === 'keyer' ? this.keyerTr?.addr : RIG_ADDR
  }

  /** Via the keyer: connected, but its firmware has no CI-V tunnel. */
  get oldFirmware(): boolean {
    return this.source === 'keyer' && (this.keyerTr?.oldFirmware ?? false)
  }

  /** The radio works `band` itself (by its definition and the units switched on). */
  private hasBand(band: string): boolean {
    return rigHasBand(this.model, band, this.options)
  }

  async init(): Promise<void> {
    if (!this.available) return
    const p = this.platform
    this.enabled = switchOn(await p.getSetting(RIG_SETTINGS.enabled), false)
    const src = await p.getSetting(RIG_SETTINGS.source)
    if (src === 'keyer' && this.platform.keyer) this.source = 'keyer'
    else if (src === 'ic705' && this.ic705) this.source = 'ic705'
    if (this.proto) this.proto.rigAddr = this.source === 'ic705' ? RIG_ADDR : undefined
    this.modelChoice = (await p.getSetting(RIG_SETTINGS.model)) ?? 'auto'
    this.options = parseOptions(await p.getSetting(RIG_SETTINGS.options))
    this.xvertOn = switchOn(await p.getSetting(RIG_SETTINGS.xvert), false)
    this.xverts = parseXverts(await p.getSetting(RIG_SETTINGS.xverts))
    this.clientId = (await p.getSetting(RIG_SETTINGS.clientId)) ?? ''
    if (!this.clientId) {
      this.clientId = randomUuid().toUpperCase()
      await p.setSetting(RIG_SETTINGS.clientId, this.clientId)
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !this.enabled || !this.wantLink) return
      if (this.link === 'off') void this.connect(false)
      else if (this.ready) this.refresh() // changes made on the radio meanwhile
    })
    if (this.enabled) void this.connect(false)
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** kQSO mode of the radio, undefined for modes not logged (AM, RTTY, DV) or unknown. */
  get mode(): string | undefined {
    return this.modeCode === undefined ? undefined : modeFromCiv(this.modeCode)
  }

  /** Band / mode / frequency come from the radio. */
  get controls(): boolean {
    return this.enabled && this.ready
  }

  /** The log is on a band the radio isn't on: don't take band / mode from it. */
  get detached(): boolean {
    return this.away !== undefined
  }

  /** CW and voice memories go through the radio: connected, and the log is on its band
   *  (a VHF contest on 23 cm runs another rig — this radio must not key). */
  get keys(): boolean {
    return this.controls && !this.detached
  }

  /** CW through the radio's own keyer (CI-V 17): a radio that has it. */
  get cwViaCiv(): boolean {
    return this.keys && this.model.cwCiv === true
  }

  /** Voice memories T1–T4 in the strip: a radio that has them. */
  get voice(): boolean {
    return this.keys && this.model.voice === true
  }

  /** Header badge: 705, 7300, 9700, CIV … */
  get label(): string {
    return this.model.short
  }

  /** While detached by F…: the frequency typed (the log gets band + FREQ from it). */
  get awayHz(): number | undefined {
    return this.away?.hz
  }

  /** Frequency for the log: on a transverter band the RF one, else the radio's. */
  get logFreqHz(): number | undefined {
    return this.xv && this.freqHz !== undefined ? toRf(this.xv, this.freqHz) : this.freqHz
  }

  /** On a transverter band: its name (header). */
  get xvertBand(): string | undefined {
    return this.xv?.band
  }

  private xvertFor(band: string): Xvert | undefined {
    if (!this.xvertOn) return undefined
    return this.xverts.find((x) => x.band === band && x.on && this.hasBand(ifBand(x) ?? ''))
  }

  /**
   * The log opens (or the radio comes up) on `band`. On a radio band the log follows the
   * radio as always; on a band the radio doesn't work it is detached, so reopening a VHF
   * contest log that stopped on 23 cm stays on 23 cm; on a transverter band whose IF the
   * radio is on, the transverter applies. The radio is never retuned here.
   */
  adopt(band: string): void {
    if (!this.controls) return
    if (this.hasBand(band) && !this.xvertFor(band)) {
      // Another log (or this one) on a radio band: whatever the last one left is gone.
      this.adopting = undefined
      if (this.away || this.xv) {
        this.away = undefined
        this.xv = undefined
        this.emit()
      }
      return
    }
    if (this.freqHz === undefined) {
      this.adopting = band // decided on the first frequency
      return
    }
    const rb = bandForFreq(this.freqHz)
    const x = this.xvertFor(band)
    if (x && rb === ifBand(x)) {
      this.xv = x
      this.away = undefined
    } else {
      this.away = { band, radioBand: rb }
      this.xv = undefined
    }
    this.emit()
  }

  /** XVERT on / off (Settings). `save` = false when the caller stored it. */
  async setXvertOn(on: boolean, save = true): Promise<void> {
    this.xvertOn = on
    if (save) await this.platform.setSetting(RIG_SETTINGS.xvert, on ? '1' : '0')
    if (!on) this.xv = undefined
    this.emit()
  }

  async saveXverts(xs: readonly Xvert[]): Promise<void> {
    this.xverts = xs
    await this.platform.setSetting(RIG_SETTINGS.xverts, JSON.stringify(xs))
    this.emit()
  }

  /** IC-705 Bluetooth or the keyer (Settings). The old link goes, the new one comes
   *  up when the radio is switched on. */
  async setSource(src: RigSource, save = true): Promise<void> {
    if (src === this.source || (src === 'ic705' && !this.ic705) || (src === 'keyer' && !this.platform.keyer)) return
    this.wantLink = false
    await this.transport?.disconnect()
    this.source = src
    if (save) await this.platform.setSetting(RIG_SETTINGS.source, src)
    this.proto?.reset()
    if (this.proto) this.proto.rigAddr = src === 'ic705' ? RIG_ADDR : undefined
    this.link = 'off'
    this.ready = false
    this.name = undefined
    this.freqHz = undefined
    this.modeCode = undefined
    this.away = undefined
    this.xv = undefined
    if (this.enabled) await this.connect(false)
    this.emit()
  }

  /** Radio via the keyer: 'auto' or a model id (Settings). */
  async setModel(id: string): Promise<void> {
    this.modelChoice = id
    await this.platform.setSetting(RIG_SETTINGS.model, id)
    this.emit()
  }

  /** An optional unit (its band) on / off (Settings). */
  async setOption(band: string, on: boolean): Promise<void> {
    this.options = on ? [...new Set([...this.options, band])] : this.options.filter((b) => b !== band)
    await this.platform.setSetting(RIG_SETTINGS.options, JSON.stringify(this.options))
    this.emit()
  }

  async setEnabled(on: boolean, save = true): Promise<void> {
    this.enabled = on
    if (save) await this.platform.setSetting(RIG_SETTINGS.enabled, on ? '1' : '0')
    if (on) await this.connect(false)
    else await this.disconnect()
    this.emit()
  }

  async connect(pick: boolean): Promise<void> {
    const tr = this.transport
    await this.attempt(async () => void (await tr!.connect(pick)))
  }

  /** From the logging screen (a tap on the header badge): remembered radio, else chooser. */
  async reconnect(): Promise<void> {
    if (this.link !== 'off') return
    const tr = this.transport
    await this.attempt(async () => {
      if (!(await tr!.connect(false))) await tr!.connect(true)
    })
  }

  private async attempt(f: () => Promise<void>): Promise<void> {
    if (!this.transport || !this.enabled) return
    this.wantLink = true
    this.retried = false
    try {
      await f()
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) this.fail(e instanceof Error ? e.message : String(e))
    }
  }

  async disconnect(): Promise<void> {
    this.wantLink = false
    await this.transport?.disconnect()
  }

  async forget(): Promise<void> {
    this.wantLink = false
    await this.transport?.forget()
    this.name = undefined
    this.emit()
  }

  /**
   * Band / mode typed on the logging line → the radio. The mode stays the log's (or the
   * typed one) — a band change never switches it (a register can hold FM on 15 m, or
   * USB-D on 28.074). A new band goes to the radio's last frequency there (its band
   * stacking register), else to the usual spot for the mode. The radio's transceive then
   * reports what it really did.
   *
   * A transverter band tunes the radio to its IF; a band the radio doesn't work (VHF
   * contest on 23 cm) leaves the radio alone — only the log switches (detached), and
   * QSOs are logged on it. So does a band the radio refuses (one its definition doesn't
   * know it lacks: an IC-910 without its 23 cm unit, a radio not in the table).
   */
  async tune(band: string | undefined, mode: string | undefined): Promise<void> {
    if (!this.controls || !this.proto) return
    const want = mode ?? this.mode
    if (band !== undefined) {
      const x = this.xvertFor(band)
      if (x) return this.go(x.ifHz, want, { xv: x })
      if (!this.hasBand(band)) {
        this.away = { band, radioBand: bandForFreq(this.freqHz ?? 0) }
        this.xv = undefined
        this.emit()
        return
      }
      this.away = undefined
      this.xv = undefined
    }
    if (this.away) return // a mode for the band the radio isn't on
    try {
      let hz = this.freqHz ?? 0
      if (band !== undefined && band !== bandForFreq(hz)) {
        const to = (await this.stacked(band))?.hz ?? bandSpot(band, want ?? 'SSB')
        if (to === undefined || !(await this.took(to))) {
          // Nowhere to go, or the radio refused: the log keeps the band, the radio stays.
          this.away = { band, radioBand: bandForFreq(this.freqHz ?? 0) }
          this.xv = undefined
          this.emit()
          return
        }
        hz = to
        this.freqHz = to
      }
      const code = want === undefined ? undefined : civModeFor(want, hz)
      if (code !== undefined && (mode !== undefined || band !== undefined) && code !== this.modeCode) {
        await this.proto.command(setMode(code))
        this.modeCode = code
      }
    } catch {
      this.notice = { type: 'tuneFailed' }
      this.refresh()
    }
    this.emit()
  }

  /** F28300 on the line: straight to that frequency; the mode stays (only LSB / USB
   *  follow the 10 MHz rule). On a transverter band the radio goes to the IF; on a band
   *  the radio doesn't work only the log takes it (band + FREQ). */
  async tuneTo(hz: number): Promise<void> {
    if (!this.controls || !this.proto) return
    const band = bandForFreq(hz)
    const x = band === undefined ? undefined : this.xvertFor(band)
    if (x) return this.go(toIf(x, hz), this.mode, { xv: x })
    if (band !== undefined && !this.hasBand(band)) {
      this.away = { band, radioBand: bandForFreq(this.freqHz ?? 0), hz }
      this.xv = undefined
      this.emit()
      return
    }
    if (!rigTunes(this.model, hz)) {
      this.notice = { type: 'tuneFailed' }
      this.emit()
      return
    }
    return this.go(hz, this.mode, {})
  }

  /** Radio to `hz` in mode `want` (LSB / USB by the 10 MHz rule); the transverter state
   *  is set once the radio took it, so a reply still on the old band can't undo it. */
  private async go(hz: number, want: string | undefined, to: { xv?: Xvert }): Promise<void> {
    if (!this.proto) return
    try {
      if (!(await this.took(hz))) {
        const band = bandForFreq(hz)
        if (to.xv || band === undefined || band === bandForFreq(this.freqHz ?? 0)) throw new Error('rejected')
        // Another band the radio refused: the log takes band + FREQ, the radio stays.
        this.away = { band, radioBand: bandForFreq(this.freqHz ?? 0), hz }
        this.xv = undefined
        this.emit()
        return
      }
      this.freqHz = hz
      this.xv = to.xv
      this.away = undefined
      const code = want === undefined ? undefined : civModeFor(want, hz)
      if (code !== undefined && code !== this.modeCode) {
        await this.proto.command(setMode(code))
        this.modeCode = code
      }
    } catch {
      this.notice = { type: 'tuneFailed' }
      this.refresh()
    }
    this.emit()
  }

  /** Set the frequency; false when the radio refused it (FA, or no answer). */
  private async took(hz: number): Promise<boolean> {
    try {
      await this.proto!.command(setFreq(hz))
      return true
    } catch {
      return false
    }
  }

  /** The radio's newest band stacking register for `band`, if it has one there. */
  private async stacked(band: string): Promise<{ hz: number; code: number } | undefined> {
    const frame = readBandStack(band, this.model.bandStack)
    if (!frame || !this.proto) return undefined
    try {
      const r = parseBandStack(await this.proto.command(frame))
      return r && bandForFreq(r.hz) === band ? r : undefined
    } catch {
      return undefined
    }
  }

  /** Transmit voice memory T`n`. The radio doesn't say when it is done, so its TX state
   *  is watched until it is back on receive (twice in a row). */
  async playVoice(n: number): Promise<void> {
    if (!this.voice || !this.proto) return
    const run = ++this.voiceRun
    try {
      await this.proto.command(playVoice(n))
    } catch {
      this.notice = { type: 'voiceFailed', memory: n }
      this.emit()
      return
    }
    this.voicePlaying = true
    this.emit()
    await this.sleep(VOICE_FIRST_MS)
    for (let rx = 0; run === this.voiceRun && this.ready; ) {
      try {
        const tx = await this.proto.command(readTx()) // 00 <00 rx | 01 tx>
        rx = tx[1] === 0 ? rx + 1 : 0
      } catch {
        rx = 0
      }
      if (rx >= 2) break
      await this.sleep(VOICE_POLL_MS)
    }
    if (run !== this.voiceRun) return
    this.voicePlaying = false
    this.emit()
  }

  async stopVoice(): Promise<void> {
    this.voiceRun++
    this.voicePlaying = false
    this.emit()
    await this.proto?.command(playVoice(0)).catch(() => {})
  }

  clearNotice(): void {
    this.notice = undefined
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => window.setTimeout(r, ms))
  }

  /** Read frequency and mode again (replies come in as events). */
  private refresh(): void {
    const p = this.proto
    if (!p) return
    void p.command(readFreq()).catch(() => {})
    void p.command(readMode()).catch(() => {})
  }

  private failFirmware(): void {
    this.notice = { type: 'firmware' }
    this.emit()
  }

  private fail(message: string): void {
    this.notice = { type: 'connectFailed', message }
    this.emit()
  }

  private onLink(s: KeyerLinkState, name: string | undefined): void {
    const was = this.link
    this.link = s
    if (name) this.name = name
    this.proto?.reset()
    this.ready = false // again after the handshake
    this.adopting = undefined
    window.clearInterval(this.pollTimer)
    this.voiceRun++
    this.voicePlaying = false
    if (s === 'on') {
      void this.start() // retried resets only after the handshake: a radio that drops us right away is not retried forever
    } else if (s === 'connecting' && this.oldFirmware) {
      this.failFirmware()
    } else if (s === 'off') {
      this.freqHz = undefined
      this.modeCode = undefined
      // Via the keyer its own controller retries the link.
      if (was === 'on' && this.wantLink && this.enabled && !this.retried && this.source === 'ic705') {
        this.retried = true
        window.setTimeout(() => {
          if (this.wantLink && this.link === 'off' && this.transport) void this.transport.connect(false).catch(() => {})
        }, RETRY_MS)
      }
    }
    this.emit()
  }

  /** Link up. IC-705: Icom handshake, transceive on, then the current frequency and
   *  mode. Via the keyer: no handshake, and the radio's Transceive is its own menu. */
  private async start(): Promise<void> {
    const p = this.proto!
    if (this.source === 'keyer') {
      p.markReady()
      this.refresh()
      return
    }
    try {
      await p.handshake(this.clientId, RIG_CLIENT_NAME)
    } catch (e) {
      if (this.link !== 'on') return
      this.fail(e instanceof Error ? e.message : String(e))
      void this.transport?.disconnect()
      return
    }
    const tx = this.model.transceiveOn
    if (tx) await p.command(civCommand(tx)).catch(() => {}) // already on, or the menu refuses: reads still work
    this.refresh()
  }

  private onEvent(ev: RigEvent): void {
    if (ev.type === 'ready') {
      this.ready = true
      this.retried = false
      window.clearInterval(this.pollTimer)
      // Only the IC-705's Bluetooth needs it; on a wired bus transceive frames just come.
      if (this.source === 'ic705') this.pollTimer = window.setInterval(() => this.proto?.poll(readFreq()), POLL_MS)
    }
    if (ev.type === 'freq') {
      this.freqHz = ev.hz
      const pending = this.adopting
      this.adopting = undefined
      if (pending) this.adopt(pending)
      // The radio went to another band by itself: follow it again.
      const rb = bandForFreq(ev.hz)
      if (this.away && rb !== this.away.radioBand) this.away = undefined
      if (this.xv && rb !== ifBand(this.xv)) this.xv = undefined
    }
    if (ev.type === 'mode') this.modeCode = ev.code
    this.emit()
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

/** Stored optional units (JSON string[]); anything else → none. */
function parseOptions(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((b): b is string => typeof b === 'string') : []
  } catch {
    return []
  }
}
