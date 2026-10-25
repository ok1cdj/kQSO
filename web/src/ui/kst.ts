// ON4KST chat controller, one for the whole app (the link survives screen changes).
// Owns the KstSession over platform.tcp (native socket in the apps, the relay on the
// web), the account settings, the keepalive and the reconnect. Keeps one KstState per
// room, so switching rooms and reconnecting keep the messages. Screens subscribe and
// re-render on change. Nothing connects until a screen asks (connect / setRoom).

import { KST_HOST, KST_PORT, KST_VIEW_DEFAULT, KstSession, KstState, baseCall, chatQrv, chatText } from '../core/index'
import type { KstEntry, KstEvent, KstRoom, KstView, Timers } from '../core/index'
import type { KQSOPlatform, TcpLinkState, TcpTransport } from '../platform/index'
import { button, el } from './dom'
import { t } from './i18n'
import { KST_DEMO_CALL, KstDemo } from './kst-demo'
import { browserTimers } from './rig'

export const KST_SETTINGS = {
  call: 'kstCall', // ON4KST account, '' = the log's own call
  pass: 'kstPass', // sent in clear by the ON4KST protocol
  sked: 'kstSked', // sked request template
  view: 'kstView', // station lists: sort, direction, filters (JSON)
  skedQrg: 'kstSkedQrg', // sked QRG per band, {"2m": "144.300"} (JSON)
  muted: 'kstMuted', // muted stations, ["OK1ABC"] (JSON, base calls)
  consent: 'kstConsent', // '1' = the chat rules agreed to (asked before the first connection)
} as const

/** off → connecting (socket) → login (LOGINC sent) → on; failed = login refused. */
export type KstLinkState = 'off' | 'connecting' | 'login' | 'on' | 'failed'

/** One line for the link: the call and stations when on, else what is going on / wrong. */
export function kstStatus(k: KstController): string {
  switch (k.link) {
    case 'on':
      return t('kst.on', { call: k.call, n: k.chat.users.size })
    case 'connecting':
      return t('kst.connecting')
    case 'login':
      return t('kst.login')
    case 'failed':
      if (k.reason === 'consent') return t('kst.needConsent')
      return k.reason === 'account' ? t('kst.noAccount') : t('kst.failed', { reason: k.reason ?? '' })
    case 'off':
      return k.wanted && k.reason ? t('kst.dropped', { reason: k.reason }) : t('kst.off')
  }
}

/** Why send() refused `input`: no text after @CALL, the server's wait, or no link. */
export function notSentWhy(k: KstController, input = ' '): string {
  if (chatText(input) === undefined) return t('kst.noText')
  const wait = Math.ceil((k.waitUntil - Date.now()) / 1000)
  return wait > 0 ? t('kst.wait', { s: wait }) : t('kst.notSent')
}

/** The chat rules, agreed to once before the first connection: whose chat it is, no
 *  tolerance for abuse, mute and report, the password in clear. `onAgree` connects. */
export function kstConsentPanel(k: KstController, onAgree: () => void): HTMLElement {
  const box = el('div', 'kst-consent')
  const list = el('ul')
  for (const key of ['kst.consent1', 'kst.consent2', 'kst.consent3', 'kst.consent4'] as const) list.append(el('li', undefined, t(key)))
  box.append(
    el('b', undefined, t('kst.consentTitle')),
    list,
    button(t('kst.consentAgree'), () => {
      void k.agree().then(onAgree)
    }, 'btn'),
  )
  return box
}

/** Where reports go: the kQSO author, who passes abuse on to ON4KST (privacy.html). */
export const KST_REPORT_TO = 'ondra@ok1cdj.com'

/** mailto: for reporting a station — its call, the room, who reports, and the messages
 *  (`picked` first, then its latest), kept short enough for a mailto link. English: it
 *  goes to the author. */
export function kstReportMailto(
  r: { call: string; name: string; room: number; me: string; picked?: KstEntry | undefined; messages: readonly KstEntry[] },
): string {
  const line = (m: KstEntry): string => {
    const d = new Date(m.ts * 1000).toISOString().slice(0, 16).replace('T', ' ')
    return `${d} ${m.call}${m.to ? ' > ' + m.to : ''}: ${m.text}`
  }
  const rest = r.messages.filter((m) => m !== r.picked).slice(-5)
  const body = [
    `Station: ${r.call}${r.name ? ` (${r.name})` : ''}`,
    `ON4KST room: ${r.room}`,
    `Reported by: ${r.me}`,
    '',
    ...(r.picked ? ['Reported message (UTC):', line(r.picked), ''] : []),
    ...(rest.length ? ['Latest messages (UTC):', ...rest.map(line), ''] : []),
    'What is wrong:',
    '',
  ].join('\n')
  const subject = `kQSO: ON4KST report ${r.call}`
  return `mailto:${KST_REPORT_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1500))}`
}

