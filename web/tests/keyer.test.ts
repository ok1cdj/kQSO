import { describe, it, expect } from 'vitest'
import {
  LineAssembler,
  chunk,
  KeyerProtocol,
  asyncEvent,
  sanitize,
  expandMacro,
  greeting,
  macroFor,
  withMacro,
  resetMacros,
  parseMacros,
  DEFAULT_MACROS,
  infoLabel,
  esmMessage,
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
    // The keyer's queue just appends: the second part carries the word gap itself.
    expect(out.map((l) => l.slice(5, -1)).join('')).toBe(text)
  })

  it('text queued behind text still on the air starts with a space', async () => {
    const { p, out } = setup()
    const a = p.send('CQ')
    p.receive('OK\n')
    await a
    const b = p.send('TEST')
    p.receive('OK\n')
    await b
    expect(out).toEqual(['SEND CQ\n', 'SEND  TEST\n'])
    p.receive('DONE\n')
    const c = p.send('TU')
    p.receive('OK\n')
    await c
    expect(out[2]).toBe('SEND TU\n') // idle keyer: no leading gap
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
    expect(expandMacro(DEFAULT_MACROS.vkv.run.EXCH, ctx)).toBe('OK1ABC 599 007 JO70NC K')
    expect(expandMacro(DEFAULT_MACROS.vkv.sp.EXCH, ctx)).toBe('TU 599 007 JO70NC K')
    expect(expandMacro(DEFAULT_MACROS.vkv.run.CQ, ctx)).toBe('CQ TEST OK1CDJ OK1CDJ TEST')
    expect(expandMacro(DEFAULT_MACROS.aktivace.run.CQ, ctx)).toBe('CQ CQ DE OK1CDJ OK1CDJ OK/ZC-001 K')
    expect(expandMacro(DEFAULT_MACROS.aktivace.run.EXCH, ctx)).toBe('OK1ABC 599')
    expect(expandMacro(DEFAULT_MACROS.sat.run.EXCH, ctx)).toBe('OK1ABC UR 599 JO70NC')
    expect(expandMacro(DEFAULT_MACROS.sat.sp.EXCH, ctx)).toBe('TU UR 599 JO70NC')
    expect(expandMacro(DEFAULT_MACROS.obecny.sp.CQ, ctx)).toBe('OK1ABC DE OK1CDJ') // DE in S&P
    expect(expandMacro(DEFAULT_MACROS.obecny.sp.TU, ctx)).toBe('TU 73')
  })

  it('{HI} greets by the local time', () => {
    const at = (h: number) => greeting(new Date(2026, 9, 3, h, 30))
    expect([at(0), at(11), at(12), at(17), at(18), at(23)]).toEqual(['GM', 'GM', 'GA', 'GA', 'GE', 'GE'])
    expect(expandMacro('{HI} {CALL} TU', { ...ctx, hi: 'GA' })).toBe('GA OK1ABC TU')
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
    saved = withMacro(saved, 'vkv', 'run', 'INFO', 'QTH {MYLOC}')
    expect(macroFor(saved, 'vkv', 'run', 'INFO')).toBe('QTH {MYLOC}')
    saved = withMacro(saved, 'vkv', 'run', 'TU', DEFAULT_MACROS.vkv.run.TU)
    expect(saved.vkv?.run?.TU).toBeUndefined()
    saved = resetMacros(saved, 'vkv', 'run')
    expect(macroFor(saved, 'vkv', 'run', 'INFO')).toBe('{MYLOC}')
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
    expect(matchKeyerCommand('c')).toEqual({ type: 'connect' })
    expect(matchKeyerCommand('k')).toEqual({ type: 'keyboard' })
    expect(matchKeyerCommand('e')).toEqual({ type: 'esm' })
    expect(matchKeyerCommand('k pse qrs ')).toEqual({ type: 'text', text: 'PSE QRS' })
    expect(matchKeyerCommand('S20')).toEqual({ type: 'speed', wpm: 20, inRange: true })
    expect(matchKeyerCommand('S5')).toEqual({ type: 'speed', wpm: 5, inRange: true })
    expect(matchKeyerCommand('S50')).toEqual({ type: 'speed', wpm: 50, inRange: true })
    expect(matchKeyerCommand('S4')).toEqual({ type: 'speed', wpm: 4, inRange: false })
    expect(matchKeyerCommand('S51')).toEqual({ type: 'speed', wpm: 51, inRange: false })
  })

  it('anything else is ordinary input', () => {
    for (const l of ['S20X', 'S100', 'R1', 'OK1ABC S', 'S 20', 'RS', 'C1', 'K1ABC', 'KX', '']) expect(matchKeyerCommand(l)).toBeUndefined()
  })
})

