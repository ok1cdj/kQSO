import { describe, it, expect } from 'vitest'
import { initialState, reduce } from '../src/core/reducer'
import type { CoreState, LogMeta } from '../src/core/model'

const meta: LogMeta = {
  name: 'SOTA OK/ZC-001',
  profile: 'obecny',
  myCall: 'OK1CDJ',
  myGrid: 'JN79US',
  defaultSignal: { band: '40m', mode: 'SSB' },
}

const T = new Date('2026-09-22T14:32:00Z')

describe('two-phase Enter', () => {
  it('call-only commit fills defaults', () => {
    let s = initialState(meta)
    s = reduce(s, { type: 'firstKeystroke', at: T }, meta).state
    s = reduce(s, { type: 'enter', line: 'OK1ABC' }, meta).state
    const r = reduce(s, { type: 'enter', line: '' }, meta)
    expect(r.committed).toMatchObject({
      call: 'OK1ABC',
      report: { sent: '59', rcvd: '59' },
      signal: { band: '40m', mode: 'SSB' },
      stationCall: 'OK1CDJ',
      myGrid: 'JN79US',
      timeOn: T,
    })
    // Accumulator reset, sticky kept, ready for the next QSO.
    expect(r.state.partial).toEqual({})
    expect(r.state.hasStarted).toBe(false)
    expect(r.state.sticky).toEqual({ band: '40m', mode: 'SSB' })
  })

  it('phase-1 Enter clears input and does not commit', () => {
    let s = initialState(meta)
    s = reduce(s, { type: 'firstKeystroke', at: T }, meta).state
    const r = reduce(s, { type: 'enter', line: 'OK1ABC' }, meta)
    expect(r.clearInput).toBe(true)
    expect(r.committed).toBeUndefined()
    expect(r.state.partial.call).toBe('OK1ABC')
  })

  it('piecewise entry: OK1ABC ↵ JN79US ↵ PETR ↵ ↵', () => {
    let s = initialState(meta)
    s = reduce(s, { type: 'firstKeystroke', at: T }, meta).state
    s = reduce(s, { type: 'enter', line: 'OK1ABC' }, meta).state
    s = reduce(s, { type: 'enter', line: 'JN79US' }, meta).state
    s = reduce(s, { type: 'enter', line: 'PETR' }, meta).state
    const r = reduce(s, { type: 'enter', line: '' }, meta)
    expect(r.committed).toMatchObject({
      call: 'OK1ABC',
      grid: 'JN79US',
      name: 'PETR',
    })
  })

  it('empty Enter with nothing accumulated is ignored (rule 3)', () => {
    const s: CoreState = initialState(meta)
    const r = reduce(s, { type: 'enter', line: '' }, meta)
    expect(r.committed).toBeUndefined()
    expect(r.state).toEqual(s)
  })

  it('empty Enter after firstKeystroke but with no callsign is ignored', () => {
    let s = initialState(meta)
    s = reduce(s, { type: 'firstKeystroke', at: T }, meta).state
    const r = reduce(s, { type: 'enter', line: '' }, meta)
    expect(r.committed).toBeUndefined()
  })
})

describe('timestamp behavior', () => {
  it('is stamped at the first keystroke and not overwritten by later keystrokes', () => {
    const T2 = new Date('2026-09-22T14:40:00Z')
    let s = initialState(meta)
    s = reduce(s, { type: 'firstKeystroke', at: T }, meta).state
    s = reduce(s, { type: 'firstKeystroke', at: T2 }, meta).state
    expect(s.partial.timeOn).toBe(T)
  })

  it('a \\d{4} first token overrides the HH:MM of the commit', () => {
    let s = initialState(meta)
    s = reduce(s, { type: 'firstKeystroke', at: T }, meta).state
    s = reduce(s, { type: 'enter', line: '0915 OK1ABC' }, meta).state
    const r = reduce(s, { type: 'enter', line: '' }, meta)
    expect(r.committed!.timeOn.toISOString()).toBe('2026-09-22T09:15:00.000Z')
  })
})

describe('VKV contest requires a locator', () => {
  const vkv: LogMeta = { ...meta, profile: 'vkv', defaultSignal: { band: '2m', mode: 'SSB' } }
  const start = (): CoreState => reduce(initialState(vkv), { type: 'firstKeystroke', at: T }, vkv).state

  it('does not commit without the worked locator, keeps the QSO open', () => {
    let s = reduce(start(), { type: 'enter', line: 'OK1ABC 59001' }, vkv).state
    const r = reduce(s, { type: 'enter', line: '' }, vkv)
    expect(r.committed).toBeUndefined()
    expect(r.state.partial.call).toBe('OK1ABC')
    // Adding the locator then commits.
    s = reduce(r.state, { type: 'enter', line: 'JO70FD' }, vkv).state
    expect(reduce(s, { type: 'enter', line: '' }, vkv).committed).toMatchObject({ call: 'OK1ABC', grid: 'JO70FD' })
  })

  it('other profiles still commit call-only', () => {
    const s = reduce(reduce(initialState(meta), { type: 'firstKeystroke', at: T }, meta).state, { type: 'enter', line: 'OK1ABC' }, meta).state
    expect(reduce(s, { type: 'enter', line: '' }, meta).committed).toBeDefined()
  })
})
