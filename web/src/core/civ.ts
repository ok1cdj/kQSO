// Icom CI-V over the IC-705's Bluetooth LE serial: the pure part. Frame assembly from
// BLE notifications, the Icom BLE handshake (FE F1 …), BCD frequencies, mode mapping and
// the commands kQSO uses. No Bluetooth here — the transport hands bytes in and out
// (platform/native.ts), the UI drives it (ui/rig.ts).
//
import type { CwOutput, KeyerEvent } from './keyer'

// Protocol facts: IC-705 CI-V Reference Guide (Icom, 2020-07); the BLE handshake as
// reverse-engineered by JN4JXL and used by K7MDL2's IC-705 BLE examples.

export const RIG_ADDR = 0xa4 // IC-705 default CI-V address
export const CTRL_ADDR = 0xe0 // us
const BROADCAST = 0x00 // transceive frames (frequency / mode changed on the radio)

const PRE = 0xfe
const BT = 0xf1 // second preamble byte of the Bluetooth handshake frames
const END = 0xfd
const OK = 0xfb
const NG = 0xfa

// --- framing -------------------------------------------------------------------

export type Frame =
  | { readonly kind: 'civ'; readonly to: number; readonly from: number; readonly cmd: number; readonly data: Uint8Array }
  | { readonly kind: 'bt'; readonly code: number; readonly data: Uint8Array }

/** Received notifications → whole frames. One notification may carry several frames,
 *  and a frame may be split over notifications; bytes outside a frame are dropped. */
export class FrameAssembler {
  private buf: number[] = []

  push(bytes: Uint8Array): Frame[] {
    const out: Frame[] = []
    for (const b of bytes) {
      if (this.buf.length === 0 && b !== PRE) continue
      if (this.buf.length === 2 && this.buf[1] === PRE && b === PRE) continue // extra preamble
      this.buf.push(b)
      if (this.buf.length === 2 && b !== PRE && b !== BT) this.buf = []
      else if (b === END) {
        const f = toFrame(this.buf)
        if (f) out.push(f)
        this.buf = []
      }
    }
    return out
  }

  reset(): void {
    this.buf = []
  }
}

function toFrame(b: number[]): Frame | undefined {
  if (b[1] === BT) {
    // FE F1 00 <code> … FD
    if (b.length < 5) return undefined
    return { kind: 'bt', code: b[3]!, data: Uint8Array.from(b.slice(4, -1)) }
  }
  if (b.length < 6) return undefined
  return { kind: 'civ', to: b[2]!, from: b[3]!, cmd: b[4]!, data: Uint8Array.from(b.slice(5, -1)) }
}

/** A CI-V command frame to the radio. */
export function civFrame(cmd: number, ...data: number[]): Uint8Array {
  return Uint8Array.from([PRE, PRE, RIG_ADDR, CTRL_ADDR, cmd, ...data, END])
}

// --- Bluetooth handshake -------------------------------------------------------

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0) & 0x7f)

/** 0x61: who we are. The radio keys its pairing on this id together with the name,
 *  so the id is one random UUID per install. */
export function hsId(clientId: string): Uint8Array {
  return Uint8Array.from([PRE, BT, 0x00, 0x61, ...ascii(clientId), END])
}

/** 0x62: the name shown on the radio, exactly 16 bytes. */
export function hsName(name: string): Uint8Array {
  return Uint8Array.from([PRE, BT, 0x00, 0x62, ...ascii(name.slice(0, 16).padEnd(16, ' ')), END])
}

/** 0x63: fixed token that starts the session. */
export function hsToken(): Uint8Array {
  return Uint8Array.from([PRE, BT, 0x00, 0x63, 0xee, 0x39, 0x09, 0x10, END])
}

/** 0x64 from the radio: CI-V access granted. */
export const HS_READY = 0x64

// --- frequency -----------------------------------------------------------------

/** Hz → 5 bytes BCD, least significant pair first (14 074 000 → 00 40 07 14 00). */
export function encodeFreq(hz: number): number[] {
  let n = Math.round(hz)
  const out: number[] = []
  for (let i = 0; i < 5; i++) {
    const lo = n % 10
    const hi = Math.floor(n / 10) % 10
    out.push((hi << 4) | lo)
    n = Math.floor(n / 100)
  }
  return out
}

