// The radio on a serial port (Web Serial): WebSerialRig against a simulated port with a
// radio behind it, and RigController on top. UI code, so DOM types (tsconfig.browser.json).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { SERIAL_SETTING, WebSerialRig, addressed } from '../../src/platform/web/serial'
import type { SerialStore, SerialTiming } from '../../src/platform/web/serial'
import { civFrame, readFreq, setMode } from '../../src/core/civ'
import { MemoryPlatform } from '../../src/platform/memory'
import type { KQSOPlatform, KeyerLinkState } from '../../src/platform/index'

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = globalThis
  g.document = { hidden: false, addEventListener: () => {} }
})

const FAST: SerialTiming = { listen: 5, ask: 5, ping: 20, lost: 60, retry: 10 }

/** A radio on a serial port: answers readFreq at its address and rate; a one-wire bus
 *  (CT-17) echoes every byte written. */
class FakePort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  opens: number[] = []
  signals: SerialOutputSignals[] = []
  written: Uint8Array[] = []
  isOpen = false
  answering = true
  /** setSignals fails (a port that won't take DTR / RTS low). */
  noSignals = false
  private ctrl: ReadableStreamDefaultController<Uint8Array> | undefined
  private baud = 0

  constructor(
    private readonly radio: { baud: number; addr: number } | undefined,
    private readonly echo = false,
  ) {
    super()
  }

  async open(o: SerialOptions): Promise<void> {
    if (this.isOpen) throw new Error('already open')
    this.isOpen = true
    this.baud = o.baudRate
    this.opens.push(o.baudRate)
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.ctrl = c) })
    this.writable = new WritableStream<Uint8Array>({ write: (b) => this.onWrite(b) })
  }

  async close(): Promise<void> {
    this.isOpen = false
  }

  async setSignals(s: SerialOutputSignals): Promise<void> {
    if (this.noSignals) throw new Error('setSignals failed')
    this.signals.push(s)
  }

  getInfo(): SerialPortInfo {
    return { usbVendorId: 0x10c4, usbProductId: 0xea60 }
  }

  /** The radio says something by itself (transceive). */
  send(bytes: Uint8Array): void {
    this.ctrl?.enqueue(bytes)
  }

  /** Cable out. */
  pull(): void {
    this.ctrl?.error(new Error('device lost'))
  }

  /** A framing error (bad rate, collision): the port goes on with a new stream. */
  glitch(): void {
    const old = this.ctrl
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.ctrl = c) })
    old?.error(new DOMException('framing', 'FramingError'))
  }

  private onWrite(b: Uint8Array): void {
    this.written.push(b)
    if (this.echo) this.ctrl?.enqueue(b)
    const r = this.radio
    if (!r || !this.answering || this.baud !== r.baud) return
    if (b[2] !== r.addr || b[3] !== 0xe0) return
    if (b[4] === 0x03) this.ctrl?.enqueue(Uint8Array.from([0xfe, 0xfe, 0xe0, r.addr, 0x03, 0x00, 0x00, 0x03, 0x14, 0x00, 0xfd])) // 14.030 MHz
    if (b[4] === 0x04) this.ctrl?.enqueue(Uint8Array.from([0xfe, 0xfe, 0xe0, r.addr, 0x04, 0x03, 0x01, 0xfd])) // CW
  }
}

class FakeSerial extends EventTarget {
  requested = 0
  constructor(public ports: FakePort[]) {
    super()
  }
  async getPorts(): Promise<FakePort[]> {
    return this.ports
  }
  async requestPort(): Promise<FakePort> {
    this.requested++
    return this.ports[0]!
  }
}

class MemStore implements SerialStore {
  m = new Map<string, string>()
  async get(k: string): Promise<string | null> {
    return this.m.get(k) ?? null
  }
  async set(k: string, v: string): Promise<void> {
    this.m.set(k, v)
  }
}

const until = async (f: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms
  while (!f()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 2))
  }
}

function rig(port: FakePort, store = new MemStore()): { tr: WebSerialRig; states: KeyerLinkState[]; data: Uint8Array[]; serial: FakeSerial; store: MemStore } {
  const serial = new FakeSerial([port])
  const tr = new WebSerialRig(serial as unknown as Serial, store, FAST)
  const states: KeyerLinkState[] = []
  const data: Uint8Array[] = []
  tr.onState((s) => states.push(s))
  tr.onData((b) => data.push(b))
  return { tr, states, data, serial, store }
}

describe('addressed', () => {
  it('puts the radio address into byte 2 of a CI-V frame, leaves anything else', () => {
    expect([...addressed(readFreq(), 0x94)]).toEqual([0xfe, 0xfe, 0x94, 0xe0, 0x03, 0xfd])
    expect([...addressed(Uint8Array.from([0xfe, 0xf1, 0x00, 0x61, 0xfd]), 0x94)]).toEqual([0xfe, 0xf1, 0x00, 0x61, 0xfd])
  })
})

