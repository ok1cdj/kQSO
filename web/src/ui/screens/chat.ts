// ON4KST chat screen, opened from a VHF-contest log (header bubble, Alt+O, O ⏎). Two
// tabs: the messages (all, or only to me) and the stations (distance / bearing from the
// log's locator, worked on the log's band). A tap on a message or a station puts
// "@CALL " into the line at the bottom; Sked fills in the sked request, Log goes back to
// the log with the call and locator typed in. A long press (or ⋯ on a station) opens
// the station's detail: its data, its messages, and — out of the way of contest work —
// Mute and Report. Muted stations are hidden here and everywhere else. Text from the
// chat is only ever set as text, never as HTML.

import { PROFILES, baseCall, expandSked, isDupe, kstStations, locatorToSet, readLogFile, roomForBand, viewStations, SKED_DEFAULT } from '../../core/index'
import type { KstEntry, KstRoom, KstSort, KstStation, LogMeta, Qso } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button, onLongPress } from '../dom'
import { t } from '../i18n'
import { KST_SETTINGS, kstConsentPanel, kstReportMailto, kstStatus, notSentWhy } from '../kst'
import type { KstController } from '../kst'

export interface ChatNav {
  back(): void
  /** Back to the log with this line typed in ("OK1ABC JN79US"). */
  toLog(line: string): void
}

/** What the log is on now: the band picks the room and what counts as worked; QRG / mode fill the sked request. */
export interface ChatContext {
  readonly band: string
  readonly mode: string
  readonly freqMHz: string | undefined
}

// Kept while the app runs: coming back shows the same tab (sort and filters are in the controller).
let tab: 'messages' | 'stations' = 'messages'
let onlyMe = false

