import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  FrameAssembler,
  Ic705Protocol,
  encodeFreq,
  decodeFreq,
  freqMHz,
  modeFromCiv,
  civModeFor,
  CIV_MODE,
  hsId,
  hsName,
  hsToken,
  setFreq,
  setWpm,
  sendCw,
  stopCw,
  cwChunks,
  cwDurationMs,
  CivCwOutput,
} from '../src/core/civ'
import type { RigEvent } from '../src/core/civ'
import type { KeyerEvent } from '../src/core/keyer'
import { bandForFreq, bandSpot } from '../src/core/dictionaries'
import { applyRadio } from '../src/core/sticky'

// Through globalThis at call time, so vi.useFakeTimers() applies.
const g = globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown; clearTimeout(id: unknown): void }
const timers = { set: (f: () => void, ms: number) => g.setTimeout(f, ms), clear: (id: unknown) => g.clearTimeout(id) }
const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b)
const hex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join(' ')

describe('BCD frequency', () => {
  it('encodes least significant pair first', () => {
    expect(encodeFreq(14_074_000)).toEqual([0x00, 0x40, 0x07, 0x14, 0x00])
    expect(encodeFreq(432_200_000)).toEqual([0x00, 0x00, 0x20, 0x32, 0x04])
  })
  it('round-trips', () => {
    for (const hz of [1_830_000, 7_012_345, 145_500_000, 433_500_000]) expect(decodeFreq(Uint8Array.from(encodeFreq(hz)))).toBe(hz)
  })
  it('formats ADIF MHz', () => {
    expect(freqMHz(14_025_300)).toBe('14.025300')
  })
})

describe('FrameAssembler', () => {
  it('splits several frames in one notification', () => {
    const a = new FrameAssembler()
    const f = a.push(bytes(0xfe, 0xfe, 0xe0, 0xa4, 0xfb, 0xfd, 0xfe, 0xfe, 0x00, 0xa4, 0x01, 0x03, 0x01, 0xfd))
    expect(f).toHaveLength(2)
    expect(f[0]).toMatchObject({ kind: 'civ', to: 0xe0, from: 0xa4, cmd: 0xfb })
    expect(f[1]).toMatchObject({ kind: 'civ', to: 0x00, cmd: 0x01 })
  })
  it('joins a frame split over notifications, drops noise and extra preambles', () => {
    const a = new FrameAssembler()
    expect(a.push(bytes(0x55, 0xfe, 0xfe, 0xfe, 0xe0, 0xa4, 0x03, 0x00))).toEqual([])
    const f = a.push(bytes(0x40, 0x07, 0x14, 0x00, 0xfd))
    expect(f).toHaveLength(1)
    expect(f[0]!.kind === 'civ' && decodeFreq(f[0]!.data)).toBe(14_074_000)
  })
  it('reads Bluetooth handshake frames', () => {
    const f = new FrameAssembler().push(bytes(0xfe, 0xf1, 0x00, 0x64, 0xfd))
    expect(f).toEqual([{ kind: 'bt', code: 0x64, data: new Uint8Array(0) }])
  })
})

describe('handshake frames', () => {
  it('id is the ASCII uuid, name exactly 16 bytes, fixed token', () => {
    const id = hsId('00001101-0000-1000-8000-00805F9B34FB')
    expect(id.length).toBe(41)
    expect(hex(id.slice(0, 6))).toBe('fe f1 00 61 30 30')
    expect(hsName('kQSO').length).toBe(21)
    expect(hsName('a very long device name').length).toBe(21)
    expect(hex(hsToken())).toBe('fe f1 00 63 ee 39 09 10 fd')
  })
})

describe('modes', () => {
  it('maps radio modes to kQSO, ignores the rest', () => {
    expect(modeFromCiv(CIV_MODE.USB)).toBe('SSB')
    expect(modeFromCiv(CIV_MODE.LSB)).toBe('SSB')
    expect(modeFromCiv(CIV_MODE.CWR)).toBe('CW')
    expect(modeFromCiv(CIV_MODE.WFM)).toBe('FM')
    expect(modeFromCiv(CIV_MODE.AM)).toBeUndefined()
    expect(modeFromCiv(CIV_MODE.DV)).toBeUndefined()
  })
  it('SSB is LSB below 10 MHz except 60 m', () => {
    expect(civModeFor('SSB', 7_100_000)).toBe(CIV_MODE.LSB)
    expect(civModeFor('SSB', 5_360_000)).toBe(CIV_MODE.USB)
    expect(civModeFor('SSB', 14_200_000)).toBe(CIV_MODE.USB)
    expect(civModeFor('CW', 7_020_000)).toBe(CIV_MODE.CW)
  })
})