export function decodeFreq(b: Uint8Array): number {
  let hz = 0
  for (let i = Math.min(b.length, 5) - 1; i >= 0; i--) hz = hz * 100 + (b[i]! >> 4) * 10 + (b[i]! & 0x0f)
  return hz
}

/** ADIF FREQ: MHz with 6 decimals (Hz resolution). */
export function freqMHz(hz: number): string {
  return (hz / 1e6).toFixed(6)
}

// --- modes ---------------------------------------------------------------------

export const CIV_MODE = { LSB: 0x00, USB: 0x01, AM: 0x02, CW: 0x03, RTTY: 0x04, FM: 0x05, WFM: 0x06, CWR: 0x07, RTTYR: 0x08, DV: 0x17 } as const

/** Radio mode → kQSO mode; undefined for modes kQSO doesn't log (AM, RTTY, DV): the
 *  sticky mode stays as it was. */
export function modeFromCiv(code: number): string | undefined {
  switch (code) {
    case CIV_MODE.LSB:
    case CIV_MODE.USB:
      return 'SSB'
    case CIV_MODE.CW:
    case CIV_MODE.CWR:
      return 'CW'
    case CIV_MODE.FM:
    case CIV_MODE.WFM:
      return 'FM'
    default:
      return undefined
  }
}

/** kQSO mode → radio mode at a frequency. SSB is LSB below 10 MHz except 60 m. */
export function civModeFor(mode: string, hz: number): number | undefined {
  if (mode === 'CW') return CIV_MODE.CW
  if (mode === 'FM') return CIV_MODE.FM
  if (mode === 'SSB') return hz < 10_000_000 && !(hz >= 5_060_000 && hz <= 5_450_000) ? CIV_MODE.LSB : CIV_MODE.USB
  return undefined
}

// --- commands ------------------------------------------------------------------

export const CMD = {
  freqTx: 0x00, // transceive: frequency changed
  modeTx: 0x01, // transceive: mode changed
  readFreq: 0x03,
  readMode: 0x04,
  setFreq: 0x05,
  setMode: 0x06,
  level: 0x14,
  func: 0x16,
  cw: 0x17,
  setting: 0x1a,
  tx: 0x1c,
  voice: 0x28,
} as const

export const readFreq = (): Uint8Array => civFrame(CMD.readFreq)
export const readMode = (): Uint8Array => civFrame(CMD.readMode)
export const setFreq = (hz: number): Uint8Array => civFrame(CMD.setFreq, ...encodeFreq(hz))
export const setMode = (code: number): Uint8Array => civFrame(CMD.setMode, code)
/** TX state: 00 receive, 01 transmit. */
export const readTx = (): Uint8Array => civFrame(CMD.tx, 0x00)
/** Menu 0131 "CI-V Transceive" on, so the radio reports its own changes. */
export const transceiveOn = (): Uint8Array => civFrame(CMD.setting, 0x05, 0x01, 0x31, 0x01)
// Band stacking register (1A 01): the radio's own last frequency and mode per band — what
// its band key returns to. Band codes from the CI-V guide; 60 m and 4 m have none (GENE).
const BAND_STACK: Readonly<Record<string, number>> = {
  '160m': 0x01,
  '80m': 0x02,
  '40m': 0x03,
  '30m': 0x04,
  '20m': 0x05,
  '17m': 0x06,
  '15m': 0x07,
  '12m': 0x08,
  '10m': 0x09,
  '6m': 0x10,
  '2m': 0x13,
  '70cm': 0x14,
}

/** Read the newest band stacking register (register 01) of a band, or undefined when
 *  the radio has none for it. */
export function readBandStack(band: string): Uint8Array | undefined {
  const code = BAND_STACK[band]
  return code === undefined ? undefined : civFrame(CMD.setting, 0x01, code, 0x01)
}

