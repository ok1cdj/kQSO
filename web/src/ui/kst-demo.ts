// ON4KST demo: a simulated chat server behind the TcpTransport interface, used when the
// ON4KST call in Settings is DEMO. ON4KST accounts are for licensed radio amateurs only,
// so this is how App Review (and anyone curious) can try the chat. It speaks the same
// machine-port frames as www.on4kst.org:23001 (core/kst.ts parses them), so the session,
// the controller and the screens run unchanged: login, history, the station list,
// messages now and then (some to me), answers to "@CALL text", a station joining and
// one going away, /SETLOC and /SETNAME. OK1CDJ, OK1RS and OL0M chat (with their
// consent); the quiet stations have made-up …DEM calls.

import type { Timers } from '../core/index'
import type { TcpLinkState, TcpTransport } from '../platform/index'

export const KST_DEMO_CALL = 'DEMO'

interface DemoStation {
  readonly call: string
  readonly name: string
  readonly loc: string
}

const CHATTERS: readonly DemoStation[] = [
  { call: 'OK1CDJ', name: 'Ondra 2/70/23', loc: 'JO60VA' },
  { call: 'OK1RS', name: 'Contest 2/70', loc: 'JO70FD' },
  { call: 'OL0M', name: 'OL0M team 2-70-23-13', loc: 'JN89AE' },
]

const QUIET: readonly DemoStation[] = [
  { call: 'DL0DEM', name: 'Klaus 2m 70cm', loc: 'JO50VF' },
  { call: 'SP9DEM', name: 'Marek 2/70', loc: 'JO90QE' },
  { call: 'OE3DEM', name: 'Franz', loc: 'JN78SB' },
  { call: 'HA5DEM', name: 'Laci 2m', loc: 'JN97LM' },
  { call: 'S51DEM', name: 'Bojan 2/70/23', loc: 'JN76HD' },
  { call: 'OM3DEM', name: 'Juraj', loc: 'JN88NE' },
  { call: 'F6DEM', name: 'Pierre 23cm', loc: 'JN18EU' },
  { call: 'OK2DEM', name: 'Petr /P', loc: 'JN89XX' },
]

/** Joins a while after the login. */
const LATE: DemoStation = { call: 'OK1DEM', name: 'Jirka 2m', loc: 'JO60JP' }
/** Goes away after a while (and the list shows it). */
const AWAY_CALL = 'OM3DEM'

const ME_NAME = 'kQSO demo'
const ME_LOC = 'JN79US'

/** What the chatters say on their own: [from, to or '', text]. */
const CHATTER: readonly (readonly [string, string, string])[] = [
  ['OK1RS', '', 'cq 144.320 cw, qrv 2/70'],
  ['OL0M', 'OK1RS', 'pse sked 432.210 cw?'],
  ['OK1RS', 'OL0M', 'ok 432.210 now'],
  ['OK1CDJ', '', 'qrv 144.290 ssb JN79US'],
  ['OL0M', '', 'cq 1296.150 cw, beam to west'],
  ['OK1CDJ', 'OL0M', 'tnx qso 70cm, 23cm 1296.180?'],
  ['OL0M', 'OK1CDJ', 'rrr 1296.180 cw'],
  ['OK1RS', '', 'qrv 144.320, 70cm on request'],
  ['OK1CDJ', 'OK1RS', 'sri qrl, 10 min'],
]

/** What they write to me, now and then. */
const TO_ME: readonly (readonly [string, string])[] = [
  ['OL0M', 'pse sked 144.290 cw?'],
  ['OK1RS', 'hi, try 432.180 ssb?'],
  ['OK1CDJ', 'qrv 23cm? 1296.200'],
]

/** Their answer to "@CALL text" from me. */
const REPLIES: readonly string[] = ['ok qrv', 'rrr, go', 'sri qrl, 5 min', 'ok, beam to you', 'tnx qso 73']

const LAG_MS = 30
const CHATTER_MS = 15_000 // something new in the room
const TO_ME_EVERY = 3 // every 3rd of those is to me
const REPLY_MS = 4_000
const JOIN_MS = 25_000
const AWAY_MS = 45_000

export class KstDemo implements TcpTransport {
  private dataCb: (text: string) => void = () => {}
  private stateCb: (s: TcpLinkState, reason?: string) => void = () => {}
  private readonly running = new Set<unknown>()
  private live = false
  private room = 2
  private loc = ME_LOC
  private name = ME_NAME
  private ticks = 0
  private lastTs = 0
  private readonly startS: number

  constructor(
    private readonly timers: Timers,
    private readonly now: () => number = Date.now,
  ) {
    this.startS = Math.floor(now() / 1000)
    this.lastTs = this.startS
  }

  onData(cb: (text: string) => void): void {
    this.dataCb = cb
  }

  onState(cb: (s: TcpLinkState, reason?: string) => void): void {
    this.stateCb = cb
  }

  connect(_host: string, _port: number): void {
    this.stop()
    this.live = true
    this.stateCb('connecting')
    this.after(300, () => {
      this.stateCb('on')
      this.send('login: ')
    })
  }

  /** Quiet, as the real transports. */
  close(): void {
    this.stop()
  }

