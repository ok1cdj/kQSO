// ON4KST chat controller, one for the whole app (the link survives screen changes).
// Owns the KstSession over platform.tcp (native socket in the apps, the relay on the
// web), the account settings, the keepalive and the reconnect. Keeps one KstState per
// room, so switching rooms and reconnecting keep the messages. Screens subscribe and
// re-render on change. Nothing connects until a screen asks (connect / setRoom).

import { KST_HOST, KST_PORT, KstSession, KstState } from '../core/index'
import type { KstEntry, KstEvent, KstRoom, Timers } from '../core/index'
import type { KQSOPlatform, TcpLinkState, TcpTransport } from '../platform/index'
import { t } from './i18n'
import { browserTimers } from './rig'

export const KST_SETTINGS = {
  call: 'kstCall', // ON4KST account, '' = the log's own call
  pass: 'kstPass', // sent in clear by the ON4KST protocol
  sked: 'kstSked', // sked request template
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
      return k.reason === 'account' ? t('kst.noAccount') : t('kst.failed', { reason: k.reason ?? '' })
    case 'off':
      return k.wanted && k.reason ? t('kst.dropped', { reason: k.reason }) : t('kst.off')
  }
}

const SILENCE_PING_MS = 90_000 // nothing heard: poke the server
const SILENCE_DROP_MS = 210_000 // still nothing: the link is dead, reconnect
const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000] // after an unexpected drop

export class KstController {
  readonly available: boolean
  link: KstLinkState = 'off'
  /** Why the link is off / failed: LOGSTAT text ("Wrong password"), the relay's close reason. */
  reason: string | undefined
  room: KstRoom = 2
  /** My locator as ON4KST knows it (from the login). */
  locator: string | undefined
  /** Messages to me (/CQ MYCALL) not yet seen in the chat screen. */
  unread = 0
  /** The last message to me, shown on the logging screen until the next one. */
  lastForMe: KstEntry | undefined
  /** Server's "Please wait N s" (one command a minute): no sending before this (ms). */
  waitUntil = 0

  private readonly transport: TcpTransport | undefined
  private readonly states = new Map<KstRoom, KstState>()
  private readonly listeners = new Set<() => void>()
  private session: KstSession | undefined
  /** The account in use (after connect). */
  call = ''
  private pass = ''
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
    this.transport = tr
    this.available = tr !== undefined
    if (!tr) return
    tr.onData((text) => {
      this.heard()
      this.session?.receive(text)
    })
    tr.onState((s, reason) => this.onLink(s, reason))
  }

  /** Back from sleep / another app (iOS closes sockets in the background): reconnect. Call once at start. */
  init(): void {
    if (!this.available) return
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wantLink && this.link === 'off') void this.connect()
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

  /** The current room's stations and messages; empty until the first login. */
  get chat(): KstState {
    return this.stateFor(this.room)
  }

  /** Connects with the saved account (`fallbackCall` = the log's call when none is saved). */
  async connect(fallbackCall = ''): Promise<void> {
    if (!this.transport) return
    if (this.wantLink && this.link !== 'off') return // already (being) connected
    const p = this.platform
    this.call = ((await p.getSetting(KST_SETTINGS.call)) || fallbackCall).trim().toUpperCase()
    this.pass = (await p.getSetting(KST_SETTINGS.pass)) ?? ''
    if (!this.call || !this.pass) {
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
          this.locator = this.session?.locator
          this.setLink('on')
        }
        return
      case 'failed':
        // A wrong password does not get better by retrying.
        this.wantLink = false
        this.setLink('failed', e.text || String(e.code))
        this.session = undefined
        this.transport?.close()
        return
      case 'wait':
        this.waitUntil = this.now() + e.seconds * 1000
        break
      case 'message':
        // The history at the first login is old; after a drop it holds what was missed.
        if (e.entry.forMe && (!e.history || (this.sinceTs > 0 && e.entry.ts > this.sinceTs))) {
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
    for (const cb of this.listeners) cb()
  }
}