/** Reply data of readBandStack (01 <band> <register> <freq ×5> <mode> …) → frequency and
 *  radio mode code. */
export function parseBandStack(data: Uint8Array): { hz: number; code: number } | undefined {
  if (data.length < 9 || data[0] !== 0x01) return undefined
  return { hz: decodeFreq(data.slice(3, 8)), code: data[8]! }
}

/** Voice TX memory (28 00): 1–8 = transmit T1–T8, 0 = stop. Phone modes only. */
export const playVoice = (n: number): Uint8Array => civFrame(CMD.voice, 0x00, n)
export const sendCw = (text: string): Uint8Array => civFrame(CMD.cw, ...ascii(text))
export const stopCw = (): Uint8Array => civFrame(CMD.cw, 0xff)

export const CIV_WPM_MIN = 6
export const CIV_WPM_MAX = 48

/** Key speed (14 0C): 0000–0255 spans 6–48 WPM, as 2 bytes BCD. */
export function setWpm(wpm: number): Uint8Array {
  const w = Math.min(CIV_WPM_MAX, Math.max(CIV_WPM_MIN, wpm))
  const v = Math.round(((w - CIV_WPM_MIN) * 255) / (CIV_WPM_MAX - CIV_WPM_MIN))
  return civFrame(CMD.level, 0x0c, Math.floor(v / 100), ((Math.floor(v / 10) % 10) << 4) | v % 10)
}

// --- CW text -------------------------------------------------------------------

/** Characters per 0x17 command. */
export const CW_CHUNK = 30

// Prosigns with a character of their own on the radio; others are sent joined (^).
const PROSIGNS: Readonly<Record<string, string>> = { AR: '+', BT: '=', KN: '(' }

/** Sanitized keyer text (sanitize() in core/keyer.ts) → 0x17 messages of at most 30
 *  characters, cut at spaces. Every part but the last keeps a trailing space, so words
 *  don't run together across messages. */
export function cwChunks(text: string): string[] {
  const s = text.replace(/<([A-Z]{2,3})>/g, (_, p: string) => PROSIGNS[p] ?? `^${p}`)
  const out: string[] = []
  let cur = ''
  for (const word of s.split(' ').filter((w) => w.length > 0)) {
    for (let w = word; w.length > 0; ) {
      const piece = w.slice(0, CW_CHUNK - 1)
      w = w.slice(CW_CHUNK - 1)
      if (cur.length === 0) cur = piece
      else if (cur.length + 1 + piece.length <= CW_CHUNK - 1) cur += ` ${piece}`
      else {
        out.push(`${cur} `)
        cur = piece
      }
    }
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/** Rough on-air time of a text in ms (PARIS: 50 dot units a word, dot = 1200 / WPM ms). */
export function cwDurationMs(text: string, wpm: number): number {
  return (text.length / 5) * 50 * (1200 / Math.max(1, wpm))
}

// --- protocol ------------------------------------------------------------------

export type RigEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'freq'; readonly hz: number }
  | { readonly type: 'mode'; readonly code: number }

/** Timers come from the host: the core has no DOM / Node globals. */
export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(id: unknown): void
}

interface Pending {
  readonly frame: Uint8Array
  readonly resolve: (data: Uint8Array) => void
  readonly reject: (e: Error) => void
  timer?: unknown // set when written
}

const HS_GAP_MS = 20 // between the handshake frames
const HS_SETTLE_MS = 300 // after 0x64, before the first CI-V command
const HS_TIMEOUT_MS = 5000
const CMD_TIMEOUT_MS = 2000

/**
 * Handshake, then commands out and replies in. One command at a time; FB / FA answers
 * it, a data reply answers it when the command matches (a poll's reply or a late one
 * is just an event). Transceive frames (to 00) and our own echo (BLE echoes every
 * command) are told apart by address.
 *
 * The IC-705 sends over BLE only after something is written to it — one notification
 * of up to ~10 frames per write. So the controller polls (poll()) while connected,
 * else replies and transceive frames wait in the radio.
 */
export class Ic705Protocol {
  private readonly frames = new FrameAssembler()
  private readonly pending: Pending[] = []
  private hs: { resolve: () => void; reject: (e: Error) => void } | undefined
  ready = false

