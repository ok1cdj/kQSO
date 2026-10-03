// M5-ESP32-keyer (CW over BLE): the pure part. Line framing both ways, the command /
// response protocol (PROTOCOL.md, proto 1), macro templates and the conversion to the
// keyer's character set. No DOM, no Bluetooth — the transport hands lines in and out
// (platform/…/keyer.ts), the UI drives it (ui/keyer.ts).

import type { ProfileId } from './model'

// --- framing -------------------------------------------------------------------

/** Received BLE notifications → whole lines (split on \n, trailing \r dropped). */
export class LineAssembler {
  private buf = ''

  push(text: string): string[] {
    this.buf += text
    const parts = this.buf.split('\n')
    this.buf = parts.pop() ?? ''
    return parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
  }

  reset(): void {
    this.buf = ''
  }
}

/** One command line (with its \n) cut into writes of at most `size` bytes. The text is
 *  already in the keyer's ASCII set, so characters = bytes. */
export function chunk(line: string, size: number): string[] {
  const n = Math.max(1, Math.floor(size))
  const out: string[] = []
  for (let i = 0; i < line.length; i += n) out.push(line.slice(i, i + n))
  return out
}

// --- protocol ------------------------------------------------------------------

/** Longest SEND text per line: the keyer drops lines over 256 characters. */
export const SEND_MAX = 240
export const WPM_MIN = 5
export const WPM_MAX = 50
export const WPM_DEFAULT = 22

export type KeyerEvent =
  | { readonly type: 'done' } // queue sent completely
  | { readonly type: 'stopped' } // STOP or the keyer's button
  | { readonly type: 'error'; readonly what: string } // ERR char | full | watchdog (async)
  | { readonly type: 'wpm'; readonly wpm: number } // speed changed on the keyer itself

/** Asynchronous message, or undefined for a command response. The two never overlap:
 *  a response to WPM is OK, so a bare "WPM n" is always the keyer's own change. */
export function asyncEvent(line: string): KeyerEvent | undefined {
  const l = line.trim().toUpperCase()
  if (l === 'DONE') return { type: 'done' }
  if (l === 'STOPPED') return { type: 'stopped' }
  const err = /^ERR (CHAR|FULL|WATCHDOG)$/.exec(l)
  if (err) return { type: 'error', what: err[1]!.toLowerCase() }
  const wpm = /^WPM (\d+)$/.exec(l)
  if (wpm) return { type: 'wpm', wpm: Number(wpm[1]) }
  return undefined
}

interface Pending {
  readonly resolve: (line: string) => void
  readonly reject: (e: Error) => void
}

/**
 * Commands out, responses in. The keyer answers every command with exactly one line,
 * in order, so responses are matched first-in first-out; asynchronous messages may
 * arrive in between. Commands are written straight away (no waiting for the previous
 * response), so STOP is never stuck behind a SEND.
 */
export class KeyerProtocol {
  private readonly pending: Pending[] = []
  private readonly lines = new LineAssembler()
  /** True from an accepted SEND until DONE / STOPPED / watchdog / disconnect. */
  sending = false
  /** Current speed as last set or reported; undefined until known. */
  wpm: number | undefined
  /** Firmware version from VER, e.g. "2.0.0". */
  version: string | undefined

  constructor(
    private readonly write: (line: string) => void,
    private readonly onEvent: (e: KeyerEvent) => void = () => {},
  ) {}

  /** Feed received text (any split). */
  receive(text: string): void {
    for (const line of this.lines.push(text)) this.onLine(line)
  }

