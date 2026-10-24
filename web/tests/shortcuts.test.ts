import { describe, it, expect } from 'vitest'
import { matchShortcut, nextMode } from '../src/ui/shortcuts'
import type { KeyInput } from '../src/ui/shortcuts'

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})
const alt = (code: string, k = '?'): KeyInput => key(k, { code, altKey: true })

describe('matchShortcut', () => {
  it('F5–F8, F11, F12 are the memories; F1–F4, F9, F10 stay the browser\'s', () => {
    expect(['F5', 'F6', 'F7', 'F8', 'F11', 'F12'].map((f) => matchShortcut(key(f)))).toEqual(
      [0, 1, 2, 3, 4, 5].map((index) => ({ type: 'memory', index })),
    )
    for (const f of ['F1', 'F2', 'F3', 'F4', 'F9', 'F10']) expect(matchShortcut(key(f))).toBeUndefined()
    expect(matchShortcut(key('F5', { shiftKey: true }))).toBeUndefined()
    expect(matchShortcut(key('F5', { ctrlKey: true }))).toBeUndefined()
  })

  it('PgUp / PgDn: speed ±2', () => {
    expect(matchShortcut(key('PageUp'))).toEqual({ type: 'speed', delta: 2 })
    expect(matchShortcut(key('PageDown'))).toEqual({ type: 'speed', delta: -2 })
  })

  it('Alt goes by the physical key (macOS Option gives another character)', () => {
    expect(matchShortcut(alt('KeyW', 'w'))).toEqual({ type: 'line', letter: 'W' })
    expect(matchShortcut(alt('KeyE', '´'))).toEqual({ type: 'line', letter: 'E' })
    expect(matchShortcut(alt('KeyR', '®'))).toEqual({ type: 'keyer', letter: 'R' })
    expect(matchShortcut(alt('KeyX'))).toEqual({ type: 'loc' })
    expect(matchShortcut(alt('KeyM'))).toEqual({ type: 'mode' })
    expect(matchShortcut(alt('KeyL'))).toEqual({ type: 'list' })
    expect(matchShortcut(alt('KeyQ'))).toEqual({ type: 'back' })
    expect(matchShortcut(alt('KeyZ'))).toBeUndefined()
  })

  it('Ctrl / Cmd + Enter saves; Ctrl + a letter and plain keys are not shortcuts', () => {
    expect(matchShortcut(key('Enter', { ctrlKey: true }))).toEqual({ type: 'save' })
    expect(matchShortcut(key('Enter', { metaKey: true }))).toEqual({ type: 'save' })
    expect(matchShortcut(key('Enter'))).toBeUndefined()
    expect(matchShortcut(key('w', { code: 'KeyW', ctrlKey: true }))).toBeUndefined()
    expect(matchShortcut(key('w', { code: 'KeyW', ctrlKey: true, altKey: true }))).toBeUndefined() // AltGr
    expect(matchShortcut(key('W', { code: 'KeyW' }))).toBeUndefined()
  })
})

describe('nextMode', () => {
  it('CW → SSB → FM → CW; another mode starts at CW', () => {
    expect(nextMode('CW')).toBe('SSB')
    expect(nextMode('SSB')).toBe('FM')
    expect(nextMode('FM')).toBe('CW')
    expect(nextMode('RTTY')).toBe('CW')
  })
})
