// The ON4KST chat controller over a fake TCP link and fake timers: login, a refused
// login, messages to me, rooms, the "Please wait" lock, the silence watch and the
// reconnect after a drop.
import { describe, it, expect } from 'vitest'
import { KstController } from '../../src/ui/kst'
import type { KQSOPlatform, TcpLinkState, TcpTransport } from '../../src/platform/index'
import type { Timers } from '../../src/core/index'

class FakeTcp implements TcpTransport {
  written: string[] = []
  connects = 0
  closes = 0
  private data: (t: string) => void = () => {}
  private state: (s: TcpLinkState, r?: string) => void = () => {}
  connect(): void {
    this.connects++
    this.state('connecting')
  }
  close(): void {
    this.closes++
    this.state('off')
  }
  write(t: string): void {
    this.written.push(t)
  }
  onData(cb: (t: string) => void): void {
    this.data = cb
  }
  onState(cb: (s: TcpLinkState, r?: string) => void): void {
    this.state = cb
  }
  // test side
  up(): void {
    this.state('on')
  }
  down(reason?: string): void {
    this.state('off', reason)
  }
  recv(t: string): void {
    this.data(t)
  }
}

class FakeTimers implements Timers {
  t = 0
  private next = 1
  private readonly due = new Map<number, { at: number; fn: () => void }>()
  set(fn: () => void, ms: number): unknown {
    const id = this.next++
    this.due.set(id, { at: this.t + ms, fn })
    return id
  }
  clear(id: unknown): void {
    this.due.delete(id as number)
  }
  advance(ms: number): void {
    const end = this.t + ms
    for (;;) {
      const first = [...this.due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!first) break
      this.due.delete(first[0])
      this.t = first[1].at
      first[1].fn()
    }
    this.t = end
  }
}

function setup(settings: Record<string, string> = { kstCall: 'ok1cdj', kstPass: 'pw' }) {
  const tcp = new FakeTcp()
  const timers = new FakeTimers()
  const platform = { tcp, getSetting: async (k: string) => settings[k] ?? null } as unknown as KQSOPlatform
  const kst = new KstController(platform, 'kQSO test', timers, () => timers.t)
  let changes = 0
  kst.subscribe(() => changes++)
  return { kst, tcp, timers, changes: () => changes }
}

const LOGIN_OK = 'Java login 20040703a\r\nLOGSTAT|100|2|x|h|0|name|sur|JN79US|mail|\r\n'

async function online() {
  const s = setup()
  await s.kst.connect()
  s.tcp.up()
  s.tcp.recv(LOGIN_OK)
  return s
}

