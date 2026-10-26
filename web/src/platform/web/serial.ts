// Any Icom on a wire through Web Serial (Chrome / Edge on the desktop): the radio's own
// USB (IC-7300, 9700, 705 …) or a CI-V interface (CT-17, a USB–CI-V converter). Like
// the keyer's tunnel there is no handshake and the radio's address is whatever it is
// set to, so the bus rate and the address are found here (probe: listen, then ask each
// known address for its frequency), remembered for the next time, and our frames are
// readdressed to the radio (civFrame has the IC-705's A4). Bytes only — CI-V itself is
// core/civ.ts. Needs a secure context: https or http://localhost.

import { CTRL_ADDR, FrameAssembler, RIG_MODELS, readFreq } from '../../core/index'
import type { KeyerLinkState, SerialRigTransport } from '../types'

/** Setting: the last radio found, JSON SerialFound — the next connection is instant. */
export const SERIAL_SETTING = 'rigSerial'

/** Bus rates tried after the remembered one: USB CI-V on Auto takes any, 115200 is the
 *  fastest; the older radios and the CT-17 run 19200 / 9600 / 4800. */
const BAUDS = [115200, 19200, 9600, 4800]

export interface SerialTiming {
  readonly listen: number // ms: a radio sending transceive frames shows itself
  readonly ask: number // ms: answer to one readFreq
  readonly ping: number // ms of silence after which the radio is asked for its frequency
  readonly lost: number // ms of silence after which the radio is gone (switched off) and looked for again
  readonly retry: number // ms between rounds of the probe while no radio answers
}

const TIMING: SerialTiming = { listen: 300, ask: 150, ping: 2500, lost: 6000, retry: 3000 }

/** Where the settings live (WebPlatform's getSetting / setSetting). */
export interface SerialStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

interface SerialFound {
  readonly baud: number
  readonly addr: number
  readonly vid?: number | undefined
  readonly pid?: number | undefined
}

/** Web Serial exists here (Chrome / Edge on the desktop in a secure context). */
export function webSerialAvailable(): boolean {
  return typeof navigator !== 'undefined' && navigator.serial !== undefined && window.isSecureContext
}

/** A CI-V command frame to `addr` instead of the address it was built with. */
export function addressed(frame: Uint8Array, addr: number): Uint8Array {
  if (frame[0] !== 0xfe || frame[1] !== 0xfe || frame.length < 3) return frame
  const out = frame.slice()
  out[2] = addr
  return out
}

export class WebSerialRig implements SerialRigTransport {
  /** A frame goes in one write; RigController never splits one. */
  readonly mtu = 64
  /** The radio's CI-V address, once found. */
  addr: number | undefined
  /** The bus rate the port is open at. */
  baud: number | undefined
  state: KeyerLinkState = 'off'

  private port: SerialPort | undefined
  private opened = false
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined
  private reading: Promise<void> = Promise.resolve()
  private writing: Promise<void> = Promise.resolve()
  private readonly frames = new FrameAssembler()
  /** The probe waits for a radio: called with the sender of a frame meant for us. */
  private heard: ((from: number) => void) | undefined
  private wanted = false
  private run = 0 // bumped by every connect / disconnect: an older probe quits
  private lastRx = 0
  private watchdog: ReturnType<typeof setInterval> | undefined
  private dataCb: (bytes: Uint8Array) => void = () => {}
  private stateCb: (s: KeyerLinkState, name?: string) => void = () => {}

  constructor(
    private readonly serial: Serial,
    private readonly store: SerialStore,
    private readonly ms: SerialTiming = TIMING,
  ) {
    // The cable back (or the radio's USB on again): the same port, quietly.
    serial.addEventListener('connect', () => {
      if (this.wanted && !this.port) void this.connect(false).catch(() => {})
    })
    serial.addEventListener('disconnect', (e) => {
      if (this.port && e.target === this.port) void this.gone()
    })
  }

