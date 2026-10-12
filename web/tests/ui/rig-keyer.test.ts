// A radio via the keyer's CI-V tunnel, end to end: KeyerController + KeyerCivTransport +
// RigController against a simulated keyer (PROTOCOL.md, firmware 2.1.0) with a radio on
// its bus. UI code, so DOM types (tsconfig.browser.json); the few globals it touches are
// stubbed for Node.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { MemoryPlatform } from '../../src/platform/memory'
import type { KQSOPlatform, KeyerLinkState, KeyerTransport } from '../../src/platform/index'
import { decodeFreq, encodeFreq, fromHex, toHex } from '../../src/core/civ'

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = globalThis
  g.document = { hidden: false, addEventListener: () => {} }
})

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await tick()
}

interface Radio {
  addr: number
  hz: number
  mode: number
  /** Accepts a frequency (else FA). */
  tunes(hz: number): boolean
  bandStack: boolean
  cw: boolean
}

/** The keyer: answers protocol lines, keeps a radio on its CI-V bus. */
class FakeKeyer implements KeyerTransport {
  readonly mtu = 20
  version = '2.1.0'
  radio: Radio | undefined
  sent: string[] = [] // CIVTX frames, hex
  private buf = ''
  private dataCb: (t: string) => void = () => {}
  private stateCb: (s: KeyerLinkState, n?: string) => void = () => {}
  private freqOn = false
  private civOn = false
  link: KeyerLinkState = 'off'

  async connect(): Promise<boolean> {
    if (this.link !== 'off') return true
    this.link = 'connecting'
    this.stateCb('connecting', 'keyer-AB12')
    setTimeout(() => {
      this.link = 'on'
      this.stateCb('on', 'keyer-AB12')
    }, 1)
    return true
  }
  async disconnect(): Promise<void> {
    this.link = 'off'
    this.freqOn = this.civOn = false
    this.stateCb('off', 'keyer-AB12')
  }
  async forget(): Promise<void> {}
  onData(cb: (t: string) => void): void {
    this.dataCb = cb
  }
  onState(cb: (s: KeyerLinkState, n?: string) => void): void {
    this.stateCb = cb
  }
  onBattery(): void {}

  write(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      this.line(line)
    }
  }

  private say(line: string): void {
    setTimeout(() => this.dataCb(`${line}\n`), 0)
  }

  private freqLine(): string {
    return this.radio ? `FREQ ${this.radio.hz} CW` : 'FREQ NONE'
  }

  /** The radio on the bus is pulled / plugged. */
  plug(radio: Radio | undefined): void {
    this.radio = radio
    if (this.freqOn) this.say(this.freqLine())
  }

  private line(l: string): void {
    const [cmd, arg] = [l.split(' ')[0], l.slice(l.indexOf(' ') + 1)]
    switch (cmd) {
      case 'VER':
        return this.say(`VER keyer ${this.version} proto 1`)
      case 'WPM':
      case 'SEND':
      case 'STOP':
        return this.say('OK')
      case 'CIVRX':
        this.civOn = arg === 'ON'
        return this.say('OK')
      case 'FREQ':
        this.freqOn = arg === 'ON'
        this.say('OK')
        if (this.freqOn) this.say(this.freqLine())
        return
      case 'CIV':
        return this.say(this.radio ? `CIV AUTO 19200 ${this.radio.addr.toString(16).toUpperCase()}` : 'CIV AUTO - -')
      case 'CIVTX': {
        if (!this.radio) return this.say('ERR norig')
        this.say('OK')
        this.sent.push(arg.toLowerCase())
        this.bus(fromHex(arg)!)
        return
      }
      default:
        return this.say('ERR cmd')
    }
  }

  /** The radio answers a frame (to E0, from its address). */
  private bus(f: Uint8Array): void {
    const r = this.radio!
    const reply = (...data: number[]): void => {
      if (this.civOn) this.say(`CIVRX ${toHex(Uint8Array.from([0xfe, 0xfe, 0xe0, r.addr, ...data, 0xfd])).toUpperCase()}`)
    }
    const cmd = f[4]!
    const data = Array.from(f.slice(5, -1))
    if (cmd === 0x03) return reply(0x03, ...encodeFreq(r.hz))
    if (cmd === 0x04) return reply(0x04, r.mode, 0x01)
    if (cmd === 0x05) {
      const hz = decodeFreq(Uint8Array.from(data))
      if (!r.tunes(hz)) return reply(0xfa)
      r.hz = hz
      return reply(0xfb)
    }
    if (cmd === 0x06) {
      r.mode = data[0]!
      return reply(0xfb)
    }
    if (cmd === 0x1a && data[0] === 0x01 && !r.bandStack) return reply(0xfa)
    if ((cmd === 0x17 || cmd === 0x14 || cmd === 0x1c) && !r.cw) return reply(0xfa)
    if (cmd === 0x1c) return reply(0x1c, 0x00, 0x00)
    return reply(0xfb)
  }
}

const ic706mk2 = (): Radio => ({
  addr: 0x4e,
  hz: 14_074_000,
  mode: 0x01,
  tunes: (hz) => hz < 200_000_000,
  bandStack: false,
  cw: false,
})