describe('KstController', () => {
  it('logs in with the saved account', async () => {
    const { kst, tcp } = setup()
    await kst.connect()
    expect(kst.link).toBe('connecting')
    tcp.up()
    expect(kst.link).toBe('login')
    tcp.recv(LOGIN_OK)
    expect(kst.link).toBe('on')
    expect(kst.locator).toBe('JN79US')
    expect(tcp.written).toEqual(['LOGINC|OK1CDJ|pw|2|kQSO test|25|0|1|0|0|\r', 'SDONE|2|\r'])
  })

  it('falls back to the log call; no password = failed without connecting', async () => {
    const a = setup({ kstPass: 'pw' })
    await a.kst.connect('ok2xx')
    a.tcp.up()
    a.tcp.recv('login\r\n')
    expect(a.tcp.written[0]).toMatch(/^LOGINC\|OK2XX\|/)
    const b = setup({ kstCall: 'OK1CDJ' })
    await b.kst.connect()
    expect(b.kst.link).toBe('failed')
    expect(b.kst.reason).toBe('account')
    expect(b.tcp.connects).toBe(0)
  })

  it('a refused login stays failed, no retry', async () => {
    const { kst, tcp, timers } = setup()
    await kst.connect()
    tcp.up()
    tcp.recv('login\r\nLOGSTAT|114|Wrong password|\r\n')
    expect(kst.link).toBe('failed')
    expect(kst.reason).toBe('Wrong password')
    expect(tcp.closes).toBe(1)
    timers.advance(120_000)
    expect(tcp.connects).toBe(1)
  })

  it('counts messages to me, not the history', async () => {
    const { kst, tcp } = await online()
    tcp.recv('CR|2|10|OK1KPA|Petr|0| old|OK1CDJ|\r\nCE|2|\r\nUE|2|1|\r\n')
    expect(kst.unread).toBe(0)
    tcp.recv('CH|2|11|SV0SYH|Ondrej|0|hi|OK1CDJ|\r\nCH|2|12|DL1ABC|Hans|0|cq|0|\r\n')
    expect(kst.unread).toBe(1)
    expect(kst.lastForMe).toMatchObject({ call: 'SV0SYH', text: 'hi' })
    expect(kst.chat.messages.length).toBe(3)
    kst.markRead()
    expect(kst.unread).toBe(0)
    expect(kst.lastForMe?.call).toBe('SV0SYH')
  })

  it('after a drop, messages to me in the history that were missed count', async () => {
    const { kst, tcp, timers } = await online()
    tcp.recv('CH|2|100|DL1ABC|Hans|0|cq|0|\r\n')
    tcp.down('tcp closed')
    timers.advance(2_000)
    tcp.up()
    tcp.recv(LOGIN_OK + 'CR|2|101|SV0SYH|Ondrej|0|missed|OK1CDJ|\r\nCR|2|90|OK1KPA|Petr|0|old|OK1CDJ|\r\nCE|2|\r\n')
    expect(kst.unread).toBe(1)
    expect(kst.lastForMe?.text).toBe('missed')
  })

  it('sends, and not while the server says wait', async () => {
    const { kst, tcp, timers } = await online()
    tcp.written.length = 0
    expect(kst.send('@sv0syh GM')).toBe(true)
    tcp.recv('CH|2|20|SERVER|Server|0|Please wait 30 second(s)|OK1CDJ|\r\n')
    expect(kst.send('again')).toBe(false)
    timers.advance(30_000)
    expect(kst.send('again')).toBe(true)
    expect(tcp.written).toEqual(['MSG|2|0|/CQ SV0SYH GM|0|\r', 'MSG|2|0|again|0|\r'])
  })

  it('another room reconnects and keeps each room\'s messages', async () => {
    const { kst, tcp } = await online()
    tcp.recv('CH|2|30|DL1ABC|Hans|0|cq 2m|0|\r\n')
    kst.setRoom(3)
    expect(tcp.connects).toBe(2)
    expect(kst.chat.messages.length).toBe(0)
    tcp.up()
    tcp.recv('login\r\n')
    expect(tcp.written.at(-1)).toBe('LOGINC|OK1CDJ|pw|3|kQSO test|25|0|1|0|0|\r')
    kst.setRoom(2)
    expect(kst.chat.messages.map((m) => m.text)).toEqual(['cq 2m'])
    tcp.up()
    tcp.recv('login\r\n')
    expect(tcp.written.at(-1)).toBe('LOGINC|OK1CDJ|pw|2|kQSO test|25|0|1|29|0|\r')
  })

  it('silence: a ping after 90 s, a new connection after 210 s', async () => {
    const { tcp, timers } = await online()
    tcp.written.length = 0
    timers.advance(60_000)
    tcp.recv('CK|\r\n')
    timers.advance(89_000)
    expect(tcp.written).toEqual(['\r\n'])
    timers.advance(1_000)
    expect(tcp.written.at(-1)).toBe('CK|\r')
    expect(tcp.connects).toBe(1)
    timers.advance(120_000)
    expect(tcp.connects).toBe(2)
  })

  it('a drop reconnects with a growing delay; disconnect stops it', async () => {
    const { kst, tcp, timers } = await online()
    tcp.down('tcp closed')
    expect(kst.link).toBe('off')
    expect(kst.reason).toBe('tcp closed')
    timers.advance(2_000)
    expect(tcp.connects).toBe(2)
    tcp.down('code 1006')
    timers.advance(4_999)
    expect(tcp.connects).toBe(2)
    timers.advance(1)
    expect(tcp.connects).toBe(3)
    tcp.up()
    tcp.recv(LOGIN_OK)
    expect(kst.link).toBe('on')
    kst.disconnect()
    expect(tcp.written.at(-1)).toBe('/QUIT\r')
    expect(kst.link).toBe('off')
    timers.advance(300_000)
    expect(tcp.connects).toBe(3)
  })

  it('without tcp it is not available and does nothing', async () => {
    const kst = new KstController({ getSetting: async () => null } as unknown as KQSOPlatform, 'x', new FakeTimers())
    expect(kst.available).toBe(false)
    await kst.connect('OK1CDJ')
    expect(kst.link).toBe('off')
  })
})