  async connect(pick: boolean): Promise<boolean> {
    if (!pick && this.port && this.wanted) return true
    const saved = await this.load()
    let port: SerialPort | undefined
    if (pick) port = await this.serial.requestPort()
    else {
      const ports = await this.serial.getPorts()
      port = ports.find((p) => sameDevice(p, saved)) ?? ports[0]
    }
    if (!port) return false
    const run = ++this.run
    await this.closePort()
    this.wanted = true
    this.port = port
    this.addr = undefined
    this.set('connecting')
    try {
      await this.openAt(saved?.baud ?? BAUDS[0]!)
    } catch (e) {
      // Busy (another program has it) or no permission (Linux: dialout / uucp).
      this.port = undefined
      this.set('off')
      throw e
    }
    void this.find(run)
    return true
  }

  async disconnect(): Promise<void> {
    this.wanted = false
    this.run++
    await this.closePort()
    this.port = undefined
    this.addr = undefined
    this.set('off')
  }

  async forget(): Promise<void> {
    const port = this.port
    await this.disconnect()
    await port?.forget?.().catch(() => {})
    await this.store.set(SERIAL_SETTING, '')
  }

  write(bytes: Uint8Array): void {
    if (this.state !== 'on' || this.addr === undefined) return
    this.raw(addressed(bytes, this.addr))
  }

  onData(cb: (bytes: Uint8Array) => void): void {
    this.dataCb = cb
  }

  onState(cb: (s: KeyerLinkState, name?: string) => void): void {
    this.stateCb = cb
  }

  // ------------------------------------------------------------------------------

  /** Look for the radio: each rate, first listening, then asking every known address,
   *  the remembered rate and address first; again after a pause until one answers. */
  private async find(run: number): Promise<void> {
    while (run === this.run) {
      const saved = await this.load()
      const addrs = unique([saved?.addr, ...RIG_MODELS.map((m) => m.addr)])
      for (const baud of unique([this.baud, saved?.baud, ...BAUDS])) {
        if (run !== this.run) return
        try {
          if (baud !== this.baud) await this.openAt(baud)
        } catch {
          if (run === this.run) void this.gone()
          return
        }
        const addr = await this.ask(addrs, run)
        if (addr === undefined || run !== this.run) continue
        this.addr = addr
        const info = this.port?.getInfo() ?? {}
        const found: SerialFound = { baud, addr, vid: info.usbVendorId, pid: info.usbProductId }
        await this.store.set(SERIAL_SETTING, JSON.stringify(found)).catch(() => {})
        if (run !== this.run) return
        // Once more now the radio answers: a port just plugged in may not have taken it.
        if (this.port) await this.unkey(this.port).catch(() => void this.gone())
        if (run !== this.run) return
        this.lastRx = Date.now()
        this.startWatchdog(run)
        this.set('on')
        return
      }
      await new Promise((r) => setTimeout(r, this.ms.retry))
    }
  }

  /** The sender of the first frame for us: one that came by itself, else an answer. */
  private async ask(addrs: readonly number[], run: number): Promise<number | undefined> {
    const heard = await this.listen(this.ms.listen)
    if (heard !== undefined) return heard
    for (const a of addrs) {
      if (run !== this.run) return undefined
      this.raw(addressed(readFreq(), a))
      const r = await this.listen(this.ms.ask)
      if (r !== undefined) return r
    }
    return undefined
  }

