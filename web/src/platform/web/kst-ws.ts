// TCP for the ON4KST chat on the web: a browser cannot open TCP, so it goes through the
// kQSO relay (relay/kst, WebSocket → www.on4kst.org:23001). The relay knows the target;
// connect()'s host and port are ignored. Bytes move unchanged as binary frames, read
// as a UTF-8 stream (a character may be split between frames).

import type { TcpLinkState, TcpTransport } from '../types'

/** The relay's address: VITE_KST_RELAY_URL in the build; the local relay in dev on the
 *  dev server's host, so a phone on the LAN reaches it too (relay/kst: DEV=1 node
 *  server.mjs); '' = no chat on the web. */
export function kstRelayUrl(): string {
  return import.meta.env.VITE_KST_RELAY_URL || (import.meta.env.DEV ? `ws://${location.hostname}:8787/kst` : '')
}

export class WsTcpTransport implements TcpTransport {
  private ws: WebSocket | undefined
  private decoder = new TextDecoder('utf-8')
  private readonly encoder = new TextEncoder()
  private dataCb: (text: string) => void = () => {}
  private stateCb: (s: TcpLinkState, reason?: string) => void = () => {}

  constructor(
    private readonly url: string,
    private readonly open: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {}

  onData(cb: (text: string) => void): void {
    this.dataCb = cb
  }

  onState(cb: (s: TcpLinkState, reason?: string) => void): void {
    this.stateCb = cb
  }

  connect(_host: string, _port: number): void {
    this.drop()
    this.decoder = new TextDecoder('utf-8')
    const ws = this.open(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.stateCb('connecting')
    // Events of a socket that was replaced or closed by us are ignored.
    ws.onopen = () => {
      if (this.ws === ws) this.stateCb('on')
    }
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws) return
      const text = typeof e.data === 'string' ? e.data : this.decoder.decode(e.data as ArrayBuffer, { stream: true })
      if (text) this.dataCb(text)
    }
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return
      this.ws = undefined
      const rest = this.decoder.decode()
      if (rest) this.dataCb(rest)
      this.stateCb('off', closeReason(e))
    }
  }

  close(): void {
    if (this.drop()) this.stateCb('off')
  }

  write(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(this.encoder.encode(text))
  }

  /** Forgets the socket and closes it; true when there was one. */
  private drop(): boolean {
    const ws = this.ws
    if (!ws) return false
    this.ws = undefined
    ws.close(1000)
    return true
  }
}

/** The relay closes with its reason ("tcp closed", "idle", "no pong"); a refused
 *  handshake (origin, too many connections) reaches the page only as code 1006. */
function closeReason(e: CloseEvent): string | undefined {
  return e.reason || (e.code === 1000 ? undefined : `code ${e.code}`)
}
