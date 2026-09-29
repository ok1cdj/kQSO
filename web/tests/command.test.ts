import { describe, it, expect } from 'vitest'
import { hasContent, matchCommand } from '../src/core/command'
import { initialState, reduce } from '../src/core/reducer'
import type { CoreState, LogMeta } from '../src/core/model'

const meta: LogMeta = {
  name: 'test',
  profile: 'obecny',
  myCall: 'OK1CDJ',
  myGrid: 'JN79US',
  defaultSignal: { band: '40m', mode: 'SSB' },
}

const T = new Date('2026-09-22T14:32:00Z')

/** Type a sequence of lines (each followed by Enter) from a fresh state. */
function typeLines(lines: string[], start: CoreState = initialState(meta)) {
  let state = reduce(start, { type: 'firstKeystroke', at: T }, meta).state
  let last = reduce(state, { type: 'enter', line: '' }, meta)
  for (const line of lines) {
    last = reduce(state, { type: 'enter', line }, meta)
    state = last.state
  }
  return last
}

describe('matchCommand', () => {
  it('a lone W or D is a command, any case, surrounding spaces ignored', () => {
    expect(matchCommand('W')).toBe('wipe')
    expect(matchCommand(' w ')).toBe('wipe')
    expect(matchCommand('D')).toBe('deleteLast')
  })

  it('only as the whole line — mixed with other tokens it is ordinary input', () => {
    expect(matchCommand('OK1ABC W')).toBeUndefined()
    expect(matchCommand('W D')).toBeUndefined()
    expect(matchCommand('WD')).toBeUndefined()
    expect(matchCommand('W1AW')).toBeUndefined()
    expect(matchCommand('')).toBeUndefined()
  })
})

describe('hasContent', () => {
  it('the first-keystroke time alone is not content', () => {
    expect(hasContent({})).toBe(false)
    expect(hasContent({ timeOn: T })).toBe(false)
    expect(hasContent({ timeOn: T, call: 'OK1ABC' })).toBe(true)
    expect(hasContent({ timeOn: T, grid: 'JN79US' })).toBe(true)
  })
})

describe('W — discard the unfinished QSO', () => {
  it('empties the accumulator and time, keeps band and mode', () => {
    const r = typeLines(['20m cw', 'OK1ABC 579 JN79US PETR', 'W'])
    expect(r.command).toBe('wipe')
    expect(r.clearInput).toBe(true)
    expect(r.state.partial).toEqual({})
    expect(r.state.hasStarted).toBe(false)
    expect(r.state.sticky).toMatchObject({ band: '20m', mode: 'CW' })
    expect(r.committed).toBeUndefined()
  })

  it('after W an empty Enter commits nothing', () => {
    const w = typeLines(['OK1ABC', 'W'])
    const e = reduce(w.state, { type: 'enter', line: '' }, meta)
    expect(e.committed).toBeUndefined()
  })

  it('is never parsed as a name in the General profile', () => {
    const r = typeLines(['OK1ABC', 'W'])
    expect(r.state.partial.name).toBeUndefined()
    // …but on the same line as other tokens it still is a name
    const n = typeLines(['OK1ABC W'])
    expect(n.command).toBeUndefined()
    expect(n.state.partial.name).toBe('W')
  })
})

describe('D — delete the last saved QSO', () => {
  it('with nothing typed: asks the UI to delete and drops the stamped time', () => {
    const r = typeLines(['D'])
    expect(r.command).toBe('deleteLast')
    expect(r.state.partial).toEqual({})
    expect(r.state.hasStarted).toBe(false)
  })

  it('refused while a QSO is unfinished — the typed data stays', () => {
    const r = typeLines(['OK1ABC 57', 'D'])
    expect(r.command).toBe('deleteLastBlocked')
    expect(r.clearInput).toBe(true)
    expect(r.state.partial).toMatchObject({ call: 'OK1ABC', reportRcvd: '57' })
  })
})
