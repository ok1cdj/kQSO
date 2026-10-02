import { describe, it, expect } from 'vitest'
import {
  LineAssembler,
  chunk,
  KeyerProtocol,
  asyncEvent,
  sanitize,
  expandMacro,
  macroFor,
  withMacro,
  resetMacros,
  parseMacros,
  DEFAULT_MACROS,
} from '../src/core/keyer'
import type { KeyerEvent, MacroContext } from '../src/core/keyer'
import { matchKeyerCommand } from '../src/core/command'

describe('LineAssembler', () => {
  it('joins 20-byte notifications into lines, drops \\r and blank lines', () => {
    const a = new LineAssembler()
    expect(a.push('VER keyer 2.0.0 pro')).toEqual([])
    expect(a.push('to 1\r\nOK\n\nDO')).toEqual(['VER keyer 2.0.0 proto 1', 'OK'])
    expect(a.push('NE\n')).toEqual(['DONE'])
  })
})

describe('chunk', () => {
  it('cuts a line into MTU-sized writes', () => {
    const line = 'SEND CQ CQ DE OK1CDJ OK1CDJ K\n'
    const parts = chunk(line, 20)
    expect(parts.every((p) => p.length <= 20)).toBe(true)
    expect(parts.join('')).toBe(line)
    expect(chunk('OK\n', 20)).toEqual(['OK\n'])
  })
})

describe('asyncEvent', () => {
  it('tells asynchronous messages from responses', () => {
    expect(asyncEvent('DONE')).toEqual({ type: 'done' })
    expect(asyncEvent('STOPPED')).toEqual({ type: 'stopped' })
    expect(asyncEvent('ERR watchdog')).toEqual({ type: 'error', what: 'watchdog' })
    expect(asyncEvent('WPM 25')).toEqual({ type: 'wpm', wpm: 25 })
    expect(asyncEvent('OK')).toBeUndefined()
    expect(asyncEvent('ERR range')).toBeUndefined() // response to WPM
    expect(asyncEvent('IDLE WPM 22')).toBeUndefined() // response to STATUS
  })
})

describe('KeyerProtocol', () => {
  const setup = (): { p: KeyerProtocol; out: string[]; events: KeyerEvent[] } => {
    const out: string[] = []
    const events: KeyerEvent[] = []
    const p = new KeyerProtocol((l) => out.push(l), (e) => events.push(e))
    return { p, out, events }
  }

  it('matches responses in order, with async messages in between', async () => {
    const { p, out, events } = setup()
    const ver = p.ver()
    const wpm = p.setWpm(25)
    expect(out).toEqual(['VER\n', 'WPM 25\n'])
    p.receive('VER keyer 2.0.0 proto 1\nWP')
    p.receive('M 18\nOK\n') // keyer's own change arrives before the WPM response
    await ver
    await wpm
    expect(p.version).toBe('2.0.0')
    expect(p.wpm).toBe(25)
    expect(events).toEqual([{ type: 'wpm', wpm: 18 }])
  })

  it('SEND: sending until DONE; STOP is written at once', async () => {
    const { p, out } = setup()
    const s = p.send('CQ TEST')
    p.receive('OK\n')
    await s
    expect(p.sending).toBe(true)
    const stop = p.stop()
    expect(out[out.length - 1]).toBe('STOP\n')
    p.receive('OK\nSTOPPED\n')
    await stop
    expect(p.sending).toBe(false)
    const s2 = p.send('TU')
    p.receive('OK\nDONE\n')
    await s2
    expect(p.sending).toBe(false)
  })

  it('splits long text into SEND lines of at most 240 characters', async () => {
    const { p, out } = setup()
    const text = Array.from({ length: 60 }, () => 'OK1CDJ').join(' ') // 419 characters
    const s = p.send(text)
    p.receive('OK\n')
    await Promise.resolve()
    p.receive('OK\n')
    await s
    expect(out).toHaveLength(2)
    for (const l of out) expect(l.length).toBeLessThanOrEqual('SEND '.length + 240 + 1)
    expect(out.map((l) => l.slice(5, -1)).join(' ')).toBe(text)
  })

  it('a rejected SEND throws; reset fails waiting commands', async () => {
    const { p } = setup()
    const s = p.send('CQ')
    p.receive('ERR busy\n')
    await expect(s).rejects.toThrow('ERR busy')
    const v = p.ver()
    p.reset()
    await expect(v).rejects.toThrow('disconnected')
  })
})