  /** Send one command line; resolves with the response line (OK, ERR …, IDLE …). */
  command(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.write(`${cmd}\n`)
    })
  }

  /** Queue text for sending, split into SEND lines of at most SEND_MAX characters.
   *  The keyer's queue just appends, so a part that follows queued text starts with a
   *  space (the next SEND line, a macro while the last one is on the air, a typed word). */
  async send(text: string): Promise<void> {
    for (const part of splitWords(text, SEND_MAX)) {
      const sep = this.sending ? ' ' : ''
      // Sending from the write on: OK and DONE can arrive in one notification, and
      // DONE must not be overtaken by a late "sending = true".
      this.sending = true
      const r = await this.command(`SEND ${sep}${part}`)
      if (r !== 'OK') {
        this.sending = false
        throw new Error(r)
      }
    }
  }

  async setWpm(n: number): Promise<void> {
    const r = await this.command(`WPM ${n}`)
    if (r !== 'OK') throw new Error(r)
    this.wpm = n
  }

  async stop(): Promise<void> {
    await this.command('STOP')
    this.sending = false
  }

  async ver(): Promise<void> {
    const r = await this.command('VER')
    this.version = /^VER \S+ (\S+)/.exec(r)?.[1]
  }

  /** Link gone: fail what is still waiting, forget the half line, nothing is sending. */
  reset(): void {
    for (const p of this.pending.splice(0)) p.reject(new Error('disconnected'))
    this.lines.reset()
    this.sending = false
  }

  private onLine(line: string): void {
    const ev = asyncEvent(line)
    if (ev) {
      if (ev.type === 'done' || ev.type === 'stopped') this.sending = false
      if (ev.type === 'error' && ev.what === 'watchdog') this.sending = false
      if (ev.type === 'wpm') this.wpm = ev.wpm
      this.onEvent(ev)
      return
    }
    this.pending.shift()?.resolve(line.trim())
  }
}

/** Split at spaces into parts of at most `max` characters (a longer word is cut). */
function splitWords(text: string, max: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(' ').filter((w) => w.length > 0)) {
    for (let w = word; w.length > 0; ) {
      const piece = w.slice(0, max)
      w = w.slice(max)
      if (cur.length === 0) cur = piece
      else if (cur.length + 1 + piece.length <= max) cur += ` ${piece}`
      else {
        out.push(cur)
        cur = piece
      }
    }
  }
  if (cur.length > 0) out.push(cur)
  return out
}

// --- characters ----------------------------------------------------------------

/**
 * To the keyer's set: upper case, A–Z 0–9 / ? . , = + - and spaces; prosigns in angle
 * brackets (<AR>, <SK>…) stay. Anything else is dropped and listed once, so the UI can
 * say what went missing (diacritics: "Č").
 */
export function sanitize(text: string): { text: string; dropped: string[] } {
  const dropped: string[] = []
  let out = ''
  const s = text.toUpperCase().replace(/\s+/g, ' ')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '<') {
      const m = /^<[A-Z]{2,3}>/.exec(s.slice(i))
      if (m) {
        out += m[0]
        i += m[0].length - 1
        continue
      }
    }
    if (/[A-Z0-9/?.,=+\- ]/.test(c)) out += c
    else if (!dropped.includes(c)) dropped.push(c)
  }
  return { text: out.replace(/ +/g, ' ').trim(), dropped }
}

// --- macros --------------------------------------------------------------------

// INFO = what the profile gives on request: my reference (activation), my locator
// (VHF, satellite); in the general profile free text (name, QTH…), empty until set in
// Settings. Its button label follows the profile (infoLabel).
// No AGN slot: `?` asks for a repeat just as well.
// NR? / LOC? / NRLOC?: ESM only — asked when an empty Enter can't save a VHF contest QSO
// for the missing number / locator; not in the strip.
export type MacroSlot = 'CQ' | 'EXCH' | 'TU' | 'MYCALL' | 'INFO' | '?' | 'NR?' | 'LOC?' | 'NRLOC?'
export const MACRO_SLOTS: readonly MacroSlot[] = ['CQ', 'EXCH', 'TU', 'MYCALL', 'INFO', '?', 'NR?', 'LOC?', 'NRLOC?']
export const ESM_ONLY_SLOTS: readonly MacroSlot[] = ['NR?', 'LOC?', 'NRLOC?']
export type RunMode = 'run' | 'sp'
export type MacroSet = Readonly<Record<MacroSlot, string>>

