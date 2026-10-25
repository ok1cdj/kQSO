// The web TCP link for the ON4KST chat: a WebSocket to the relay. States, the UTF-8
// stream (a character split between frames), writes only while open, and events of a
// replaced socket ignored.
import { describe, it, expect, beforeAll } from 'vitest'
import { WsTcpTransport } from '../../src/platform/web/kst-ws'
import type { TcpLinkState } from '../../src/platform/types'

class FakeSocket {
  static readonly OPEN = 1
  readyState = 0
  binaryType = ''
  sent: Uint8Array[] = []
  closed: number | undefined
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  constructor(readonly url: string) {}
  send(b: Uint8Array): void {
    this.sent.push(b)
  }
  close(code: number): void {
    this.closed = code
    this.readyState = 3
  }
  // test side
  opened(): void {
    this.readyState = 1
    this.onopen?.()
  }
  data(b: number[] | string): void {
    this.onmessage?.({ data: typeof b === 'string' ? b : new Uint8Array(b).buffer })
  }
  serverClose(code: number, reason = ''): void {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
}

beforeAll(() => {
  // Node has no WebSocket global in every version; only the OPEN constant is read.
  ;(globalThis as { WebSocket?: unknown }).WebSocket ??= FakeSocket
})

function setup() {
  const sockets: FakeSocket[] = []
  const t = new WsTcpTransport('ws://relay/kst', (u) => {
    const s = new FakeSocket(u)
    sockets.push(s)
    return s as unknown as WebSocket
  })
  const states: [TcpLinkState, string | undefined][] = []
  let text = ''
  t.onState((s, r) => states.push([s, r]))
  t.onData((d) => (text += d))
  return { t, sockets, states, read: () => text }
}

describe('WsTcpTransport', () => {
  it('connects, reads UTF-8 split between frames, writes while open', () => {
    const { t, sockets, states, read } = setup()
    t.connect('www.on4kst.org', 23001)
    const s = sockets[0]!
    expect(s.url).toBe('ws://relay/kst')
    expect(s.binaryType).toBe('arraybuffer')
    t.write('lost')
    expect(s.sent).toEqual([])
    s.opened()
    expect(states).toEqual([['connecting', undefined], ['on', undefined]])
    // "René" with é = C3 A9 split
    s.data([0x52, 0x65, 0x6e, 0xc3])
    s.data([0xa9, 0x0d, 0x0a])
    expect(read()).toBe('René\r\n')
    t.write('MSG|2|0|hi|0|\r')
    expect(new TextDecoder().decode(s.sent[0])).toBe('MSG|2|0|hi|0|\r')
  })

  it('reports the relay closing with its reason', () => {
    const { t, sockets, states } = setup()
    t.connect('', 0)
    sockets[0]!.opened()
    sockets[0]!.serverClose(1000, 'tcp closed')
    expect(states.at(-1)).toEqual(['off', 'tcp closed'])
    t.connect('', 0)
    sockets[1]!.serverClose(1006)
    expect(states.at(-1)).toEqual(['off', 'code 1006'])
  })

  it('close() and reconnect ignore the old socket', () => {
    const { t, sockets, states, read } = setup()
    t.connect('', 0)
    sockets[0]!.opened()
    t.connect('', 0)
    expect(sockets[0]!.closed).toBe(1000)
    sockets[0]!.data('old')
    sockets[0]!.serverClose(1000, 'ws closed')
    expect(read()).toBe('')
    expect(states.map((s) => s[0])).toEqual(['connecting', 'on', 'connecting'])
    // Closing on purpose is quiet: a late 'off' would land on the next connection.
    t.close()
    expect(sockets[1]!.closed).toBe(1000)
    t.close()
    expect(states.map((s) => s[0])).toEqual(['connecting', 'on', 'connecting'])
  })
})