/** A saved JSON setting; undefined when missing or broken. */
function parseJson<T>(v: string | null): T | undefined {
  if (!v) return undefined
  try {
    return JSON.parse(v) as T
  } catch {
    return undefined
  }
}

const SILENCE_PING_MS = 90_000 // nothing heard: poke the server
const SILENCE_DROP_MS = 210_000 // still nothing: the link is dead, reconnect
const LOC_UNDO_MS = 15_000 // "Please wait" this soon after /SETLOC is its answer
const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000] // after an unexpected drop

export class KstController {
  readonly available: boolean
  link: KstLinkState = 'off'
  /** Why the link is off / failed: LOGSTAT text ("Wrong password"), the relay's close reason. */
  reason: string | undefined
  room: KstRoom = 2
  /** Messages to me (/CQ MYCALL) not yet seen in the chat screen. */
  unread = 0
  /** The last message to me, shown on the logging screen until the next one. */
  lastForMe: KstEntry | undefined
  /** Server's "Please wait N s" (one command a minute): no sending before this (ms). */
  waitUntil = 0
  /** Sort and filters of the station lists, the same in the chat and under the contest panel. */
  view: KstView = KST_VIEW_DEFAULT
  /** The sked QRG per band (G command): any text, put into {QRG} instead of the radio's frequency. */
  private skedQrgs: Record<string, string> = {}
  /** Stations muted on this device (base calls): hidden everywhere, their messages to me not counted. */
  private mutedCalls = new Set<string>()
  /** chatQrv of the current room, until the next change. */
  private qrvCache: Map<string, string> | undefined