describe('sanitize', () => {
  it('upper-cases, keeps prosigns, lists dropped characters once', () => {
    expect(sanitize('cq de ok1cdj <ar>')).toEqual({ text: 'CQ DE OK1CDJ <AR>', dropped: [] })
    expect(sanitize('TU ČÁ Č 73!')).toEqual({ text: 'TU 73', dropped: ['Č', 'Á', '!'] })
    expect(sanitize('  a   b ')).toEqual({ text: 'A B', dropped: [] })
    expect(sanitize('OK1ABC/P 5NN? =').text).toBe('OK1ABC/P 5NN? =')
  })
})

describe('macros', () => {
  const ctx: MacroContext = { call: 'OK1ABC', myCall: 'OK1CDJ', myLoc: 'JO70NC', myRef: 'OK/ZC-001', rst: '599', nr: '007', loc: 'JN79US' }

  it('expands each profile × RUN/S&P default', () => {
    expect(expandMacro(DEFAULT_MACROS.vkv.run.EXCH, ctx)).toBe('OK1ABC 599007 JO70NC K')
    expect(expandMacro(DEFAULT_MACROS.vkv.sp.EXCH, ctx)).toBe('TU 599007 JO70NC K')
    expect(expandMacro(DEFAULT_MACROS.vkv.run.CQ, ctx)).toBe('CQ TEST OK1CDJ OK1CDJ TEST')
    expect(expandMacro(DEFAULT_MACROS.aktivace.run.CQ, ctx)).toBe('CQ CQ DE OK1CDJ OK1CDJ OK/ZC-001 K')
    expect(expandMacro(DEFAULT_MACROS.aktivace.run.EXCH, ctx)).toBe('OK1ABC 599')
    expect(expandMacro(DEFAULT_MACROS.sat.run.EXCH, ctx)).toBe('OK1ABC UR 599 JO70NC')
    expect(expandMacro(DEFAULT_MACROS.sat.sp.EXCH, ctx)).toBe('TU UR 599 JO70NC')
    expect(expandMacro(DEFAULT_MACROS.obecny.sp.CQ, ctx)).toBe('OK1CDJ')
    expect(expandMacro(DEFAULT_MACROS.obecny.sp.TU, ctx)).toBe('TU 73')
  })

  it('missing values vanish, unknown placeholders stay', () => {
    expect(expandMacro('{CALL} {RST} {MYREF}', { ...ctx, call: undefined, myRef: undefined })).toBe('599')
    expect(expandMacro('{call} {FOO}', ctx)).toBe('OK1ABC {FOO}')
  })

  it('saved edits win over defaults; equal-to-default and reset drop them', () => {
    let saved = parseMacros('{"vkv":{"run":{"TU":"TU TEST"}}}')
    expect(macroFor(saved, 'vkv', 'run', 'TU')).toBe('TU TEST')
    expect(macroFor(saved, 'vkv', 'sp', 'TU')).toBe('TU 73')
    expect(macroFor(saved, 'obecny', 'run', 'CQ')).toBe(DEFAULT_MACROS.obecny.run.CQ)
    saved = withMacro(saved, 'vkv', 'run', 'AGN', 'PSE AGN')
    expect(macroFor(saved, 'vkv', 'run', 'AGN')).toBe('PSE AGN')
    saved = withMacro(saved, 'vkv', 'run', 'TU', DEFAULT_MACROS.vkv.run.TU)
    expect(saved.vkv?.run?.TU).toBeUndefined()
    saved = resetMacros(saved, 'vkv', 'run')
    expect(macroFor(saved, 'vkv', 'run', 'AGN')).toBe('AGN?')
  })

  it('bad saved JSON gives no edits', () => {
    expect(parseMacros('not json')).toEqual({})
    expect(parseMacros('[1]')).toEqual({})
    expect(parseMacros(null)).toEqual({})
  })
})

describe('keyer line commands', () => {
  it('R, S and S<n>', () => {
    expect(matchKeyerCommand('R')).toEqual({ type: 'run' })
    expect(matchKeyerCommand(' s ')).toEqual({ type: 'sp' })
    expect(matchKeyerCommand('S20')).toEqual({ type: 'speed', wpm: 20, inRange: true })
    expect(matchKeyerCommand('S5')).toEqual({ type: 'speed', wpm: 5, inRange: true })
    expect(matchKeyerCommand('S50')).toEqual({ type: 'speed', wpm: 50, inRange: true })
    expect(matchKeyerCommand('S4')).toEqual({ type: 'speed', wpm: 4, inRange: false })
    expect(matchKeyerCommand('S51')).toEqual({ type: 'speed', wpm: 51, inRange: false })
  })

  it('anything else is ordinary input', () => {
    for (const l of ['S20X', 'S100', 'R1', 'OK1ABC S', 'S 20', 'RS', '']) expect(matchKeyerCommand(l)).toBeUndefined()
  })
})
