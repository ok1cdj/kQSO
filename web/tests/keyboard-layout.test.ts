import { describe, it, expect } from 'vitest'
import { KEY_ROWS, KEYS } from '../src/ui/keys'

describe('keyboard layout', () => {
  it('is a 6×7 grid of 40 keys', () => {
    expect(KEY_ROWS).toHaveLength(7)
    expect(KEYS).toHaveLength(40)
  })

  it('every letter A–Z appears once, in alphabetical order', () => {
    const chars = KEYS.filter((k) => k.action.type === 'char').map((k) => k.label)
    const az = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    expect(chars.filter((c) => /[A-Z]/.test(c))).toEqual(az)
  })

  it('has digits 0–9 and a slash', () => {
    const chars = new Set(KEYS.filter((k) => k.action.type === 'char').map((k) => k.label))
    for (const d of '0123456789') expect(chars.has(d)).toBe(true)
    expect(chars.has('/')).toBe(true)
  })

  it('has exactly one backspace, one space, one enter; backspace and enter are wide', () => {
    const byType = (t: string) => KEYS.filter((k) => k.action.type === t)
    expect(byType('backspace')).toHaveLength(1)
    expect(byType('space')).toHaveLength(1)
    expect(byType('enter')).toHaveLength(1)
    expect(byType('backspace')[0]!.wide).toBe(true)
    expect(byType('enter')[0]!.wide).toBe(true)
    expect(byType('space')[0]!.wide).toBeUndefined()
  })

  it('each row plus wide keys spans exactly 6 columns', () => {
    for (const row of KEY_ROWS) {
      const cols = row.reduce((n, k) => n + (k.wide ? 2 : 1), 0)
      expect(cols).toBe(6)
    }
  })
})
