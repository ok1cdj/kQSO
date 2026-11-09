// CQ repeat (A3 ⏎, then F5): KeyerController against a keyer that answers SEND with OK
// and says DONE / STOPPED when the test wants. UI code, globals stubbed for Node.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { MemoryPlatform } from '../../src/platform/memory'
import type { KQSOPlatform, KeyerLinkState, KeyerTransport } from '../../src/platform/index'

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = globalThis
  g.document = { hidden: false, addEventListener: () => {} }
})

afterEach(() => {
  vi.useRealTimers()
})

class FakeKeyer implements KeyerTransport {
  readonly mtu = 200
  sends: string[] = []
  private buf = ''
  private dataCb: (t: string) => void = () => {}
  private stateCb: (s: KeyerLinkState, n?: string) => void = () => {}

  async connect(): Promise<boolean> {
    setTimeout(() => this.stateCb('on', 'keyer'), 0)
    return true
  }
  async disconnect(): Promise<void> {
    this.stateCb('off', 'keyer')
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
      if (line.startsWith('SEND ')) this.sends.push(line.slice(5))
      this.say(line.startsWith('VER') ? 'VER keyer 2.1.0 proto 1' : 'OK')
    }
  }
  say(line: string): void {
    setTimeout(() => this.dataCb(`${line}\n`), 0)
  }
}

async function setup() {
  vi.useFakeTimers()
  const { RigController } = await import('../../src/ui/rig')
  const { KeyerController } = await import('../../src/ui/keyer')
  const tr = new FakeKeyer()
  const platform: KQSOPlatform = Object.assign(new MemoryPlatform(), { keyer: tr }) as KQSOPlatform
  await platform.setSetting('keyerEnabled', '1')
  const keyer = new KeyerController(platform, new RigController(platform))
  await keyer.init()
  await vi.advanceTimersByTimeAsync(10)
  return { keyer, tr, platform }
}

describe('CQ repeat', () => {
  it('A3 then the CQ: again 3 s after each CQ ends, until STOP', async () => {
    const { keyer, tr, platform } = await setup()
    await keyer.setRepeatGap(3)
    expect(await platform.getSetting('keyerRepeat')).toBe('3')
    keyer.startRepeat(() => 'CQ OK1CDJ')
    await vi.advanceTimersByTimeAsync(10)
    expect(tr.sends).toEqual(['CQ OK1CDJ'])
    expect(keyer.repeating).toBe(true)
    tr.say('DONE')
    await vi.advanceTimersByTimeAsync(2900)
    expect(tr.sends).toHaveLength(1) // the gap counts from the end of the CQ
    await vi.advanceTimersByTimeAsync(200)
    expect(tr.sends).toEqual(['CQ OK1CDJ', 'CQ OK1CDJ'])
    const stopped = keyer.stop() // its OK comes on a (fake) timer
    await vi.advanceTimersByTimeAsync(10)
    await stopped
    tr.say('DONE')
    await vi.advanceTimersByTimeAsync(5000)
    expect(tr.sends).toHaveLength(2)
    expect(keyer.repeating).toBe(false)
  })

  it('another send ends it, in the gap too', async () => {
    const { keyer, tr } = await setup()
    await keyer.setRepeatGap(3)
    keyer.startRepeat(() => 'CQ')
    await vi.advanceTimersByTimeAsync(10)
    tr.say('DONE')
    await vi.advanceTimersByTimeAsync(1000)
    const sent = keyer.send('OK1ABC 599001')
    await vi.advanceTimersByTimeAsync(10)
    await sent
    tr.say('DONE')
    await vi.advanceTimersByTimeAsync(5000)
    expect(tr.sends).toEqual(['CQ', 'OK1ABC 599001'])
    expect(keyer.repeating).toBe(false)
  })

  it('STOPPED from the keyer, A0 or an empty CQ (the log left CW) end it', async () => {
    const { keyer, tr } = await setup()
    await keyer.setRepeatGap(2)
    keyer.startRepeat(() => 'CQ')
    await vi.advanceTimersByTimeAsync(10)
    tr.say('STOPPED')
    await vi.advanceTimersByTimeAsync(10)
    expect(keyer.repeating).toBe(false)

    keyer.startRepeat(() => 'CQ')
    await vi.advanceTimersByTimeAsync(10)
    await keyer.setRepeatGap(0)
    expect(keyer.repeating).toBe(false)
    tr.say('DONE')
    await vi.advanceTimersByTimeAsync(3000)
    expect(tr.sends).toEqual(['CQ', 'CQ']) // off: no next round

    await keyer.setRepeatGap(2)
    let cw = true
    keyer.startRepeat(() => (cw ? 'CQ' : ''))
    await vi.advanceTimersByTimeAsync(10)
    cw = false
    tr.say('DONE')
    await vi.advanceTimersByTimeAsync(3000)
    expect(keyer.repeating).toBe(false)
    expect(tr.sends).toEqual(['CQ', 'CQ', 'CQ'])
  })

  it('a CQ with nothing to key ends it at once (no DONE would come)', async () => {
    const { keyer, tr } = await setup()
    await keyer.setRepeatGap(3)
    keyer.startRepeat(() => 'ČŘ')
    await vi.advanceTimersByTimeAsync(10)
    expect(tr.sends).toEqual([])
    expect(keyer.repeating).toBe(false)
  })
})