describe('bands', () => {
  it('frequency → band', () => {
    expect(bandForFreq(14_074_000)).toBe('20m')
    expect(bandForFreq(145_500_000)).toBe('2m')
    expect(bandForFreq(11_000_000)).toBeUndefined()
  })
  it('default spot per band and mode', () => {
    expect(bandSpot('40m', 'CW')).toBe(7_020_000)
    expect(bandSpot('30m', 'SSB')).toBeUndefined()
    expect(bandSpot('23cm', 'CW')).toBeUndefined()
  })
})

describe('commands', () => {
  it('builds frames to A4 from E0', () => {
    expect(hex(setFreq(14_074_000))).toBe('fe fe a4 e0 05 00 40 07 14 00 fd')
    expect(hex(stopCw())).toBe('fe fe a4 e0 17 ff fd')
    expect(hex(sendCw('CQ'))).toBe('fe fe a4 e0 17 43 51 fd')
  })
  it('key speed 6–48 WPM → 0000–0255 BCD', () => {
    expect(hex(setWpm(6))).toBe('fe fe a4 e0 14 0c 00 00 fd')
    expect(hex(setWpm(48))).toBe('fe fe a4 e0 14 0c 02 55 fd')
    expect(hex(setWpm(20))).toBe('fe fe a4 e0 14 0c 00 85 fd')
    expect(hex(setWpm(99))).toBe('fe fe a4 e0 14 0c 02 55 fd')
  })
})

describe('cwChunks', () => {
  it('keeps short text whole, maps prosigns', () => {
    expect(cwChunks('TU <AR>')).toEqual(['TU +'])
    expect(cwChunks('5NN <BT> <KN> <SK>')).toEqual(['5NN = ( ^SK'])
  })
  it('cuts at spaces into parts of at most 30 characters', () => {
    const text = 'CQ CQ CQ DE OK1CDJ OK1CDJ OK1CDJ CQ CQ DE OK1CDJ K'
    const parts = cwChunks(text)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 30)).toBe(true)
    expect(parts.slice(0, -1).every((p) => p.endsWith(' '))).toBe(true)
    expect(parts.join('')).toBe(text)
  })
  it('estimates on-air time', () => {
    expect(cwDurationMs('PARIS', 20)).toBe(3000)
  })
})

describe('Ic705Protocol', () => {
  afterEach(() => vi.useRealTimers())

  it('handshakes, then is ready after 0x64', async () => {
    vi.useFakeTimers()
    const out: Uint8Array[] = []
    const events: RigEvent[] = []
    const p = new Ic705Protocol((b) => out.push(b), (e) => events.push(e), timers)
    const done = p.handshake('id', 'kQSO')
    await vi.advanceTimersByTimeAsync(50)
    expect(out.map((b) => b[3])).toEqual([0x61, 0x62, 0x63])
    p.receive(bytes(0xfe, 0xf1, 0x00, 0x63, 0x00, 0xfd, 0xfe, 0xf1, 0x00, 0x64, 0xfd))
    await vi.advanceTimersByTimeAsync(400)
    await done
    expect(p.ready).toBe(true)
    expect(events).toEqual([{ type: 'ready' }])
  })

  it('matches replies in order, reports reads and transceive, skips echo', async () => {
    const events: RigEvent[] = []
    const out: Uint8Array[] = []
    const p = new Ic705Protocol((b) => out.push(b), (e) => events.push(e), timers)
    const read = p.command(Uint8Array.from([0xfe, 0xfe, 0xa4, 0xe0, 0x03, 0xfd]))
    const set = p.command(Uint8Array.from([0xfe, 0xfe, 0xa4, 0xe0, 0x06, 0x03, 0xfd]))
    p.receive(bytes(0xfe, 0xfe, 0xa4, 0xe0, 0x03, 0xfd)) // echo of our own command
    expect(out).toHaveLength(1) // the second waits for the first reply
    p.receive(bytes(0xfe, 0xfe, 0xe0, 0xa4, 0x03, 0x00, 0x40, 0x07, 0x14, 0x00, 0xfd))
    expect(out).toHaveLength(2)
    p.receive(bytes(0xfe, 0xfe, 0xe0, 0xa4, 0xfb, 0xfd))
    expect(decodeFreq(await read)).toBe(14_074_000)
    expect((await set).length).toBe(0)
    p.receive(bytes(0xfe, 0xfe, 0x00, 0xa4, 0x01, 0x03, 0x01, 0xfd))
    expect(events).toEqual([
      { type: 'freq', hz: 14_074_000 },
      { type: 'mode', code: 0x03 },
    ])
  })

  it('rejects on FA and on reset', async () => {
    const p = new Ic705Protocol(() => {}, () => {}, timers)
    const a = p.command(setFreq(1))
    p.receive(bytes(0xfe, 0xfe, 0xe0, 0xa4, 0xfa, 0xfd))
    await expect(a).rejects.toThrow('rejected')
    const b = p.command(setFreq(1))
    p.reset()
    await expect(b).rejects.toThrow('disconnected')
  })
})