describe('WebSerialRig', () => {
  let port: FakePort

  beforeEach(() => {
    port = new FakePort({ baud: 19200, addr: 0x94 })
  })

  it('finds the rate and the address by asking, remembers them, DTR / RTS low', async () => {
    const { tr, states, store, serial } = rig(port)
    expect(await tr.connect(true)).toBe(true)
    expect(serial.requested).toBe(1)
    await until(() => tr.state === 'on')
    expect(tr.addr).toBe(0x94)
    expect(tr.baud).toBe(19200)
    expect(port.opens).toEqual([115200, 19200])
    expect(states).toEqual(['connecting', 'on'])
    expect(port.signals.every((s) => s.dataTerminalReady === false && s.requestToSend === false)).toBe(true)
    expect(JSON.parse(store.m.get(SERIAL_SETTING)!)).toEqual({ baud: 19200, addr: 0x94, vid: 0x10c4, pid: 0xea60, nth: 0 })
    await tr.disconnect()
    expect(port.isOpen).toBe(false)
    expect(tr.state).toBe('off')
  })

  it('starts at the remembered rate and address', async () => {
    const store = new MemStore()
    store.m.set(SERIAL_SETTING, JSON.stringify({ baud: 19200, addr: 0x94 }))
    const { tr } = rig(port, store)
    await tr.connect(false)
    await until(() => tr.state === 'on')
    expect(port.opens).toEqual([19200])
    expect(port.written[0]![2]).toBe(0x94)
    await tr.disconnect()
  })

  it('a radio sending by itself is found without asking', async () => {
    const quiet = new FakePort(undefined)
    const { tr } = rig(quiet)
    await tr.connect(true)
    quiet.send(Uint8Array.from([0xfe, 0xfe, 0x00, 0x88, 0x00, 0x00, 0x00, 0x30, 0x14, 0x00, 0xfd])) // IC-7100 transceive
    await until(() => tr.state === 'on')
    expect(tr.addr).toBe(0x88)
    expect(quiet.written).toEqual([])
    await tr.disconnect()
  })

  it('our own echo on a one-wire bus is no radio', async () => {
    const bus = new FakePort(undefined, true)
    const { tr } = rig(bus)
    await tr.connect(true)
    await new Promise((r) => setTimeout(r, 150))
    expect(tr.state).toBe('connecting')
    await tr.disconnect()

    const ct17 = new FakePort({ baud: 9600, addr: 0x60 }, true)
    const b = rig(ct17)
    await b.tr.connect(true)
    await until(() => b.tr.state === 'on')
    expect(b.tr.addr).toBe(0x60)
    await b.tr.disconnect()
  })

  it('writes go to the radio found; data is passed on once on', async () => {
    const { tr, data } = rig(port)
    tr.write(setMode(0x03)) // not on yet: dropped
    await tr.connect(true)
    await until(() => tr.state === 'on')
    const before = port.written.length
    tr.write(civFrame(0x06, 0x03))
    await until(() => port.written.length > before)
    expect([...port.written.at(-1)!]).toEqual([0xfe, 0xfe, 0x94, 0xe0, 0x06, 0x03, 0xfd])
    port.send(Uint8Array.from([0xfe, 0xfe, 0x00, 0x94, 0x01, 0x03, 0x01, 0xfd]))
    await until(() => data.length > 0)
    await tr.disconnect()
  })

  it('cable out → off; plugged back → on again by itself', async () => {
    const { tr, serial } = rig(port)
    await tr.connect(true)
    await until(() => tr.state === 'on')
    port.pull()
    await until(() => tr.state === 'off')
    port.isOpen = false
    serial.dispatchEvent(new Event('connect'))
    await until(() => tr.state === 'on')
    await tr.disconnect()
  })

  it('a framing error is no lost port: reading goes on', async () => {
    const { tr, data } = rig(port)
    await tr.connect(true)
    await until(() => tr.state === 'on')
    port.glitch()
    await new Promise((r) => setTimeout(r, 20))
    expect(tr.state).toBe('on')
    port.send(Uint8Array.from([0xfe, 0xfe, 0x00, 0x94, 0x01, 0x03, 0x01, 0xfd]))
    await until(() => data.length > 0)
    await tr.disconnect()
  })

  it('the remembered one of two alike ports (IC-9700); nothing remembered and several ports: no guess', async () => {
    const other = new FakePort(undefined)
    const store = new MemStore()
    store.m.set(SERIAL_SETTING, JSON.stringify({ baud: 19200, addr: 0x94, vid: 0x10c4, pid: 0xea60, nth: 1 }))
    const serial = new FakeSerial([other, port])
    const tr = new WebSerialRig(serial as unknown as Serial, store, FAST)
    await tr.connect(false)
    await until(() => tr.state === 'on')
    expect(other.opens).toEqual([])
    await tr.disconnect()

    const guess = new WebSerialRig(new FakeSerial([other, port]) as unknown as Serial, new MemStore(), FAST)
    expect(await guess.connect(false)).toBe(false)
    expect(other.opens).toEqual([])
  })

  it('a radio switched on after kQSO started comes up by itself', async () => {
    const serial = new FakeSerial([])
    const tr = new WebSerialRig(serial as unknown as Serial, new MemStore(), FAST)
    expect(await tr.connect(false)).toBe(false)
    serial.ports = [port]
    serial.dispatchEvent(new Event('connect'))
    await until(() => tr.state === 'on')
    await tr.disconnect()
  })

  it('a radio that goes quiet is looked for again, and found when it is back', async () => {
    const { tr, states } = rig(port)
    await tr.connect(true)
    await until(() => tr.state === 'on')
    port.answering = false
    await until(() => tr.state === 'connecting')
    port.answering = true
    await until(() => tr.state === 'on')
    expect(states).toEqual(['connecting', 'on', 'connecting', 'on'])
    await tr.disconnect()
  })

  it('DTR / RTS can\'t be set low: the port is closed, not left keying the radio', async () => {
    port.noSignals = true
    const { tr } = rig(port)
    await expect(tr.connect(true)).rejects.toThrow('setSignals failed')
    expect(port.isOpen).toBe(false)
    expect(tr.state).toBe('off')
  })

  it('DTR / RTS low again once the radio answers', async () => {
    const { tr } = rig(port)
    await tr.connect(true)
    await until(() => tr.state === 'on')
    expect(port.signals.length).toBe(port.opens.length + 1)
    await tr.disconnect()
  })

  it('no port granted yet: a quiet connect does nothing', async () => {
    const serial = new FakeSerial([])
    const tr = new WebSerialRig(serial as unknown as Serial, new MemStore(), FAST)
    expect(await tr.connect(false)).toBe(false)
    expect(tr.state).toBe('off')
  })
})