const ROOMS: readonly KstRoom[] = [1, 2, 3]
const ROOM_LABEL = { 1: 'kst.room1', 2: 'kst.room2', 3: 'kst.room3' } as const
const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))
const hhmm = (ts: number): string => {
  const d = new Date(ts * 1000)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

export class ChatScreen implements Screen {
  private readonly root = el('div', 'screen screen--list screen--chat')
  private readonly statusEl = el('div', 'about chat-status')
  private readonly roomsEl = el('div', 'segmented')
  private readonly locEl = el('div', 'chat-loc')
  private readonly tabsEl = el('div', 'segmented')
  private readonly toolsEl = el('div', 'segmented segmented--wrap chat-tools')
  private readonly bodyEl = el('div', 'chat-body')
  private readonly input = el('input', 'field-input chat-input')
  private readonly noticeEl = el('div', 'about')
  private meta: LogMeta | undefined
  private qsos: Qso[] = []
  private sked = SKED_DEFAULT
  private unsubscribe: (() => void) | undefined
  private frame = 0
  /** The station whose detail is open; `picked` = the message it was opened from (for Report). */
  private detail: { call: string; picked?: KstEntry | undefined } | undefined

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly kst: KstController,
    private readonly logId: string,
    private readonly ctx: ChatContext,
    private readonly nav: ChatNav,
  ) {}

  mount(host: HTMLElement): void {
    const bar = el('div', 'bar')
    bar.append(button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'), el('b', 'title', t('kst.title')))
    this.input.type = 'text'
    this.input.autocomplete = 'off'
    this.input.spellcheck = false
    this.input.enterKeyHint = 'send'
    this.input.placeholder = t('kst.placeholder')
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.send()
      } else if (e.key === 'Escape' && this.input.value === '') {
        if (this.detail) this.closeDetail()
        else this.nav.back()
      }
    })
    const compose = el('div', 'chat-compose')
    compose.append(this.input, button(t('kst.send'), () => this.send(), 'btn'))
    this.root.replaceChildren(bar, this.roomsEl, this.statusEl, this.locEl, this.tabsEl, this.toolsEl, this.bodyEl, this.noticeEl, compose)
    host.replaceChildren(this.root)
    this.unsubscribe = this.kst.subscribe(() => this.schedule())
    void this.init()
  }

  unmount(): void {
    this.unsubscribe?.()
    cancelAnimationFrame(this.frame)
  }

  private async init(): Promise<void> {
    const { meta, qsos } = readLogFile(await this.platform.readLog(this.logId))
    this.meta = meta
    this.qsos = qsos
    this.sked = (await this.platform.getSetting(KST_SETTINGS.sked)) || SKED_DEFAULT
    const room = roomForBand(this.ctx.band)
    if (room) this.kst.setRoom(room)
    if (!this.kst.wanted && this.kst.link !== 'on') await this.kst.connect(meta.myCall)
    this.render()
    this.input.focus({ preventScroll: true })
  }

  /** Many frames come at once (the station list at login): one render per animation frame. */
  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private render(): void {
    const k = this.kst
    this.statusEl.textContent = kstStatus(k)
    this.roomsEl.replaceChildren(
      ...ROOMS.map((r) => {
        const b = button(t(ROOM_LABEL[r]), () => k.setRoom(r), 'btn btn--small')
        b.setAttribute('aria-pressed', String(k.room === r))
        return b
      }),
    )
    this.renderLoc()
    // Before the first connection: the rules, and Agree connects.
    const consent = k.link === 'failed' && k.reason === 'consent'
    this.tabsEl.hidden = consent || this.detail !== undefined
    if (consent) {
      this.toolsEl.replaceChildren()
      this.bodyEl.replaceChildren(kstConsentPanel(k, () => void k.connect(this.meta?.myCall ?? '')))
      return
    }
    if (this.detail) return this.renderDetail(this.detail.call, this.detail.picked)
    const unread = k.unread > 0 ? ` (${k.unread})` : ''
    this.tabsEl.replaceChildren(
      this.toggle(t('kst.messages') + unread, tab === 'messages', () => (tab = 'messages')),
      this.toggle(t('kst.stations'), tab === 'stations', () => (tab = 'stations')),
    )
    if (tab === 'messages') this.renderMessages()
    else this.renderStations()
  }

  /** ON4KST has me in another locator than the log: say so, one tap sends /SETLOC. */
  private renderLoc(): void {
    const k = this.kst
    const want = k.link === 'on' && this.meta ? locatorToSet(k.locator, this.meta.myGrid) : undefined
    this.locEl.hidden = want === undefined
    if (!want) return this.locEl.replaceChildren()
    this.locEl.replaceChildren(
      el('span', undefined, t('kst.locDiffers', { kst: k.locator ?? '', log: want })),
      button(t('kst.setLoc', { loc: want }), () => {
        if (!k.setLocator(want)) this.noticeEl.textContent = notSentWhy(k)
      }, 'btn btn--small'),
    )
  }

  private toggle(label: string, on: boolean, set: () => void): HTMLButtonElement {
    const b = button(label, () => {
      set()
      this.render()
    }, 'btn btn--small')
    b.setAttribute('aria-pressed', String(on))
    return b
  }

  private renderMessages(): void {
    this.kst.markRead()
    this.toolsEl.replaceChildren(this.toggle(t('kst.onlyMe'), onlyMe, () => (onlyMe = !onlyMe)))
    const stick = this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight < 40
    const k = this.kst
    const msgs = k.chat.messages.filter((m) => !k.isMuted(m.call) && (!onlyMe || m.forMe || k.chat.isMe(m.call)))
    if (msgs.length === 0) {
      this.bodyEl.replaceChildren(el('div', 'about', t('kst.empty')))
      return
    }
    const list = el('ol', 'chat-msgs')
    list.append(...msgs.map((m) => this.messageRow(m)))
    this.bodyEl.replaceChildren(list)
    if (stick) this.bodyEl.scrollTop = this.bodyEl.scrollHeight
  }

  /** A tap addresses the other station; a long press opens its detail (`picked` = this message). */
  private messageRow(m: KstEntry, picked = false): HTMLElement {
    const mine = this.kst.chat.isMe(m.call)
    const other = mine ? m.to : m.call
    const li = el('li')
    const cls = ['chat-msg', m.forMe ? 'chat-msg--me' : '', m.mentionsMe ? 'chat-msg--mention' : '', mine ? 'chat-msg--mine' : '', picked ? 'chat-msg--picked' : '']
    const b = button('', () => this.address(other), cls.filter(Boolean).join(' '))
    if (other) onLongPress(b, () => this.openDetail(other, mine ? undefined : m))
    b.append(el('span', 'chat-time', hhmm(m.ts)), ' ', el('b', undefined, m.call))
    if (m.to) b.append(` → ${m.to}`)
    b.append(`: ${m.text}`)
    li.append(b)
    return li
  }

  private renderStations(): void {
    const k = this.kst
    const v = k.view
    // The active sort again = the other direction.
    const sortBtn = (by: KstSort, label: string): HTMLButtonElement =>
      this.toggle(v.sort === by ? `${label} ${v.desc ? '▼' : '▲'}` : label, v.sort === by, () =>
        k.setView(v.sort === by ? { desc: !v.desc } : { sort: by, desc: false }),
      )
    this.toolsEl.replaceChildren(
      sortBtn('call', 'CALL'),
      sortBtn('km', 'km'),
      sortBtn('az', 'az°'),
      this.toggle(t('kst.hideWorked'), v.hideWorked, () => k.setView({ hideWorked: !v.hideWorked })),
      this.toggle(t('kst.hideAway'), v.hideAway, () => k.setView({ hideAway: !v.hideAway })),
    )
    const all = kstStations(k.chat, this.meta?.myGrid ?? '', (c) => this.worked(c))
    const shown = viewStations(all.filter((s) => !k.isMuted(s.call)), v)
    const table = el('table', 'chat-stations')
    for (const s of shown) table.append(this.stationRow(s))
    this.bodyEl.replaceChildren(table)
  }

  private stationRow(s: KstStation): HTMLElement {
    const tr = el('tr', ['chat-st', s.worked ? 'chat-st--worked' : '', s.away ? 'chat-st--away' : '', s.isNew ? 'chat-st--new' : ''].filter(Boolean).join(' '))
    const call = el('td', 'chat-st-call', s.call)
    tr.append(
      call,
      el('td', undefined, s.loc),
      el('td', 'num', s.km !== undefined ? String(s.km) : ''),
      el('td', 'num', s.az !== undefined ? `${s.az}°` : ''),
      el('td', 'chat-st-name', s.name),
    )
    const acts = el('td', 'chat-st-acts')
    acts.append(
      button(t('kst.sked'), () => this.address(s.call, this.skedText()), 'btn btn--small'),
      button(t('kst.toLog'), () => this.toLog(s), 'btn btn--small'),
    )
    const more = button('⋯', () => this.openDetail(s.call), 'btn btn--small chat-st-more')
    more.title = t('kst.details')
    more.setAttribute('aria-label', t('kst.details'))
    acts.append(more)
    tr.append(acts)
    for (const td of Array.from(tr.children).slice(0, 5)) td.addEventListener('click', () => this.address(s.call))
    onLongPress(tr, () => this.openDetail(s.call))
    return tr
  }

  private toLog(s: { call: string; loc: string }): void {
    this.nav.toLog(`${baseCall(s.call)} ${s.loc}`.trim())
  }

  private openDetail(call: string, picked?: KstEntry): void {
    this.detail = { call, picked }
    this.render()
    this.bodyEl.scrollTop = 0
  }

  private closeDetail(): void {
    this.detail = undefined
    this.render()
  }

  /** One station: its data and actions, its messages (also while muted, to report them),
   *  and Mute / Report at the bottom, away from Sked / Log. */
  private renderDetail(call: string, picked: KstEntry | undefined): void {
    const k = this.kst
    const bc = baseCall(call)
    const all = kstStations(k.chat, this.meta?.myGrid ?? '', (c) => this.worked(c))
    const s = all.find((x) => x.call === call) ?? all.find((x) => baseCall(x.call) === bc)
    const msgs = k.chat.messages.filter((m) => baseCall(m.call) === bc || (m.to !== undefined && baseCall(m.to) === bc)).slice(-30)
    const name = s?.name ?? picked?.name ?? msgs.find((m) => baseCall(m.call) === bc)?.name ?? ''
    const muted = k.isMuted(call)
    this.toolsEl.replaceChildren(button(`‹ ${t('kst.stations')}`, () => this.closeDetail(), 'btn btn--small'))

    const head = el('div', 'chat-detail-head')
    head.append(el('b', 'chat-st-call', s?.call ?? call))
    if (name) head.append(' ', el('span', 'chat-st-name', name))
    const facts: string[] = []
    if (s) {
      if (s.loc) facts.push(s.loc)
      if (s.km !== undefined) facts.push(`${s.km} km`)
      if (s.az !== undefined) facts.push(`${s.az}°`)
      facts.push(t(s.worked ? 'kst.worked' : 'kst.notWorked', { band: this.ctx.band }))
      if (s.away) facts.push(t('kst.away'))
    } else facts.push(t('kst.left'))
    if (muted) facts.push(t('kst.mutedNote'))
    const acts = el('div', 'segmented')
    acts.append(
      button(t('kst.write'), () => this.address(s?.call ?? call), 'btn btn--small'),
      button(t('kst.sked'), () => this.address(s?.call ?? call, this.skedText()), 'btn btn--small'),
    )
    if (s) acts.append(button(t('kst.toLog'), () => this.toLog(s), 'btn btn--small'))

    const list = el('ol', 'chat-msgs')
    list.append(...msgs.map((m) => this.messageRow(m, m === picked)))

    const report = el('a', 'btn btn--small', t('kst.report'))
    report.href = kstReportMailto({ call: s?.call ?? call, name, room: k.room, me: k.call, picked, messages: msgs.filter((m) => baseCall(m.call) === bc) })
    const mod = el('div', 'chat-detail-mod')
    const modActs = el('div', 'segmented')
    modActs.append(
      button(t(muted ? 'kst.unmute' : 'kst.mute'), () => {
        k.setMuted(call, !muted)
        this.render()
      }, 'btn btn--small'),
      report,
    )
    mod.append(modActs, el('div', 'about', t('kst.modHint')))

    const box = el('div', 'chat-detail')
    box.append(head, el('div', 'about', facts.join(' · ')), acts, msgs.length ? list : el('div', 'about', t('kst.noMsgs')), mod)
    this.bodyEl.replaceChildren(box)
  }

  private worked(call: string): boolean {
    const contest = this.meta ? PROFILES[this.meta.profile].contest : true
    return isDupe(this.qsos, call, this.ctx.band, contest ? undefined : this.ctx.mode)
  }

  private skedText(): string {
    const c = this.ctx
    return expandSked(this.sked, { qrgMHz: c.freqMHz, skedQrg: this.kst.skedQrg(c.band), mode: c.mode, loc: this.meta?.myGrid ?? '' })
  }

  /** "@CALL " (+ text) into the line, ready to finish and send. */
  private address(call: string | undefined, text = ''): void {
    if (!call) return
    this.input.value = `@${call} ${text}`
    this.input.focus()
    this.input.setSelectionRange(this.input.value.length, this.input.value.length)
  }

  private send(): void {
    const k = this.kst
    if (!this.input.value.trim()) return
    if (k.send(this.input.value)) {
      this.input.value = ''
      this.noticeEl.textContent = ''
    } else this.noticeEl.textContent = notSentWhy(k, this.input.value)
  }
}