  /** The link in use: the platform's socket, or the demo (call DEMO). */
  private transport: TcpTransport | undefined
  private readonly real: TcpTransport | undefined
  private demo: KstDemo | undefined
  private readonly states = new Map<KstRoom, KstState>()
  private readonly listeners = new Set<() => void>()
  private session: KstSession | undefined
  /** The account in use (after connect). */
  call = ''
  private pass = ''
  private loginLocator: string | undefined
  private locUndo: { loc: string | undefined; at: number } | undefined // the last /SETLOC
  private sinceTs = 0 // newest message before this login: history after it was missed, not old
  private wantLink = false // the operator wants to be connected (not after disconnect / a refused login)
  private retry = 0
  private retryTimer: unknown
  private pingTimer: unknown
  private dropTimer: unknown

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly client = `kQSO ${__APP_VERSION__}`,
    private readonly timers: Timers = browserTimers,
    private readonly now: () => number = Date.now,
  ) {
    const tr = platform.tcp
    this.real = tr
    this.transport = tr
    this.available = tr !== undefined
    if (tr) this.listen(tr)
  }

  /** Events of a link that isn't the one in use (after a switch to / from the demo) are ignored. */
  private listen(tr: TcpTransport): void {
    tr.onData((text) => {
      if (tr !== this.transport) return
      this.heard()
      this.session?.receive(text)
    })
    tr.onState((s, reason) => {
      if (tr === this.transport) this.onLink(s, reason)
    })
  }

  /** The call DEMO: the simulated chat (kst-demo.ts) instead of on4kst.org. */
  private pick(call: string): void {
    const want = call === KST_DEMO_CALL ? (this.demo ??= this.newDemo()) : this.real
    if (want === this.transport) return
    this.transport?.close()
    this.transport = want
  }

  private newDemo(): KstDemo {
    const d = new KstDemo(this.timers, this.now)
    this.listen(d)
    return d
  }

  /** Back from sleep / another app (iOS closes sockets in the background): reconnect. Call once at start. */
  init(): void {
    if (!this.available) return
    void this.platform.getSetting(KST_SETTINGS.view).then((v) => {
      const view = parseJson<Partial<KstView>>(v)
      if (!view) return
      this.view = { ...KST_VIEW_DEFAULT, ...view }
      this.emit()
    })
    void this.platform.getSetting(KST_SETTINGS.skedQrg).then((v) => {
      this.skedQrgs = parseJson<Record<string, string>>(v) ?? {}
    })
    void this.platform.getSetting(KST_SETTINGS.muted).then((v) => {
      this.mutedCalls = new Set(parseJson<string[]>(v) ?? [])
      this.emit()
    })
    document.addEventListener('visibilitychange', () => {
      // The call of the last login: with none saved it was the log's, which only screens know.
      if (!document.hidden && this.wantLink && this.link === 'off') void this.connect(this.call)
    })
  }

  /** The operator wants the chat connected (also while it reconnects after a drop). */
  get wanted(): boolean {
    return this.wantLink
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** My locator as ON4KST knows it: from the frames about me, else from the login. */
  get locator(): string | undefined {
    return this.chat.myLoc ?? this.loginLocator
  }

  /** /SETLOC: ON4KST gets my locator (the others' QRB / az to me come from it). */
  setLocator(loc: string): boolean {
    const before = this.chat.myLoc
    if (!this.send(`/SETLOC ${loc}`)) return false
    // Shown at once; the server's frame about me confirms (or corrects) it, its
    // "Please wait" (command dropped) puts the old one back.
    this.chat.myLoc = loc
    this.locUndo = { loc: before, at: this.now() }
    this.emit()
    return true
  }

  /** The current room's stations and messages; empty until the first login. */
  get chat(): KstState {
    return this.stateFor(this.room)
  }

  /** Connects with the saved account (`fallbackCall` = the log's call when none is saved). */
  async connect(fallbackCall = ''): Promise<void> {
    if (!this.available) return
    if (this.wantLink && this.link !== 'off') return // already (being) connected
    const p = this.platform
    // The rules first (App Store 1.2: content from other users); the screens show them.
    if ((await p.getSetting(KST_SETTINGS.consent)) !== '1') {
      this.setLink('failed', 'consent')
      return
    }
    this.call = ((await p.getSetting(KST_SETTINGS.call)) || fallbackCall).trim().toUpperCase()
    this.pass = (await p.getSetting(KST_SETTINGS.pass)) ?? ''
    this.pick(this.call)
    if (!this.call || (!this.pass && this.call !== KST_DEMO_CALL)) {
      this.setLink('failed', 'account')
      return
    }
    this.wantLink = true
    this.open()
  }

  disconnect(): void {
    this.wantLink = false
    this.stopTimers()
    if (this.session?.state === 'on') this.transport?.write('/QUIT\r')
    this.session = undefined
    this.transport?.close()
    this.setLink('off')
  }

  /** The log's band changed: its room (reconnects when connected to another one). */
  setRoom(room: KstRoom): void {
    if (room === this.room) return
    this.room = room
    this.qrvCache = undefined
    this.lastForMe = undefined
    if (this.wantLink) this.open()
    else this.emit()
  }

  /** Sends what the user typed ("@CALL text" = /CQ); false when not connected or waiting. */
  send(input: string): boolean {
    if (!this.session || this.now() < this.waitUntil) return false
    const ok = this.session.send(input)
    if (ok) this.heard()
    return ok
  }

  /** The operator agreed to the chat rules (kstConsentPanel); connect next. */
  async agree(): Promise<void> {
    await this.platform.setSetting(KST_SETTINGS.consent, '1')
  }

  /** Changes the station lists' sort / filters everywhere and saves them. */
  setView(change: Partial<KstView>): void {
    this.view = { ...this.view, ...change }
    void this.platform.setSetting(KST_SETTINGS.view, JSON.stringify(this.view))
    this.emit()
  }

  /** The bands the chat says a station is QRV on (its name and messages), as QRV letters. */
  qrvOf(call: string): string | undefined {
    this.qrvCache ??= chatQrv(this.chat)
    return this.qrvCache.get(baseCall(call))
  }

  isMuted(call: string): boolean {
    return this.mutedCalls.has(baseCall(call))
  }

  /** The muted stations, A–Z. */
  get muted(): string[] {
    return [...this.mutedCalls].sort()
  }

  /** Mutes / unmutes a station (by its base call, so all its band suffixes) and saves it. */
  setMuted(call: string, on: boolean): void {
    const c = baseCall(call)
    if (on) this.mutedCalls.add(c)
    else this.mutedCalls.delete(c)
    if (on && this.lastForMe && baseCall(this.lastForMe.call) === c) this.lastForMe = undefined
    void this.platform.setSetting(KST_SETTINGS.muted, JSON.stringify(this.muted))
    this.emit()
  }

  /** The band's sked QRG, '' = none (the radio's frequency then). */
  skedQrg(band: string): string {
    return this.skedQrgs[band] ?? ''
  }

  /** Sets the band's sked QRG; '' clears it. */
  setSkedQrg(band: string, text: string): void {
    const next = { ...this.skedQrgs }
    if (text) next[band] = text
    else delete next[band]
    this.skedQrgs = next
    void this.platform.setSetting(KST_SETTINGS.skedQrg, JSON.stringify(next))
  }

  /** The chat screen showed the messages. */
  markRead(): void {
    if (this.unread === 0) return
    this.unread = 0
    this.emit()
  }

  private stateFor(room: KstRoom): KstState {
    let s = this.states.get(room)
    if (!s || s.myCall !== this.call) {
      s = new KstState(this.call)
      this.states.set(room, s)
    }
    return s
  }

  private open(): void {
    const tr = this.transport!
    this.stopTimers()
    const chat = this.stateFor(this.room)
    this.sinceTs = chat.lastTs
    const session: KstSession = new KstSession(
      { call: this.call, pass: this.pass, room: this.room, client: this.client },
      chat,
      (raw) => tr.write(raw),
      (e) => {
        if (this.session === session) this.onEvent(e)
      },
    )
    this.session = session
    this.reason = undefined
    tr.connect(KST_HOST, KST_PORT)
  }

  private onLink(s: TcpLinkState, reason?: string): void {
    if (s === 'connecting') return this.setLink('connecting')
    if (s === 'on') {
      this.heard()
      return this.setLink('login')
    }
    // off
    this.stopTimers()
    this.session = undefined
    if (this.link === 'failed') return
    this.setLink('off', reason)
    if (this.wantLink) this.scheduleRetry()
  }

  private onEvent(e: KstEvent): void {
    switch (e.type) {
      case 'state':
        if (e.state === 'on') {
          this.retry = 0
          this.loginLocator = this.session?.locator
          this.setLink('on')
        }
        return
      case 'failed':
        // A wrong password does not get better by retrying.
        this.wantLink = false
        this.stopTimers()
        this.setLink('failed', e.text || String(e.code))
        this.session = undefined
        this.transport?.close()
        return
      case 'wait':
        this.waitUntil = this.now() + e.seconds * 1000
        if (this.locUndo && this.now() - this.locUndo.at < LOC_UNDO_MS) this.chat.myLoc = this.locUndo.loc
        this.locUndo = undefined
        break
      case 'message':
        // The history at the first login is old; after a drop it holds what was missed.
        if (e.entry.forMe && !this.isMuted(e.entry.call) && (!e.history || (this.sinceTs > 0 && e.entry.ts > this.sinceTs))) {
          this.unread++
          this.lastForMe = e.entry
        }
        break
    }
    this.emit()
  }

  private scheduleRetry(): void {
    const ms = RETRY_MS[Math.min(this.retry, RETRY_MS.length - 1)]!
    this.retry++
    this.retryTimer = this.timers.set(() => {
      this.retryTimer = undefined
      if (this.wantLink && this.link === 'off') this.open()
    }, ms)
  }

  /** Something came in (or went out): restart the silence watch. */
  private heard(): void {
    if (this.pingTimer !== undefined) this.timers.clear(this.pingTimer)
    if (this.dropTimer !== undefined) this.timers.clear(this.dropTimer)
    this.pingTimer = this.timers.set(() => {
      this.pingTimer = undefined
      this.transport?.write('CK|\r')
    }, SILENCE_PING_MS)
    this.dropTimer = this.timers.set(() => {
      this.dropTimer = undefined
      // Dead link: start over (the new login asks for the messages since the last one).
      if (this.wantLink) this.open()
    }, SILENCE_DROP_MS)
  }

  private stopTimers(): void {
    for (const t of [this.retryTimer, this.pingTimer, this.dropTimer]) if (t !== undefined) this.timers.clear(t)
    this.retryTimer = this.pingTimer = this.dropTimer = undefined
  }

  private setLink(s: KstLinkState, reason?: string): void {
    this.link = s
    this.reason = reason
    this.emit()
  }

  private emit(): void {
    this.qrvCache = undefined
    for (const cb of this.listeners) cb()
  }
}
