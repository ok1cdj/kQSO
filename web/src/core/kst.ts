// ON4KST chat: the pure part. Frames of the machine port (www.on4kst.org:23001, fields
// separated by '|'), the login, outgoing lines and the chat state (stations, messages).
// No sockets, no timers — the transport hands text in and out (platform tcp: native in
// the apps, the WebSocket relay on the web), the controller (ui/kst.ts) keeps the link
// alive and reconnects.

import { bearingDeg, qsoPoints } from './locator'

export const KST_HOST = 'www.on4kst.org'
export const KST_PORT = 23001

/** 1 = 50/70 MHz, 2 = 144/432 MHz, 3 = microwaves. */
export type KstRoom = 1 | 2 | 3

/** Messages kept per state (oldest dropped). */
export const KST_MESSAGES_MAX = 500

/** The room for a band: 6 m / 4 m → 1, 2 m / 70 cm → 2, 23 cm and up → 3; HF → undefined. */
export function roomForBand(band: string): KstRoom | undefined {
  if (band === '6m' || band === '4m') return 1
  if (band === '2m' || band === '70cm') return 2
  if (/^[\d.]+(cm|mm)$/.test(band)) return 3
  return undefined
}

/** ON4KST takes ASCII only and '|' separates fields: diacritics dropped, the rest → '?'. */
export function asciiOut(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\|/g, '/')
}

/** Names and messages come HTML-escaped, also as numeric entities ("Hennie&#9889;2m"). */
export function unescapeHtml(s: string): string {
  return s.replace(/&(lt|gt|quot|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const named = NAMED[e.toLowerCase()]
    if (named) return named
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '?'
  })
}

const NAMED: Readonly<Record<string, string>> = { lt: '<', gt: '>', quot: '"', amp: '&' }

/** Message text without the HTML the web chat puts in: a link → its address, other tags dropped.
 *  The UI still shows it as text only, never as HTML. */
