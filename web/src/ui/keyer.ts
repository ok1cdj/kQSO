// CW keyer controller, one for the whole app (the link survives screen changes).
// Owns the KeyerProtocol over platform.keyer, the settings (on/off, default speed,
// RUN/S&P, macros) and the reconnect. Screens subscribe and re-render on change.
// CW goes out through a CwOutput: the IC-705's own keyer while the radio is connected
// (CivCwOutput), else the M5 keyer — the screens and macros don't tell them apart.
// Nothing happens — no Bluetooth at all — until "CW keying" is switched on.

import {
  CivCwOutput,
  KeyerProtocol,
  chunk,
  clampWpm,
  macroFor,
  parseMacros,
  sanitize,
  WPM_DEFAULT,
} from '../core/index'
import type { CwOutput, KeyerEvent, MacroSlot, ProfileId, RunMode, SavedMacros } from '../core/index'
import type { KQSOPlatform, KeyerLinkState, KeyerTransport } from '../platform/index'
import { switchOn } from './dom'
import { browserTimers } from './rig'
import type { RigController } from './rig'

export const KEYER_SETTINGS = {
  enabled: 'keyerEnabled', // '1' / '0', default off
  wpm: 'keyerWpm', // default speed, sent on every connect
  mode: 'keyerRunMode', // 'run' | 'sp'
  macros: 'keyerMacros', // JSON, only the edited slots (core/keyer.ts SavedMacros)
  esm: 'keyerEsm', // '1' / '0', default off — Enter sends the macros (ESM)
} as const

/** Something the screens should tell the operator once (strip notice). */
export type KeyerNotice =
  | { readonly type: 'error'; readonly what: string } // keyer ERR char | full | watchdog | busy …
  | { readonly type: 'connectFailed'; readonly message: string }

const RETRY_MS = 1500

export class KeyerController {
  readonly available: boolean
  enabled = false
  /** The M5 keyer's own link (Settings); the logging screen wants outLink. */
  link: KeyerLinkState = 'off'
  name: string | undefined
  battery: number | undefined
  mode: RunMode = 'run'
  defaultWpm = WPM_DEFAULT
  macros: SavedMacros = {}
  esm = false
  /** Last thing to report; screens show it and call clearNotice(). */
  notice: KeyerNotice | undefined