  constructor(
    private readonly write: (bytes: Uint8Array) => void,
    private readonly onEvent: (e: RigEvent) => void,
    private readonly timers: Timers,
  ) {}

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => this.timers.set(r, ms))
  }

  receive(bytes: Uint8Array): void {
    for (const f of this.frames.push(bytes)) this.onFrame(f)
  }

  /** 0x61 → 0x62 → 0x63, resolves after the radio's 0x64. */
  async handshake(clientId: string, name: string): Promise<void> {
    const granted = new Promise<void>((resolve, reject) => {
      const timer = this.timers.set(() => {
        this.hs = undefined
        reject(new Error('handshake'))
      }, HS_TIMEOUT_MS)
      this.hs = {
        resolve: () => {
          this.timers.clear(timer)
          resolve()
        },
        reject: (e) => {
          this.timers.clear(timer)
          reject(e)
        },
      }
    })
    this.write(hsId(clientId))
    await this.sleep(HS_GAP_MS)
    this.write(hsName(name))
    await this.sleep(HS_GAP_MS)
    this.write(hsToken())
    await granted
    await this.sleep(HS_SETTLE_MS)
    this.ready = true
    this.onEvent({ type: 'ready' })
  }

  /** Send one command frame; resolves with the reply's data (empty for FB), rejects on
   *  FA or no reply. */
  command(frame: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.pending.push({ frame, resolve, reject })
      if (this.pending.length === 1) this.writeHead()
    })
  }

  /** Write a read without waiting for its reply (the reply is an event): keeps the
   *  radio's output flowing, see the class comment. */
  poll(frame: Uint8Array): void {
    if (this.ready) this.write(frame)
  }

  /** One command on the air at a time: the IC-705 over BLE drops a second one sent
   *  before the first is answered (seen: 03 + 04 back to back → only 03 answered). */
  private writeHead(): void {
    const p = this.pending[0]
    if (!p) return
    this.write(p.frame)
    p.timer = this.timers.set(() => {
      if (this.pending[0] !== p) return
      this.pending.shift()
      p.reject(new Error('timeout'))
      this.writeHead()
    }, CMD_TIMEOUT_MS)
  }

  /** Link gone: fail what is waiting, forget the half frame. */
  reset(): void {
    for (const p of this.pending.splice(0)) {
      this.timers.clear(p.timer)
      p.reject(new Error('disconnected'))
    }
    this.hs?.reject(new Error('disconnected'))
    this.hs = undefined
    this.frames.reset()
    this.ready = false
  }

  private onFrame(f: Frame): void {
    if (f.kind === 'bt') {
      if (f.code === HS_READY) this.hs?.resolve()
      return
    }
    if (f.from !== RIG_ADDR) return // our own echo, or another station on the bus
    if (f.to === BROADCAST) {
      this.event(f.cmd, f.data)
      return
    }
    if (f.to !== CTRL_ADDR) return
    if (f.cmd !== OK && f.cmd !== NG) this.event(f.cmd, f.data)
    const p = this.pending[0]
    if (!p || !answers(p.frame, f)) return
    this.pending.shift()
    this.timers.clear(p.timer)
    if (f.cmd === NG) p.reject(new Error('rejected'))
    else p.resolve(f.cmd === OK ? new Uint8Array(0) : f.data)
    this.writeHead()
  }

  private event(cmd: number, data: Uint8Array): void {
    if ((cmd === CMD.freqTx || cmd === CMD.readFreq) && data.length >= 5) this.onEvent({ type: 'freq', hz: decodeFreq(data) })
    if ((cmd === CMD.modeTx || cmd === CMD.readMode) && data.length >= 1) this.onEvent({ type: 'mode', code: data[0]! })
  }
}

/** Whether reply `f` answers command `frame`: FB / FA any command; data the same command
 *  (and sub-command for those that have one: 14, 16, 1A, 1C). */