export function plainText(s: string): string {
  return s
    .replace(/<a\s[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>[\s\S]*?<\/a\s*>/gi, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
}

/** A chat call without the band suffix ON4KST users add ("DL1ABC-432" → "DL1ABC"), upper case. */
export function baseCall(call: string): string {
  return call.trim().toUpperCase().replace(/-[A-Z0-9]*$/, '')
}

// --- frames --------------------------------------------------------------------

export interface KstMessage {
  readonly room: number
  readonly ts: number // unix seconds
  readonly call: string
  readonly name: string
  readonly text: string
  /** Addressee of a /CQ (as written by the sender), undefined = public. */
  readonly to: string | undefined
}

export type KstFrame =
  | { type: 'logstat'; code: number; text: string; locator: string | undefined }
  | { type: 'message'; history: boolean; msg: KstMessage }
  | { type: 'historyEnd' }
  | { type: 'user'; change: 'list' | 'joined' | 'changed'; room: number; call: string; name: string; loc: string; away: boolean }
  | { type: 'userState'; room: number; call: string; away: boolean }
  | { type: 'userLeft'; room: number; call: string }
  | { type: 'listEnd'; room: number }
  | { type: 'loc'; call: string; loc: string }
  | { type: 'ping' }

const away = (state: string | undefined): boolean => (Number(state) & 1) === 1
const target = (s: string | undefined): string | undefined => (s && s !== '0' ? s : undefined)

/** One received line → a frame; unknown or broken lines → undefined. */
export function parseFrame(line: string): KstFrame | undefined {
  const f = line.split('|')
  const kind = f[0]
  switch (kind) {
    case 'LOGSTAT':
      return { type: 'logstat', code: Number(f[1]), text: f[2] ?? '', locator: f[8] ? f[8].toUpperCase() : undefined }
    case 'CH':
    case 'CR': {
      // CH|room|unix|CALL|name|0|text|addressee or 0|  (a /CQ text starts with a space)
      const ts = Number(f[2])
      if (!f[3] || !Number.isFinite(ts)) return undefined
      const msg: KstMessage = {
        room: Number(f[1]),
        ts,
        call: f[3].toUpperCase(),
        name: unescapeHtml(f[4] ?? ''),
        text: plainText(unescapeHtml(f[6] ?? '')).trim(),
        to: target(f[7])?.toUpperCase(),
      }
      return { type: 'message', history: kind === 'CR', msg }
    }
    case 'CE':
      return { type: 'historyEnd' }
    case 'UA0':
    case 'UA5':
    case 'UM3':
      if (!f[2]) return undefined
      return {
        type: 'user',
        change: kind === 'UA0' ? 'list' : kind === 'UA5' ? 'joined' : 'changed',
        room: Number(f[1]),
        call: f[2].toUpperCase(),
        name: unescapeHtml(f[3] ?? ''),
        loc: (f[4] ?? '').toUpperCase(),
        away: away(f[5]),
      }
    case 'US4':
      return f[2] ? { type: 'userState', room: Number(f[1]), call: f[2].toUpperCase(), away: away(f[3]) } : undefined
    case 'UR6':
      return f[2] ? { type: 'userLeft', room: Number(f[1]), call: f[2].toUpperCase() } : undefined
    case 'UE':
      return { type: 'listEnd', room: Number(f[1]) }
    case 'LOC':
      return f[2] && f[3] ? { type: 'loc', call: f[2].toUpperCase(), loc: f[3].toUpperCase() } : undefined
    case 'CK':
      return { type: 'ping' }
  }
  return undefined
}

// --- outgoing lines --------------------------------------------------------------

/** LOGINC|call|pass|room|client|past msgs|past dx|user list+updates|last msg ts|last dx ts| */
export function loginLine(call: string, pass: string, room: KstRoom, client: string, lastTs = 0): string {
  return `LOGINC|${asciiOut(call.toUpperCase())}|${pass}|${room}|${asciiOut(client)}|25|0|1|${lastTs}|0|`
}

export function sdoneLine(room: KstRoom): string {
  return `SDONE|${room}|`
}

export function msgLine(room: KstRoom, text: string): string {
  return `MSG|${room}|0|${asciiOut(text)}|0|`
}

/** What the user typed → chat text: "@CALL text" → "/CQ CALL text", "@ text" → public,
 *  the rest as is; undefined = nothing to send (also "@CALL" without text — sent as is it
 *  would go to everyone). */
export function chatText(input: string): string | undefined {
  const t = input.trim()
  const pub = /^@\s+(.+)$/.exec(t)
  if (pub) return pub[1]
  if (!t.startsWith('@')) return t || undefined
  const m = /^@(\S+)\s+(.+)$/.exec(t)
  return m ? `/CQ ${m[1]!.toUpperCase()} ${m[2]}` : undefined
}

/** Where a typed chat line goes: the addressee of "@CALL text", '' for "@ text" (public). */
export function chatTarget(input: string): string | undefined {
  const m = /^@(\S*)/.exec(input.trim())
  return m ? m[1]!.toUpperCase() : undefined
}

export const SKED_DEFAULT = 'pse sked {QRG} {MODE}?'

/** The sked request: {QRG} = the band's sked QRG (G command, any text) or else the frequency
 *  in MHz (144.300; dropped when unknown), {MODE}, {LOC}. */
export function expandSked(
  template: string,
  v: { qrgMHz?: string | undefined; skedQrg?: string | undefined; mode: string; loc: string },
): string {
  const mhz = v.qrgMHz !== undefined && Number.isFinite(Number(v.qrgMHz)) ? Number(v.qrgMHz).toFixed(3) : ''
  return template
    .replace(/\{QRG\}/gi, v.skedQrg || mhz)
    .replace(/\{MODE\}/gi, v.mode)
    .replace(/\{LOC\}/gi, v.loc)
    .replace(/\s+/g, ' ')
    .replace(/\s+([?!.,])/g, '$1')
    .trim()
}

/** G text ⏎: the band's sked QRG (text = '' shows it, '-' clears it); undefined = not the
 *  command. Leading digits without a dot are kHz, as in F28300 (the kQSO keyboard has no
 *  dot): G 144290 cw → "144.290 cw". */
export function matchSkedQrg(line: string): string | undefined {
  const m = /^g(?:\s+(.*))?$/i.exec(line.trim())
  if (!m) return undefined
  return (m[1] ?? '').trim().replace(/^(\d{4,})(?=\s|$)/, (khz) => (Number(khz) / 1000).toFixed(3))
}

/** The log's locator when ON4KST has another one for me (QRB / az for the others come from
 *  it); undefined = the same or unknown. A shorter one counts as the same where they agree. */
export function locatorToSet(kst: string | undefined, log: string): string | undefined {
  const a = (kst ?? '').toUpperCase()
  const b = log.trim().toUpperCase()
  if (!a || !b) return undefined
  return a.startsWith(b) || b.startsWith(a) ? undefined : b
}

/** "Please wait 42 second(s)…" from the server (one command a minute) → 42. */
export function waitSeconds(text: string): number | undefined {
  const m = /please wait (\d+) second/i.exec(text)
  return m ? Number(m[1]) : undefined
}

// --- state -----------------------------------------------------------------------

export interface KstUser {
  readonly call: string
  readonly name: string
  readonly loc: string
  readonly away: boolean
  /** Joined after the list at login was complete (shown highlighted, as in Tučňák). */
  readonly isNew: boolean
}

export interface KstEntry extends KstMessage {
  /** Addressed to me (/CQ MYCALL). */
  readonly forMe: boolean
  /** Not to me, but my call is in the text. */
  readonly mentionsMe: boolean
}

/**
 * Stations and messages of one room. Survives reconnects: the station list is rebuilt
 * from the new login's UA0 … UE (resetUsers), messages are kept and the history the
 * server repeats is dropped as duplicates.
 */
export class KstState {
  readonly users = new Map<string, KstUser>()
  /** Oldest first. */
  readonly messages: KstEntry[] = []
  /** Newest message time, for LOGINC on reconnect (ask from lastTs - 1). */
  lastTs = 0
  /** The station list after login is complete (UE received). */
  listDone = false
  /** My locator from the server's frames about me (the list at login, a change after /SETLOC). */
  myLoc: string | undefined
  private readonly seen = new Set<string>()

  constructor(readonly myCall: string) {}

  resetUsers(): void {
    this.users.clear()
    this.listDone = false
  }

  /** Applies a frame; returns the new entry for a message not seen before. */
  apply(frame: KstFrame): KstEntry | undefined {
    switch (frame.type) {
      case 'message':
        return this.addMessage(frame.msg)
      case 'user': {
        if (this.isMe(frame.call)) {
          if (frame.loc) this.myLoc = frame.loc
          return undefined
        }
        const old = this.users.get(frame.call)
        const isNew = (frame.change === 'joined' && this.listDone) || (old?.isNew ?? false)
        this.users.set(frame.call, { call: frame.call, name: frame.name, loc: frame.loc, away: frame.away, isNew })
        return undefined
      }
      case 'userState': {
        const u = this.users.get(frame.call)
        if (u) this.users.set(u.call, { ...u, away: frame.away })
        return undefined
      }
      case 'userLeft':
        this.users.delete(frame.call)
        return undefined
      case 'listEnd':
        this.listDone = true
        return undefined
      case 'loc': {
        if (this.isMe(frame.call)) this.myLoc = frame.loc
        const u = this.users.get(frame.call)
        if (u) this.users.set(u.call, { ...u, loc: frame.loc })
        return undefined
      }
    }
    return undefined
  }

  isMe(call: string): boolean {
    return baseCall(call) === baseCall(this.myCall)
  }

  private addMessage(msg: KstMessage): KstEntry | undefined {
    const key = `${msg.ts}|${msg.call}|${msg.text}`
    if (this.seen.has(key)) return undefined
    this.seen.add(key)
    const forMe = msg.to !== undefined && this.isMe(msg.to)
    const mentionsMe = !forMe && !this.isMe(msg.call) && mentions(msg.text, baseCall(this.myCall))
    const entry: KstEntry = { ...msg, forMe, mentionsMe }
    // Oldest first. The history after login comes newest first: insert by time.
    let i = this.messages.length
    while (i > 0 && this.messages[i - 1]!.ts > msg.ts) i--
    this.messages.splice(i, 0, entry)
    if (this.messages.length > KST_MESSAGES_MAX) {
      const old = this.messages.shift()!
      this.seen.delete(`${old.ts}|${old.call}|${old.text}`)
    }
    this.lastTs = Math.max(this.lastTs, msg.ts)
    return entry
  }
}

function mentions(text: string, call: string): boolean {
  if (!call) return false
  const esc = call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Z0-9])${esc}([^A-Z0-9]|$)`, 'i').test(text)
}

// --- session -----------------------------------------------------------------------

export type KstSessionState = 'login' | 'logstat' | 'on' | 'failed'

export type KstEvent =
  | { type: 'state'; state: KstSessionState }
  | { type: 'failed'; code: number; text: string }
  | { type: 'message'; entry: KstEntry; history: boolean }
  | { type: 'users' }
  | { type: 'wait'; seconds: number }

export interface KstLogin {
  readonly call: string
  readonly pass: string
  readonly room: KstRoom
  readonly client: string // "kQSO 1.14"
}

/**
 * One connection: answers the login prompt, checks LOGSTAT, sends SDONE, answers CK
 * and feeds frames into a KstState. Text in through receive(), out through the write
 * callback (whole lines with their line end). A new connection = a new session over
 * the same state (it asks for messages since state.lastTs - 1).
 */
export class KstSession {
  state: KstSessionState = 'login'
  /** My locator as the server knows it (from LOGSTAT). */
  locator: string | undefined
  private buf = ''

  constructor(
    private readonly login: KstLogin,
    readonly chat: KstState,
    private readonly write: (raw: string) => void,
    private readonly onEvent: (e: KstEvent) => void = () => {},
  ) {
    chat.resetUsers()
  }

  /** Feed received text (any split). */
  receive(text: string): void {
    this.buf += text
    let i
    while ((i = this.buf.search(/[\r\n]/)) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      if (line) this.onLine(line)
    }
    // The login prompt comes without a line end.
    if (this.state === 'login' && /login/i.test(this.buf)) {
      this.buf = ''
      this.onLine('login')
    }
  }

  /** Sends what the user typed ("@CALL text" → /CQ); false when not logged in or empty. */
  send(input: string): boolean {
    const text = chatText(input)
    if (this.state !== 'on' || text === undefined) return false
    this.line(msgLine(this.login.room, text))
    return true
  }

  private line(l: string): void {
    this.write(l + '\r')
  }

  private setState(s: KstSessionState): void {
    this.state = s
    this.onEvent({ type: 'state', state: s })
  }

  private onLine(line: string): void {
    if (this.state === 'login') {
      if (/login/i.test(line)) {
        const since = this.chat.lastTs > 0 ? this.chat.lastTs - 1 : 0
        this.line(loginLine(this.login.call, this.login.pass, this.login.room, this.login.client, since))
        this.setState('logstat')
      }
      return
    }
    const frame = parseFrame(line)
    if (!frame) return
    if (this.state === 'logstat') {
      if (frame.type !== 'logstat') return
      if (frame.code !== 100) {
        this.setState('failed')
        this.onEvent({ type: 'failed', code: frame.code, text: frame.text })
        return
      }
      this.locator = frame.locator
      this.line(sdoneLine(this.login.room))
      this.setState('on')
      return
    }
    if (this.state !== 'on') return
    if (frame.type === 'ping') {
      this.write('\r\n')
      return
    }
    const entry = this.chat.apply(frame)
    if (frame.type === 'message') {
      if (!entry) return
      const wait = entry.call === 'SERVER' ? waitSeconds(entry.text) : undefined
      if (wait !== undefined) this.onEvent({ type: 'wait', seconds: wait })
      this.onEvent({ type: 'message', entry, history: frame.history })
    } else if (frame.type !== 'historyEnd' && frame.type !== 'logstat' && this.chat.listDone) {
      // During the list at login only once, at its end (UE).
      this.onEvent({ type: 'users' })
    }
  }
}

// --- station list --------------------------------------------------------------------

export interface KstStation extends KstUser {
  /** As the log shows QRB: whole km + 1 (qsoPoints). */
  readonly km: number | undefined
  readonly az: number | undefined
  /** Worked on the log's current band. */
  readonly worked: boolean
  /** Their newest message (unix seconds), undefined = none seen. */
  readonly lastTs: number | undefined
}

export type KstSort = 'call' | 'km' | 'az'

/** How the station lists are shown; shared by the chat screen and the logging screen. */
export interface KstView {
  readonly sort: KstSort
  /** Descending: Z–A, farthest, 360° first. */
  readonly desc: boolean
  readonly hideWorked: boolean
  readonly hideAway: boolean
  /** Farthest shown, km; null = no limit (null, not undefined: it survives the JSON). A
   *  station without a locator stays in. */
  readonly maxKm: number | null
}

export const KST_VIEW_DEFAULT: KstView = { sort: 'km', desc: false, hideWorked: true, hideAway: true, maxKm: 900 }

/** Active = wrote something in the last 30 minutes. */
export const KST_ACTIVE_S = 30 * 60

/** The room's stations with distance, bearing, worked and their last message. */
export function kstStations(chat: KstState, myGrid: string, worked: (call: string) => boolean): KstStation[] {
  const last = new Map<string, number>()
  for (const m of chat.messages) last.set(baseCall(m.call), Math.max(last.get(baseCall(m.call)) ?? 0, m.ts))
  return [...chat.users.values()].map((u) => ({
    ...u,
    km: u.loc ? qsoPoints(myGrid, u.loc) : undefined,
    az: u.loc ? bearingDeg(myGrid, u.loc) : undefined,
    worked: worked(baseCall(u.call)),
    lastTs: last.get(baseCall(u.call)),
  }))
}

/** Wrote within `windowS` before `nowS` (away or not: the view's filter decides). */
export function isActive(s: KstStation, nowS: number, windowS = KST_ACTIVE_S): boolean {
  return s.lastTs !== undefined && nowS - s.lastTs <= windowS
}

/** Sorted copy; unknown km / az last in both directions. */
export function sortStations(list: readonly KstStation[], by: KstSort, desc = false): KstStation[] {
  const dir = desc ? -1 : 1
  return [...list].sort((a, b) => {
    if (by === 'call') return dir * a.call.localeCompare(b.call)
    const x = a[by]
    const y = b[by]
    if (x === undefined || y === undefined) return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) || a.call.localeCompare(b.call)
    return dir * (x - y) || a.call.localeCompare(b.call)
  })
}

/** Within the view's km limit (no locator = can't tell, kept). */
function inKm(s: KstStation, view: KstView): boolean {
  return s.km === undefined || view.maxKm === null || s.km <= view.maxKm
}

/** The view's filters, then its order. */
export function viewStations(list: readonly KstStation[], view: KstView): KstStation[] {
  return sortStations(
    list.filter((s) => (!view.hideWorked || !s.worked) && (!view.hideAway || !s.away) && inKm(s, view)),
    view.sort,
    view.desc,
  )
}

// --- locators for the log ------------------------------------------------------------

/** The locator a station has set in the chat now (ON4KST: what it is on today, newer than
 *  the callsign database), by its base call. */
export function chatLocator(chat: KstState, call: string): string | undefined {
  // The log has DL1ABC/P, the chat DL1ABC: its locator there is where it is today.
  const bc = baseCall(call).replace(/\/(P|M|A|QRP)$/, '')
  for (const u of chat.users.values()) if (u.loc && baseCall(u.call) === bc) return u.loc
  return undefined
}

/** The chat's stations on this locator (base calls), for a locator typed before the call. */
export function chatCallsAt(chat: KstState, loc: string, limit: number): string[] {
  const l = loc.toUpperCase()
  const calls = new Set<string>()
  for (const u of chat.users.values()) {
    if (u.loc === l && !chat.isMe(u.call)) calls.add(baseCall(u.call))
    if (calls.size >= limit) break
  }
  return [...calls]
}