describe('INFO macro slot', () => {
  it('activation: my reference (REF); VHF / satellite: my locator (LOC); general: free text (INFO)', () => {
    expect(DEFAULT_MACROS.aktivace.run.INFO).toBe('{MYREF}')
    expect(DEFAULT_MACROS.aktivace.sp.INFO).toBe('{MYREF}')
    for (const p of ['vkv', 'sat'] as const) {
      expect(DEFAULT_MACROS[p].run.INFO).toBe('{MYLOC}')
      expect(DEFAULT_MACROS[p].sp.INFO).toBe('{MYLOC}')
    }
    expect(DEFAULT_MACROS.obecny.run.INFO).toBe('') // free text, set by the operator
    expect(infoLabel('aktivace')).toBe('REF')
    expect(infoLabel('vkv')).toBe('LOC')
    expect(infoLabel('obecny')).toBe('INFO')
  })
})

describe('esmMessage', () => {
  const idle = { lineEmpty: true, hadContent: false, hadCall: false }
  const typedCall = { lineEmpty: false, hadContent: false, hadCall: false }
  const typedMore = { lineEmpty: false, hadContent: true, hadCall: true }
  const open = { lineEmpty: true, hadContent: true, hadCall: true }
  const none = { committed: false, hasCall: false, missing: [] as ('NR' | 'LOC')[] }

  it('empty line, nothing open: RUN = CQ, S&P = my call', () => {
    expect(esmMessage('run', idle, none)).toBe('CQ')
    expect(esmMessage('sp', idle, none)).toBe('MYCALL')
  })

  it('the Enter that brings the call: RUN = EXCH, S&P = my call', () => {
    const after = { committed: false, hasCall: true, missing: [] as ('NR' | 'LOC')[] }
    expect(esmMessage('run', typedCall, after)).toBe('EXCH')
    expect(esmMessage('sp', typedCall, after)).toBe('MYCALL')
  })

  it('filling in (report, number, locator) sends nothing', () => {
    const after = { committed: false, hasCall: true, missing: [] as ('NR' | 'LOC')[] }
    expect(esmMessage('run', typedMore, after)).toBeNull()
    expect(esmMessage('sp', typedMore, after)).toBeNull()
  })

  it('empty Enter that saves: RUN = TU, S&P = EXCH', () => {
    const saved = { committed: true, hasCall: false, missing: [] as ('NR' | 'LOC')[] }
    expect(esmMessage('run', open, saved)).toBe('TU')
    expect(esmMessage('sp', open, saved)).toBe('EXCH')
  })

  it('empty Enter refused for the VHF number / locator asks for it, both modes', () => {
    const refused = (missing: ('NR' | 'LOC')[]) => ({ committed: false, hasCall: true, missing })
    for (const mode of ['run', 'sp'] as const) {
      expect(esmMessage(mode, open, refused(['NR']))).toBe('NR?')
      expect(esmMessage(mode, open, refused(['LOC']))).toBe('LOC?')
      expect(esmMessage(mode, open, refused(['NR', 'LOC']))).toBe('NRLOC?')
    }
  })

  it('an open QSO without a call (only a locator typed) sends nothing', () => {
    const noCall = { lineEmpty: true, hadContent: true, hadCall: false }
    expect(esmMessage('run', noCall, { committed: false, hasCall: false, missing: ['NR'] })).toBeNull()
  })

  it('the ESM-only slots have their defaults in every set', () => {
    for (const p of ['aktivace', 'vkv', 'obecny', 'sat'] as const)
      for (const m of ['run', 'sp'] as const) {
        expect(DEFAULT_MACROS[p][m]['NR?']).toBe('NR ?')
        expect(DEFAULT_MACROS[p][m]['LOC?']).toBe('LOC ?')
        expect(DEFAULT_MACROS[p][m]['NRLOC?']).toBe('NR LOC ?')
      }
  })
})