describe('RigController on a serial port', () => {
  async function setup(withIc705: boolean) {
    const { RigController } = await import('../../src/ui/rig')
    const port = new FakePort({ baud: 115200, addr: 0x94 })
    const serialRig = new WebSerialRig(new FakeSerial([port]) as unknown as Serial, new MemStore(), FAST)
    const mem = new MemoryPlatform()
    const extra: Partial<KQSOPlatform> = { serialRig }
    if (withIc705) Object.assign(extra, { rig: { connect: async () => false, disconnect: async () => {}, forget: async () => {}, write: () => {}, mtu: 20, onData: () => {}, onState: () => {} } })
    const platform = Object.assign(mem, extra) as KQSOPlatform
    const rig = new RigController(platform)
    return { rig, port, platform }
  }

  it('the only way to a radio: chosen by itself, no choice shown; comes up with the IC-7300', async () => {
    const { rig, platform } = await setup(false)
    expect(rig.available).toBe(true)
    expect(rig.source).toBe('serial')
    expect(rig.sourceChoice).toBe(false)
    await platform.setSetting('rigEnabled', '1')
    await rig.init()
    await until(() => rig.controls && rig.freqHz !== undefined && rig.mode !== undefined)
    expect(rig.model.label).toBe('IC-7300')
    expect(rig.addr).toBe(0x94)
    expect(rig.baud).toBe(115200)
    expect(rig.freqHz).toBe(14_030_000)
    expect(rig.mode).toBe('CW')
    await rig.setEnabled(false)
    expect(rig.link).toBe('off')
  })

  it('a radio already on via the keyer stays on the keyer (no choice stored before)', async () => {
    const { RigController } = await import('../../src/ui/rig')
    const serialRig = new WebSerialRig(new FakeSerial([]) as unknown as Serial, new MemStore(), FAST)
    const platform = Object.assign(new MemoryPlatform(), { serialRig, keyer: {} }) as unknown as KQSOPlatform
    await platform.setSetting('rigEnabled', '1')
    const rig = new RigController(platform)
    await rig.init()
    expect(rig.source).toBe('keyer')

    const fresh = Object.assign(new MemoryPlatform(), { serialRig, keyer: {} }) as unknown as KQSOPlatform
    const rig2 = new RigController(fresh)
    await rig2.init()
    expect(rig2.source).toBe('serial')
  })

  it('next to the IC-705 Bluetooth: a choice, the stored one wins', async () => {
    const { rig, platform } = await setup(true)
    expect(rig.source).toBe('ic705')
    expect(rig.sourceChoice).toBe(true)
    await platform.setSetting('rigSource', 'serial')
    await rig.init()
    expect(rig.source).toBe('serial')
  })
})