function answers(frame: Uint8Array, f: Extract<Frame, { kind: 'civ' }>): boolean {
  if (f.cmd === OK || f.cmd === NG) return true
  if (f.cmd !== frame[4]) return false
  const sub = f.cmd === CMD.level || f.cmd === CMD.func || f.cmd === CMD.setting || f.cmd === CMD.tx
  return !sub || f.data[0] === frame[5]
}

// --- CW through the radio's keyer --------------------------------------------------

const TX_POLL_MS = 200
const TX_POLL_FROM = 0.9 // of the estimated on-air time
const TX_POLL_LIMIT = 1.5 // give up waiting after this much of the estimate (+1 s)

/**
 * CwOutput over CI-V 0x17. The radio says nothing when a message is done, so only one
 * part (≤ 30 characters) is handed over at a time: the next one goes when the radio is
 * back on receive (1C 00, two readings in a row — full break-in drops between
 * elements), polled from 90 % of the estimated time. A link lost mid-message thus
 * leaves at most that one part on the air.
 *
 * Before the first part the radio must be in CW (else error 'mode'). Break-in is up to
 * the operator: without it 0x17 keys only the sidetone, which is fine for practice.
 */
export class CivCwOutput implements CwOutput {
  sending = false
  wpm: number | undefined
  private queue: string[] = []
  private run = 0 // bumped by stop / reset: a running pump sees it and quits

  constructor(
    private readonly proto: Pick<Ic705Protocol, 'command'>,
    private readonly timers: Timers,
    private readonly onEvent: (e: KeyerEvent) => void,
  ) {}

  async send(text: string): Promise<void> {
    const parts = cwChunks(text)
    if (parts.length === 0) return
    if (this.sending) {
      // After queued text: a word space between them.
      const last = this.queue.length > 0 ? this.queue[this.queue.length - 1]! : undefined
      if (last !== undefined && !last.endsWith(' ')) this.queue[this.queue.length - 1] = `${last} `
      else if (last === undefined) parts[0] = ` ${parts[0]!}`
      this.queue.push(...parts)
      return
    }
    await this.check()
    this.queue = parts
    this.sending = true
    void this.pump(++this.run)
  }

  async setWpm(n: number): Promise<void> {
    const w = Math.min(CIV_WPM_MAX, Math.max(CIV_WPM_MIN, n))
    await this.proto.command(setWpm(w))
    this.wpm = w
  }

  async stop(): Promise<void> {
    this.run++
    this.queue = []
    await this.proto.command(stopCw())
    if (this.sending) {
      this.sending = false
      this.onEvent({ type: 'stopped' })
    }
  }

  reset(): void {
    this.run++
    this.queue = []
    this.sending = false
  }

  /** CW mode, or throw. */
  private async check(): Promise<void> {
    const mode = await this.proto.command(readMode())
    if (mode[0] !== CIV_MODE.CW && mode[0] !== CIV_MODE.CWR) throw new Error('mode')
  }

  private async pump(run: number): Promise<void> {
    try {
      while (run === this.run && this.queue.length > 0) {
        const part = this.queue.shift()!
        await this.proto.command(sendCw(part))
        await this.waitSent(run, cwDurationMs(part, this.wpm ?? 20))
      }
    } catch {
      if (run !== this.run) return
      this.run++
      this.queue = []
      this.sending = false
      this.onEvent({ type: 'error', what: 'send' })
      return
    }
    if (run !== this.run) return
    this.sending = false
    this.onEvent({ type: 'done' })
  }

  /** Until the radio is back on receive (or the estimate ran well over). */
  private async waitSent(run: number, estimate: number): Promise<void> {
    await this.sleep(estimate * TX_POLL_FROM)
    const giveUp = estimate * (TX_POLL_LIMIT - TX_POLL_FROM) + 1000
    let rx = 0
    for (let waited = 0; run === this.run && waited < giveUp; waited += TX_POLL_MS) {
      const tx = await this.proto.command(readTx()) // 00 <00 rx | 01 tx>
      rx = tx[1] === 0 ? rx + 1 : 0
      if (rx >= 2) return
      await this.sleep(TX_POLL_MS)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => this.timers.set(r, ms))
  }
}
