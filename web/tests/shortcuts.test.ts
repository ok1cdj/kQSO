import { describe, it, expect } from 'vitest'
import { matchShortcut, nextBand, nextMode } from '../src/ui/shortcuts'
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
    expect(matchShortcut(alt('KeyO'))).toEqual({ type: 'chat' })
    expect(matchShortcut(alt('KeyG', '©'))).toEqual({ type: 'skedQrg' })
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

  it('Ctrl+M is ESM; Cmd+M (macOS minimize) and Alt+M (mode) are not', () => {
    expect(matchShortcut(key('m', { code: 'KeyM', ctrlKey: true }))).toEqual({ type: 'esm' })
    expect(matchShortcut(key('m', { code: 'KeyM', metaKey: true }))).toBeUndefined()
    expect(matchShortcut(key('M', { code: 'KeyM', ctrlKey: true, shiftKey: true }))).toBeUndefined() // the browser's
    expect(matchShortcut(alt('KeyM'))).toEqual({ type: 'mode' })
  })

  it('Alt+N the next band, Alt+P the previous one; Alt+B stays the browser\'s', () => {
    expect(matchShortcut(alt('KeyN', '˜'))).toEqual({ type: 'band', step: 1 })
    expect(matchShortcut(alt('KeyP', 'π'))).toEqual({ type: 'band', step: -1 })
    expect(matchShortcut(key('n', { code: 'KeyN', ctrlKey: true, altKey: true }))).toBeUndefined() // AltGr
    expect(matchShortcut(alt('KeyB'))).toBeUndefined()
  })
})

describe('nextBand', () => {
  it('steps in band-plan order and goes round the ends', () => {
    expect(nextBand('2m', 1)).toBe('70cm')
    expect(nextBand('70cm', -1)).toBe('2m')
    expect(nextBand('10m', 1)).toBe('6m')
    expect(nextBand('4mm', 1)).toBe('160m')
    expect(nextBand('160m', -1)).toBe('4mm')
    expect(nextBand('xx', 1)).toBe('160m')
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