async function setup(radio: Radio | undefined = ic706mk2(), version = '2.1.0') {
  const { RigController } = await import('../../src/ui/rig')
  const { KeyerController } = await import('../../src/ui/keyer')
  const keyerTr = new FakeKeyer()
  keyerTr.version = version
  keyerTr.radio = radio
  const mem = new MemoryPlatform()
  const platform: KQSOPlatform = Object.assign(mem, { keyer: keyerTr }) as KQSOPlatform
  await platform.setSetting('rigEnabled', '1')
  const rig = new RigController(platform)
  const keyer = new KeyerController(platform, rig)
  rig.attachKeyer(keyer.civLink)
  await keyer.init()
  await rig.init()
  await tick(5)
  await settle()
  return { rig, keyer, keyerTr, platform }
}

describe('radio via the keyer', () => {
  afterEach(() => {})

  it('comes up without CW keying: model by address, frequency and mode from the radio', async () => {
    const { rig, keyer } = await setup()
    expect(keyer.enabled).toBe(false) // CW keying off, the link is the radio's
    expect(rig.source).toBe('keyer')
    expect(rig.link).toBe('on')
    expect(rig.controls).toBe(true)
    expect(rig.model.label).toBe('IC-706MkII')
    expect(rig.label).toBe('706')
    expect(rig.freqHz).toBe(14_074_000)
    expect(rig.mode).toBe('SSB')
  })

  it('tunes a band the radio has: no band stack (FA) → the usual spot', async () => {
    const { rig, keyerTr } = await setup()
    await rig.tune('40m', 'CW')
    await settle()
    expect(keyerTr.radio!.hz).toBe(7_020_000)
    expect(keyerTr.radio!.mode).toBe(0x03)
    expect(rig.detached).toBe(false)
  })

  it('a band the radio lacks: nothing sent, the log keeps the band, the radio stays connected', async () => {
    const { rig, keyerTr } = await setup()
    keyerTr.sent = []
    await rig.tune('70cm', undefined) // the MkII has no 70 cm
    await settle()
    expect(keyerTr.sent.some((f) => f.slice(8, 10) === '05')).toBe(false)
    expect(rig.detached).toBe(true)
    expect(rig.link).toBe('on')
    expect(keyerTr.radio!.hz).toBe(14_074_000)
    // Back on a radio band: the radio follows again.
    await rig.tune('20m', undefined)
    await settle()
    expect(rig.detached).toBe(false)
  })

  it('a band the radio refuses (FA): the log keeps it, no error, the radio stays', async () => {
    const radio = { ...ic706mk2(), addr: 0x4d, tunes: (hz: number) => hz < 30_000_000 } // unknown address: generic
    const { rig } = await setup(radio)
    expect(rig.model.id).toBe('generic')
    await rig.tune('2m', undefined)
    await settle()
    expect(rig.detached).toBe(true)
    expect(rig.notice).toBeUndefined()
    expect(radio.hz).toBe(14_074_000)
  })

  it('a chosen model overrides the address (an IC-706MkII moved to 4D)', async () => {
    const { rig } = await setup({ ...ic706mk2(), addr: 0x4d })
    await rig.setModel('ic706mk2')
    expect(rig.model.label).toBe('IC-706MkII')
    expect(rig.cwViaCiv).toBe(false) // CW by the keyer's wire
    expect(rig.voice).toBe(false)
  })

  it('radio pulled from the bus: connecting; plugged back: on again', async () => {
    const { rig, keyerTr } = await setup()
    keyerTr.plug(undefined)
    await settle()
    expect(rig.link).toBe('connecting')
    expect(rig.controls).toBe(false)
    keyerTr.plug(ic706mk2())
    await settle()
    expect(rig.link).toBe('on')
    expect(rig.controls).toBe(true)
  })

  it('old keyer firmware: says so, never sends CIV lines', async () => {
    const { rig, keyerTr } = await setup(ic706mk2(), '2.0.2')
    expect(rig.oldFirmware).toBe(true)
    expect(rig.controls).toBe(false)
    expect(keyerTr.sent).toEqual([])
  })

  it('an IC-7300: CW and voice memories through the radio', async () => {
    const r7300: Radio = { addr: 0x94, hz: 7_030_000, mode: 0x03, tunes: (hz) => hz < 75_000_000, bandStack: false, cw: true }
    const { rig, keyer } = await setup(r7300)
    expect(rig.model.label).toBe('IC-7300')
    expect(rig.cwViaCiv).toBe(true)
    expect(rig.voice).toBe(true)
    expect(keyer.viaRig).toBe(true)
    expect(keyer.activeFor('CW')).toBe(true)
  })

  it('switching CW keying off keeps the link while the radio uses it', async () => {
    const { rig, keyer } = await setup()
    await keyer.setEnabled(true)
    await keyer.setEnabled(false)
    await settle()
    expect(keyer.link).toBe('on')
    expect(rig.controls).toBe(true)
    await rig.setEnabled(false)
    await settle()
    expect(keyer.link).toBe('off')
  })

  it('the log on a band the radio lacks: the keyer\'s wire does not key it', async () => {
    const { rig, keyer, keyerTr } = await setup()
    await keyer.setEnabled(true)
    await settle()
    expect(keyer.activeFor('CW')).toBe(true)
    await rig.tune('70cm', undefined) // the MkII has no 70 cm
    await settle()
    expect(keyer.wireBlocked).toBe(true)
    expect(keyer.activeFor('CW')).toBe(false)
    const lines: string[] = []
    const write = keyerTr.write.bind(keyerTr)
    keyerTr.write = (c: string) => {
      lines.push(c)
      write(c)
    }
    await keyer.send('CQ TEST')
    expect(lines.join('')).not.toContain('SEND')
    await rig.tune('20m', undefined)
    await settle()
    expect(keyer.activeFor('CW')).toBe(true)
  })
})