describe('CivCwOutput', () => {
  afterEach(() => vi.useRealTimers())

  /** A radio answering reads from `state`; records the CW parts it was given. */
  function radio(state: { mode: number; breakIn: number; tx: number[] }) {
    const sent: string[] = []
    const command = async (f: Uint8Array): Promise<Uint8Array> => {
      const cmd = f[4]!
      if (cmd === 0x04) return bytes(state.mode, 0x01)
      if (cmd === 0x16) return bytes(0x47, state.breakIn)
      if (cmd === 0x1c) return bytes(0x00, state.tx.shift() ?? 0)
      if (cmd === 0x17 && f[5] !== 0xff) sent.push(String.fromCharCode(...f.slice(5, -1)))
      return new Uint8Array(0)
    }
    return { command, sent }
  }

  it('refuses outside CW, sends without break-in (sidetone only)', async () => {
    const r1 = radio({ mode: CIV_MODE.USB, breakIn: 1, tx: [] })
    await expect(new CivCwOutput(r1, timers, () => {}).send('CQ')).rejects.toThrow('mode')
    const r2 = radio({ mode: CIV_MODE.CW, breakIn: 0, tx: [] })
    await new CivCwOutput(r2, timers, () => {}).send('CQ')
    await Promise.resolve()
    expect(r2.sent).toEqual(['CQ'])
  })

  it('hands over one part at a time, next after the radio is back on receive', async () => {
    vi.useFakeTimers()
    const r = radio({ mode: CIV_MODE.CW, breakIn: 1, tx: [1, 1, 0, 0] })
    const events: KeyerEvent[] = []
    const out = new CivCwOutput(r, timers, (e) => events.push(e))
    out.wpm = 30
    await out.send('CQ CQ CQ DE OK1CDJ OK1CDJ OK1CDJ CQ CQ DE OK1CDJ K')
    expect(out.sending).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(r.sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.sent.join('')).toBe('CQ CQ CQ DE OK1CDJ OK1CDJ OK1CDJ CQ CQ DE OK1CDJ K')
    expect(out.sending).toBe(false)
    expect(events).toEqual([{ type: 'done' }])
  })

  it('stop drops the queue', async () => {
    vi.useFakeTimers()
    const r = radio({ mode: CIV_MODE.CW, breakIn: 2, tx: [] })
    const events: KeyerEvent[] = []
    const out = new CivCwOutput(r, timers, (e) => events.push(e))
    await out.send('CQ CQ CQ DE OK1CDJ OK1CDJ OK1CDJ CQ CQ DE OK1CDJ K')
    await vi.advanceTimersByTimeAsync(10)
    await out.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.sent).toHaveLength(1)
    expect(events).toEqual([{ type: 'stopped' }])
  })
})

describe('applyRadio', () => {
  const s = { band: '40m', mode: 'SSB' }
  it('band and FREQ from the frequency, mode when logged', () => {
    expect(applyRadio(s, 14_025_300, 'CW')).toEqual({ band: '20m', mode: 'CW', freq: '14.025300' })
  })
  it('keeps the mode for modes kQSO does not log', () => {
    expect(applyRadio(s, 7_150_000, undefined)).toEqual({ band: '40m', mode: 'SSB', freq: '7.150000' })
  })
  it('outside the bands, or without the radio, FREQ goes', () => {
    expect(applyRadio({ ...s, freq: '7.1' }, 11_000_000, 'SSB')).toEqual({ band: '40m', mode: 'SSB' })
    expect(applyRadio({ ...s, freq: '7.1' }, undefined, undefined)).toEqual(s)
  })
})