  /** Answers a moment later, as over the network (the session expects that order). */
  write(text: string): void {
    if (!this.live) return
    this.after(LAG_MS, () => {
      for (const line of text.split(/[\r\n]+/)) if (line) this.onLine(line)
    })
  }

  private onLine(line: string): void {
    const f = line.split('|')
    switch (f[0]) {
      case 'LOGINC':
        this.room = Number(f[3]) || 2
        this.send(`LOGSTAT|100|${this.room}|kQSO demo|0|0|${this.name}|Demo|${this.loc}|demo@example.invalid|\r\n`)
        return
      case 'SDONE':
        this.welcome()
        return
      case 'MSG':
        this.onMessage(f[3] ?? '')
        return
      case '/QUIT':
        this.stop()
        this.stateCb('off', 'closed')
    }
  }

  /** History (the same times at every login, so a reconnect adds nothing twice), the
   *  station list, then life in the room. */
  private welcome(): void {
    const t0 = this.startS - 4 * 60
    const history = CHATTER.slice(0, 4).map(([from, to, text], i) => this.frame('CR', t0 + i * 60, from, to, text))
    const list = [...CHATTERS, ...QUIET].map((s) => this.user('UA0', s, s.call === 'F6DEM' ? 1 : 0))
    this.send([...history, `CE|${this.room}|`, ...list, this.user('UA0', { call: KST_DEMO_CALL, name: this.name, loc: this.loc }, 0), `UE|${this.room}|${list.length + 1}|`].join('\r\n') + '\r\n')
    this.every(CHATTER_MS, () => this.chatter())
    this.after(JOIN_MS, () => this.send(this.user('UA5', LATE, 0) + '\r\n'))
    this.after(AWAY_MS, () => this.send(`US4|${this.room}|${AWAY_CALL}|1|\r\n`))
  }

  private chatter(): void {
    this.ticks++
    if (this.ticks % TO_ME_EVERY === 0) {
      const [from, text] = TO_ME[(this.ticks / TO_ME_EVERY - 1) % TO_ME.length]!
      return this.say(from, KST_DEMO_CALL, text)
    }
    const [from, to, text] = CHATTER[(this.ticks + 3) % CHATTER.length]!
    this.say(from, to, text)
  }

  /** What I sent: echoed like the server does; /CQ gets an answer, /SETLOC and /SETNAME apply. */
  private onMessage(text: string): void {
    const cq = /^\/CQ\s+(\S+)\s+(.*)$/i.exec(text)
    if (cq) {
      const to = cq[1]!.toUpperCase()
      this.say(KST_DEMO_CALL, to, ' ' + cq[2]!)
      const station = [...CHATTERS, ...QUIET, LATE].find((s) => s.call === to)
      if (station) this.after(REPLY_MS, () => this.say(station.call, KST_DEMO_CALL, REPLIES[this.ticks++ % REPLIES.length]!))
      return
    }
    const setLoc = /^\/SETLOC\s+([A-R]{2}\d{2}[A-X]{2})$/i.exec(text)
    if (setLoc) {
      this.loc = setLoc[1]!.toUpperCase()
      this.send(`LOC|${this.ts()}|${KST_DEMO_CALL}|${this.loc}|\r\n`)
      return this.say('SERVER', KST_DEMO_CALL, `Your locator is now ${this.loc}`)
    }
    const setName = /^\/SETNAME\s+(.+)$/i.exec(text)
    if (setName) {
      this.name = setName[1]!.trim()
      this.send(this.user('UM3', { call: KST_DEMO_CALL, name: this.name, loc: this.loc }, 0) + '\r\n')
      return this.say('SERVER', KST_DEMO_CALL, `Your name is now ${this.name}`)
    }
    if (text.startsWith('/')) return this.say('SERVER', KST_DEMO_CALL, 'Unknown command (demo)')
    this.say(KST_DEMO_CALL, '', text)
  }

  private say(from: string, to: string, text: string): void {
    this.send(this.frame('CH', this.ts(), from, to, text) + '\r\n')
  }

  private frame(kind: 'CH' | 'CR', ts: number, from: string, to: string, text: string): string {
    const name = [...CHATTERS, ...QUIET, LATE].find((s) => s.call === from)?.name ?? (from === KST_DEMO_CALL ? this.name : from)
    return `${kind}|${this.room}|${ts}|${from}|${name}|0|${text}|${to || '0'}|`
  }

  private user(kind: 'UA0' | 'UA5' | 'UM3', s: DemoStation, state: number): string {
    return `${kind}|${this.room}|${s.call}|${s.name}|${s.loc}|${state}|`
  }

  /** Unix seconds, never the same twice (the chat drops repeated messages by time + call + text). */
  private ts(): number {
    this.lastTs = Math.max(this.lastTs + 1, Math.floor(this.now() / 1000))
    return this.lastTs
  }

  private send(text: string): void {
    if (this.live) this.dataCb(text)
  }

  private after(ms: number, fn: () => void): void {
    const id = this.timers.set(() => {
      this.running.delete(id)
      if (this.live) fn()
    }, ms)
    this.running.add(id)
  }

  private every(ms: number, fn: () => void): void {
    this.after(ms, () => {
      fn()
      this.every(ms, fn)
    })
  }

  private stop(): void {
    this.live = false
    for (const id of this.running) this.timers.clear(id)
    this.running.clear()
  }
}
