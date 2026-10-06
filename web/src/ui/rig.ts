// IC-705 controller, one for the whole app (the link survives screen changes). Owns the
// Ic705Protocol over platform.rig: handshake, the radio's frequency and mode (CI-V
// transceive), tuning from the logging line. CW through the radio is KeyerController's
// (CivCwOutput over this protocol). Nothing happens until "IC-705" is switched on.

import { Ic705Protocol, bandForFreq, bandSpot, civModeFor, modeFromCiv, readFreq, readMode, setFreq, setMode, transceiveOn } from '../core/index'
import type { RigEvent, Timers } from '../core/index'
import type { KQSOPlatform, KeyerLinkState, RigTransport } from '../platform/index'
import { switchOn } from './dom'

export const RIG_SETTINGS = {
  enabled: 'rigEnabled', // '1' / '0', default off
  clientId: 'rigClientId', // random UUID: with the name, how the radio knows this install
} as const

/** Name shown in the radio's paired device list (16 characters at most). */
const RIG_CLIENT_NAME = 'kQSO'

export type RigNotice =
  | { readonly type: 'connectFailed'; readonly message: string }
  | { readonly type: 'tuneFailed' } // the radio refused a frequency / mode from the line

const RETRY_MS = 1500
/** Keeps the radio's output flowing (Ic705Protocol: it sends only after a write). */
const POLL_MS = 250

export const browserTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id as number),
}

export class RigController {
  readonly available: boolean
  enabled = false
  link: KeyerLinkState = 'off'
  /** Handshake done: CI-V commands work. */
  ready = false
  name: string | undefined
  freqHz: number | undefined
  private modeCode: number | undefined
  notice: RigNotice | undefined
  /** The protocol, for CW through the radio (KeyerController). */
  readonly proto: Ic705Protocol | undefined

  private readonly transport: RigTransport | undefined
  private readonly listeners = new Set<() => void>()
  private readonly lastFreq = new Map<string, number>() // band → the radio's last frequency there
  private clientId = ''
  private pollTimer: number | undefined
  private wantLink = false
  private retried = false

  constructor(private readonly platform: KQSOPlatform) {
    const tr = platform.rig
    this.transport = tr
    this.available = tr !== undefined
    if (!tr) return
    this.proto = new Ic705Protocol(
      (bytes) => {
        for (let i = 0; i < bytes.length; i += tr.mtu) tr.write(bytes.slice(i, i + tr.mtu))
      },
      (ev) => this.onEvent(ev),
      browserTimers,
    )
    tr.onData((bytes) => this.proto?.receive(bytes))
    tr.onState((s, name) => this.onLink(s, name))
  }

  async init(): Promise<void> {
    if (!this.available) return
    const p = this.platform
    this.enabled = switchOn(await p.getSetting(RIG_SETTINGS.enabled), false)
    this.clientId = (await p.getSetting(RIG_SETTINGS.clientId)) ?? ''
    if (!this.clientId) {
      this.clientId = crypto.randomUUID().toUpperCase()
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
   * Band / mode typed on the logging line → the radio. A new band goes to the radio's
   * last frequency there, else the usual spot for the mode; the radio's transceive then
   * reports what it really did.
   */
  async tune(band: string | undefined, mode: string | undefined): Promise<void> {
    if (!this.controls || !this.proto) return
    try {
      let hz = this.freqHz ?? 0
      if (band !== undefined && band !== bandForFreq(hz)) {
        const to = this.lastFreq.get(band) ?? bandSpot(band, mode ?? this.mode ?? 'SSB')
        if (to === undefined) throw new Error('band')
        await this.proto.command(setFreq(to))
        hz = to
        this.freqHz = to
      }
      const want = mode ?? this.mode
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

  clearNotice(): void {
    this.notice = undefined
  }

  /** Read frequency and mode again (replies come in as events). */
  private refresh(): void {
    const p = this.proto
    if (!p) return
    void p.command(readFreq()).catch(() => {})
    void p.command(readMode()).catch(() => {})
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
    window.clearInterval(this.pollTimer)
    if (s === 'on') {
      void this.start() // retried resets only after the handshake: a radio that drops us right away is not retried forever
    } else if (s === 'off') {
      this.freqHz = undefined
      this.modeCode = undefined
      if (was === 'on' && this.wantLink && this.enabled && !this.retried) {
        this.retried = true
        window.setTimeout(() => {
          if (this.wantLink && this.link === 'off' && this.transport) void this.transport.connect(false).catch(() => {})
        }, RETRY_MS)
      }
    }
    this.emit()
  }

  /** GATT up: Icom handshake, transceive on, then the current frequency and mode. */
  private async start(): Promise<void> {
    const p = this.proto!
    try {
      await p.handshake(this.clientId, RIG_CLIENT_NAME)
    } catch (e) {
      if (this.link !== 'on') return
      this.fail(e instanceof Error ? e.message : String(e))
      void this.transport?.disconnect()
      return
    }
    await p.command(transceiveOn()).catch(() => {}) // already on, or the menu refuses: reads still work
    this.refresh()
  }

  private onEvent(ev: RigEvent): void {
    if (ev.type === 'ready') {
      this.ready = true
      this.retried = false
      window.clearInterval(this.pollTimer)
      this.pollTimer = window.setInterval(() => this.proto?.poll(readFreq()), POLL_MS)
    }
    if (ev.type === 'freq') {
      this.freqHz = ev.hz
      const band = bandForFreq(ev.hz)
      if (band) this.lastFreq.set(band, ev.hz)
    }
    if (ev.type === 'mode') this.modeCode = ev.code
    this.emit()
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}