  private listen(ms: number): Promise<number | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.heard = undefined
        resolve(undefined)
      }, ms)
      this.heard = (from) => {
        clearTimeout(timer)
        this.heard = undefined
        resolve(from)
      }
    })
  }

  /** (Re)open the port at `baud`. DTR and RTS low: a radio set to key on them (USB
   *  SEND / USB Keying) must not transmit because a logger opened the port. */
  private async openAt(baud: number): Promise<void> {
    const port = this.port
    if (!port) return
    await this.closePort(false)
    await port.open({ baudRate: baud })
    this.opened = true
    this.baud = baud
    await this.unkey(port)
    if (!port.readable || !port.writable) throw new Error('serial port not readable')
    this.writer = port.writable.getWriter()
    const reader = port.readable.getReader()
    this.reader = reader
    this.reading = this.readLoop(reader)
  }

  /** DTR and RTS low, retried; a port that won't take it is closed rather than left
   *  keying the radio (throws). */
  private async unkey(port: SerialPort): Promise<void> {
    for (let i = 0; ; i++) {
      try {
        await port.setSignals({ dataTerminalReady: false, requestToSend: false })
        return
      } catch (e) {
        if (i >= 2) {
          await port.close().catch(() => {})
          this.opened = false
          throw e
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    }
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) this.received(value)
      }
    } catch {
      // The port went away (or our cancel).
    } finally {
      reader.releaseLock()
    }
    if (this.reader === reader) void this.gone() // not closed by us
  }

  private received(bytes: Uint8Array): void {
    for (const f of this.frames.push(bytes)) {
      // Our own echo (one-wire bus), or a frame for another controller.
      if (f.kind !== 'civ' || f.from === CTRL_ADDR || (f.to !== CTRL_ADDR && f.to !== 0x00)) continue
      this.lastRx = Date.now()
      this.heard?.(f.from)
    }
    if (this.state === 'on') this.dataCb(bytes)
  }

  private raw(bytes: Uint8Array): void {
    const w = this.writer
    if (!w) return
    this.writing = this.writing.then(() => w.write(bytes)).catch(() => {})
  }

  /** On the air: a quiet radio is asked for its frequency; one that stays quiet is gone
   *  (switched off behind a CT-17) and looked for again. */
  private startWatchdog(run: number): void {
    this.stopWatchdog()
    this.watchdog = setInterval(() => {
      if (run !== this.run || this.state !== 'on') return this.stopWatchdog()
      const idle = Date.now() - this.lastRx
      if (idle > this.ms.lost) {
        this.stopWatchdog()
        this.set('connecting')
        void this.find(run)
      } else if (idle > this.ms.ping && this.addr !== undefined) this.raw(addressed(readFreq(), this.addr))
    }, this.ms.ping / 2)
  }

  private stopWatchdog(): void {
    if (this.watchdog !== undefined) clearInterval(this.watchdog)
    this.watchdog = undefined
  }

  /** The port went away (cable out, radio off): off, and back by itself when it returns. */
  private async gone(): Promise<void> {
    this.run++
    await this.closePort()
    this.port = undefined
    this.set('off')
  }

  /** Close the port (`all`: also stop the watchdog and the probe's wait). */
  private async closePort(all = true): Promise<void> {
    const r = this.reader
    const w = this.writer
    this.reader = undefined
    this.writer = undefined
    if (all) {
      this.stopWatchdog()
      this.heard = undefined
    }
    if (r) {
      await r.cancel().catch(() => {})
      await this.reading
    }
    if (w) {
      await this.writing
      w.releaseLock()
    }
    if (this.opened) {
      this.opened = false
      await this.port?.close().catch(() => {})
    }
    this.frames.reset()
    this.baud = undefined
  }

  private async load(): Promise<SerialFound | undefined> {
    try {
      const v = JSON.parse((await this.store.get(SERIAL_SETTING)) || 'null') as Partial<SerialFound> | null
      return v && typeof v.baud === 'number' && typeof v.addr === 'number' ? (v as SerialFound) : undefined
    } catch {
      return undefined
    }
  }

  private set(s: KeyerLinkState): void {
    if (s === this.state) return
    this.state = s
    this.stateCb(s)
  }
}

function sameDevice(p: SerialPort, saved: SerialFound | undefined): boolean {
  if (saved?.vid === undefined) return false
  const i = p.getInfo()
  return i.usbVendorId === saved.vid && i.usbProductId === saved.pid
}

function unique(xs: readonly (number | undefined)[]): number[] {
  return [...new Set(xs.filter((x): x is number => x !== undefined))]
}