  private readonly transport: KeyerTransport | undefined
  private readonly proto: KeyerProtocol | undefined
  private readonly civ: CivCwOutput | undefined
  private readonly listeners = new Set<() => void>()
  private wantLink = false // the operator wants to be connected (not after Odpojit / off)
  private retried = false // one quiet reconnect after an unexpected drop

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly rig: RigController,
  ) {
    const tr = platform.keyer
    this.transport = tr
    this.available = tr !== undefined || rig.available
    if (rig.proto) {
      this.civ = new CivCwOutput(rig.proto, browserTimers, (ev) => this.onEvent(ev))
      let ready = false
      rig.subscribe(() => {
        if (rig.ready === ready) return
        ready = rig.ready
        this.civ!.reset()
        // Radio up: the default speed, as for the keyer on every connect.
        if (ready) void this.safe(() => this.civ!.setWpm(this.defaultWpm))
        this.emit()
      })
    }
    if (!tr) return
    this.proto = new KeyerProtocol(
      (line) => {
        for (const c of chunk(line, tr.mtu)) tr.write(c)
      },
      (ev) => this.onEvent(ev),
    )
    tr.onData((text) => this.proto?.receive(text))
    tr.onState((s, name) => this.onLink(s, name))
    tr.onBattery((pct) => {
      this.battery = pct
      this.emit()
    })
  }

  /** Load the settings; reconnect quietly when keying was on. Call once at start. */
  async init(): Promise<void> {
    if (!this.available) return
    const p = this.platform
    this.enabled = switchOn(await p.getSetting(KEYER_SETTINGS.enabled), false)
    this.defaultWpm = clampWpm(Number(await p.getSetting(KEYER_SETTINGS.wpm)) || WPM_DEFAULT)
    this.mode = (await p.getSetting(KEYER_SETTINGS.mode)) === 'sp' ? 'sp' : 'run'
    this.macros = parseMacros(await p.getSetting(KEYER_SETTINGS.macros))
    this.esm = switchOn(await p.getSetting(KEYER_SETTINGS.esm), false)
    document.addEventListener('visibilitychange', () => {
      // Back from sleep / another app: the link may have dropped meanwhile.
      if (!document.hidden && this.enabled && this.wantLink && this.link === 'off') void this.connect(false)
    })
    if (this.enabled) void this.connect(false)
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** CW goes through the IC-705 (connected and switched on), not the M5 keyer. */
  get viaRig(): boolean {
    return this.civ !== undefined && this.rig.controls
  }

  private get out(): CwOutput | undefined {
    return this.viaRig ? this.civ : this.proto
  }

  /** Link of whatever sends CW now: the radio when it does, else the keyer. */
  get outLink(): KeyerLinkState {
    return this.viaRig ? 'on' : this.link
  }

  get connected(): boolean {
    return this.outLink === 'on'
  }

  get sending(): boolean {
    return this.out?.sending ?? false
  }

  get version(): string | undefined {
    return this.proto?.version
  }

  /** In CW with something to key: the IC-705 (no switch needed — connecting it is the
   *  choice), or the M5 keyer with "CW keying" on. The logging screen then shows the
   *  keyer (header, macros, commands). */
  activeFor(mode: string): boolean {
    return mode === 'CW' && (this.viaRig || (this.transport !== undefined && this.enabled))
  }

  /** `save` = false when the caller (the Settings switch) stores the value itself —
   *  two writes of the same setting at once collide in the OPFS worker. */
  async setEnabled(on: boolean, save = true): Promise<void> {
    this.enabled = on
    if (save) await this.platform.setSetting(KEYER_SETTINGS.enabled, on ? '1' : '0')
    if (on) await this.connect(false)
    else await this.disconnect()
    this.emit()
  }

  /** `pick` = the chooser (from a tap); otherwise the remembered keyer, if any. */
  async connect(pick: boolean): Promise<void> {
    const tr = this.transport
    await this.attempt(async () => void (await tr!.connect(pick)))
  }

  /** From the logging screen (C ⏎, a tap on RUN / S&P): the remembered keyer, else the
   *  chooser — right away, while the key press / tap still counts as a user gesture. */
  async reconnect(): Promise<void> {
    if (this.outLink !== 'off') return
    if (this.rig.enabled && this.rig.link === 'off') return this.rig.reconnect()
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
      // Closing the chooser is not an error worth a message.
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) {
        this.notice = { type: 'connectFailed', message: e instanceof Error ? e.message : String(e) }
        this.emit()
      }
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
    this.battery = undefined
    this.emit()
  }

  /** Default speed (Settings): saved, and sent now when connected. */
  async setDefaultWpm(n: number): Promise<void> {
    this.defaultWpm = clampWpm(n)
    await this.platform.setSetting(KEYER_SETTINGS.wpm, String(this.defaultWpm))
    if (this.connected) await this.safe(() => this.out!.setWpm(this.defaultWpm))
    this.emit()
  }

  /** S20: this speed until disconnect; the default stays. */
  async setSpeed(n: number): Promise<void> {
    if (this.connected) await this.safe(() => this.out!.setWpm(clampWpm(n)))
    this.emit()
  }

  get wpm(): number | undefined {
    return this.out?.wpm
  }

  /** ESM on / off (E on the line, Settings). `save` = false when the caller stored it. */
  async setEsm(on: boolean, save = true): Promise<void> {
    this.esm = on
    if (save) await this.platform.setSetting(KEYER_SETTINGS.esm, on ? '1' : '0')
    this.emit()
  }

  async setMode(mode: RunMode): Promise<void> {
    this.mode = mode
    await this.platform.setSetting(KEYER_SETTINGS.mode, mode)
    this.emit()
  }

  macroText(profile: ProfileId, slot: MacroSlot, mode: RunMode = this.mode): string {
    return macroFor(this.macros, profile, mode, slot)
  }

  async saveMacros(m: SavedMacros): Promise<void> {
    this.macros = m
    await this.platform.setSetting(KEYER_SETTINGS.macros, JSON.stringify(m))
  }

  /** Send already-expanded text; returns the characters dropped by the conversion. */
  async send(text: string): Promise<string[]> {
    const { text: clean, dropped } = sanitize(text)
    if (!this.connected || clean.length === 0) return dropped
    const out = this.out!
    const p = this.safe(() => out.send(clean))
    this.emit() // sending → STOP appears right away
    await p
    this.emit()
    return dropped
  }

  async stop(): Promise<void> {
    if (!this.connected) return
    await this.safe(() => this.out!.stop())
    this.emit()
  }

  clearNotice(): void {
    this.notice = undefined
  }

  private async safe(f: () => Promise<void>): Promise<void> {
    try {
      await f()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'disconnected') {
        this.notice = { type: 'error', what: msg.replace(/^ERR /i, '') }
        this.emit()
      }
    }
  }

  private onLink(s: KeyerLinkState, name: string | undefined): void {
    const was = this.link
    this.link = s
    if (name) this.name = name
    if (s === 'on') {
      this.proto?.reset()
      this.retried = false
      // Every connect: version, then the default speed (an S20 lasts only until here).
      void this.safe(async () => {
        await this.proto!.ver()
        await this.proto!.setWpm(this.defaultWpm)
        this.emit()
      })
    } else if (s === 'off') {
      this.proto?.reset()
      // Dropped while wanted: one quiet retry (out of range for a moment, keyer reset).
      if (was === 'on' && this.wantLink && this.enabled && !this.retried) {
        this.retried = true
        window.setTimeout(() => {
          if (this.wantLink && this.link === 'off' && this.transport) void this.transport.connect(false).catch(() => {})
        }, RETRY_MS)
      }
    }
    this.emit()
  }

  private onEvent(ev: KeyerEvent): void {
    if (ev.type === 'error') this.notice = { type: 'error', what: ev.what }
    this.emit()
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}