/** Values for the {…} placeholders. Missing ones expand to nothing. */
export interface MacroContext {
  readonly call?: string | undefined // worked station: the call being logged, else the one just saved
  readonly myCall: string
  readonly myLoc: string
  readonly myRef?: string | undefined
  readonly rst: string // sent report
  readonly nr: string // my next sent serial, 001
  readonly loc?: string | undefined // their locator
  readonly ref?: string | undefined // their reference
  readonly hi?: string | undefined // greeting by the local time, greeting()
}

/** {HI}: GM from midnight to noon, GA until 18:00, GE until midnight — local time on the device. */
export function greeting(now: Date): string {
  const h = now.getHours()
  return h < 12 ? 'GM' : h >= 12 && h < 18 ? 'GA' : 'GE'
}

/** The CQ slot's button / editor label: CQ in RUN, DE in S&P. */
export function cqLabel(mode: RunMode): string {
  return mode === 'run' ? 'CQ' : 'DE'
}

/** The INFO button / editor label for a profile. */
export function infoLabel(profile: ProfileId): string {
  return profile === 'aktivace' ? 'REF' : profile === 'obecny' ? 'INFO' : 'LOC'
}

const CQ_DEFAULT = 'CQ CQ DE {MYCALL} {MYCALL} K'
const ASK = { 'NR?': 'NR ?', 'LOC?': 'LOC ?', 'NRLOC?': 'NR LOC ?' } as const

const RUN: Readonly<Record<ProfileId, MacroSet>> = {
  aktivace: { CQ: 'CQ CQ DE {MYCALL} {MYCALL} {MYREF} K', EXCH: '{CALL} {RST}', TU: 'TU {MYCALL}', MYCALL: '{MYCALL}', INFO: '{MYREF}', '?': '?', ...ASK },
  vkv: { CQ: 'CQ TEST {MYCALL} {MYCALL} TEST', EXCH: '{CALL} {RST} {NR} {MYLOC} K', TU: 'TU {MYCALL} TEST', MYCALL: '{MYCALL}', INFO: '{MYLOC}', '?': '?', ...ASK },
  obecny: { CQ: CQ_DEFAULT, EXCH: '{CALL} {RST}', TU: 'TU {MYCALL}', MYCALL: '{MYCALL}', INFO: '', '?': '?', ...ASK },
  sat: { CQ: CQ_DEFAULT, EXCH: '{CALL} UR {RST} {MYLOC}', TU: 'TU {MYCALL}', MYCALL: '{MYCALL}', INFO: '{MYLOC}', '?': '?', ...ASK },
}

// S&P: I answer someone's CQ, so their call is not repeated in the exchange. The CQ slot
// is "DE" here: calling the station by its call (it didn't hear me, a pile-up). ESM in
// S&P still sends only MYCALL.
const SP: Readonly<Record<ProfileId, MacroSet>> = {
  aktivace: { CQ: '{CALL} DE {MYCALL}', EXCH: 'TU {RST}', TU: 'TU 73', MYCALL: '{MYCALL}', INFO: '{MYREF}', '?': '?', ...ASK },
  vkv: { CQ: '{CALL} DE {MYCALL}', EXCH: 'TU {RST} {NR} {MYLOC} K', TU: 'TU 73', MYCALL: '{MYCALL}', INFO: '{MYLOC}', '?': '?', ...ASK },
  obecny: { CQ: '{CALL} DE {MYCALL}', EXCH: 'TU {RST}', TU: 'TU 73', MYCALL: '{MYCALL}', INFO: '', '?': '?', ...ASK },
  sat: { CQ: '{CALL} DE {MYCALL}', EXCH: 'TU UR {RST} {MYLOC}', TU: 'TU 73', MYCALL: '{MYCALL}', INFO: '{MYLOC}', '?': '?', ...ASK },
}

export const DEFAULT_MACROS: Readonly<Record<ProfileId, Readonly<Record<RunMode, MacroSet>>>> = {
  aktivace: { run: RUN.aktivace, sp: SP.aktivace },
  vkv: { run: RUN.vkv, sp: SP.vkv },
  obecny: { run: RUN.obecny, sp: SP.obecny },
  sat: { run: RUN.sat, sp: SP.sat },
}

/** The user's edits, only the changed slots: { [profile]: { run: {slot: text}, sp: … } }. */
export type SavedMacros = Partial<Record<ProfileId, Partial<Record<RunMode, Partial<Record<MacroSlot, string>>>>>>

/** Read the keyerMacros setting. Tolerant: bad JSON or wrong types give no edits. */
export function parseMacros(json: string | null): SavedMacros {
  if (!json) return {}
  try {
    const v = JSON.parse(json) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as SavedMacros) : {}
  } catch {
    return {}
  }
}

/** The text for a slot: the user's edit when there is one, else the default. */
export function macroFor(saved: SavedMacros, profile: ProfileId, mode: RunMode, slot: MacroSlot): string {
  const own = saved[profile]?.[mode]?.[slot]
  return typeof own === 'string' ? own : DEFAULT_MACROS[profile][mode][slot]
}

/** Store one slot; a text equal to the default removes the edit, so new defaults apply. */
export function withMacro(saved: SavedMacros, profile: ProfileId, mode: RunMode, slot: MacroSlot, text: string): SavedMacros {
  const p = { ...saved[profile] }
  const m = { ...p[mode] }
  if (text === DEFAULT_MACROS[profile][mode][slot]) delete m[slot]
  else m[slot] = text
  p[mode] = m
  return { ...saved, [profile]: p }
}

/** Back to the defaults for one profile × mode. */
export function resetMacros(saved: SavedMacros, profile: ProfileId, mode: RunMode): SavedMacros {
  const p = { ...saved[profile] }
  delete p[mode]
  return { ...saved, [profile]: p }
}

/** Fill the {…} placeholders (case-insensitive); unknown ones are left as typed. */
export function expandMacro(template: string, ctx: MacroContext): string {
  const vars: Record<string, string | undefined> = {
    CALL: ctx.call,
    MYCALL: ctx.myCall,
    MYLOC: ctx.myLoc,
    MYREF: ctx.myRef,
    RST: ctx.rst,
    NR: ctx.nr,
    LOC: ctx.loc,
    REF: ctx.ref,
    HI: ctx.hi,
  }
  return template
    .replace(/\{([A-Za-z]+)\}/g, (all, name: string) => {
      const key = name.toUpperCase()
      return key in vars ? (vars[key] ?? '') : all
    })
    .replace(/ +/g, ' ')
    .trim()
}

export function clampWpm(n: number): number {
  return Math.min(WPM_MAX, Math.max(WPM_MIN, Math.round(n)))
}

// --- ESM (Enter Sends Message) -----------------------------------------------------

/** The line and the QSO just before Enter. */
export interface EsmBefore {
  readonly lineEmpty: boolean
  readonly hadContent: boolean // an unfinished QSO (anything typed besides the time)
  readonly hadCall: boolean
}

/** What Enter did. */
export interface EsmAfter {
  readonly committed: boolean
  readonly hasCall: boolean
  readonly missing: readonly ('NR' | 'LOC')[] // missingParts after Enter
}

/**
 * The macro Enter sends in ESM (docs/keyer.md, "Co odešle Enter"), or null for none.
 * Decided from what the reducer did, not from the text: the first callsign, a save,
 * a save refused for the missing number / locator.
 */
export function esmMessage(mode: RunMode, before: EsmBefore, after: EsmAfter): MacroSlot | null {
  const run = mode === 'run'
  if (!before.lineEmpty) {
    // Typed Enter: only the one that brings the callsign answers; filling in is silent.
    return !before.hadCall && after.hasCall ? (run ? 'EXCH' : 'MYCALL') : null
  }
  if (!before.hadContent) return run ? 'CQ' : 'MYCALL'
  if (after.committed) return run ? 'TU' : 'EXCH'
  if (!after.hasCall) return null
  const nr = after.missing.includes('NR')
  const loc = after.missing.includes('LOC')
  return nr && loc ? 'NRLOC?' : nr ? 'NR?' : loc ? 'LOC?' : null
}
