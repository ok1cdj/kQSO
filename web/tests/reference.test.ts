import { describe, it, expect } from 'vitest'
import { matchReference, parseReferenceInput } from '../src/core/reference'

describe('reference detection', () => {
  it('SOTA — three parts, last 3 digits', () => {
    expect(matchReference('OK/ZC/001')).toEqual({ kind: 'SOTA', value: 'OK/ZC-001' })
  })

  it('POTA — two parts, 2-letter ISO prefix', () => {
    expect(matchReference('CZ/0001')).toEqual({ kind: 'POTA', value: 'CZ-0001' })
  })

  it('POTA — 5-digit US parks', () => {
    expect(matchReference('US/10000')).toEqual({ kind: 'POTA', value: 'US-10000' })
  })

  it('TOTA — prefix of 3+ chars ending with R', () => {
    expect(matchReference('OKR/1001')).toEqual({ kind: 'TOTA', value: 'OKR-1001' })
    expect(matchReference('GBR/0012')).toEqual({ kind: 'TOTA', value: 'GBR-0012' })
    expect(matchReference('9MR/0001')).toEqual({ kind: 'TOTA', value: '9MR-0001' })
  })

  it('a 2-letter prefix ending with R stays POTA (FR, HR)', () => {
    expect(matchReference('FR/0123')).toEqual({ kind: 'POTA', value: 'FR-0123' })
  })

  it('WWFF — prefix ends with FF', () => {
    expect(matchReference('OKFF/0001')).toEqual({ kind: 'WWFF', value: 'OKFF-0001' })
  })

  it('only the last slash becomes a dash', () => {
    expect(matchReference('OK/ZC/001')!.value).toBe('OK/ZC-001')
  })
})

describe('reference vs portable callsign ', () => {
  it('rejects letter suffix /P', () => {
    expect(matchReference('OK1ABC/P')).toBeNull()
  })

  it('rejects double-prefix portable HB0/OK1MCS/P', () => {
    expect(matchReference('HB0/OK1MCS/P')).toBeNull()
  })

  it('rejects single-digit suffix /5', () => {
    expect(matchReference('OK1ABC/5')).toBeNull()
  })

  it('rejects a token with no slash', () => {
    expect(matchReference('OK1ABC')).toBeNull()
  })
})

describe('parseReferenceInput — lenient form input (slash OR dash)', () => {
  it('accepts the parser slash convention', () => {
    expect(parseReferenceInput('OK/ZC/001')).toEqual({ kind: 'SOTA', value: 'OK/ZC-001' })
    expect(parseReferenceInput('CZ/0001')).toEqual({ kind: 'POTA', value: 'CZ-0001' })
    expect(parseReferenceInput('OKFF/0001')).toEqual({ kind: 'WWFF', value: 'OKFF-0001' })
    expect(parseReferenceInput('OKR/1001')).toEqual({ kind: 'TOTA', value: 'OKR-1001' })
  })

  it('accepts the already-canonical dash form', () => {
    expect(parseReferenceInput('OK/ZC-001')).toEqual({ kind: 'SOTA', value: 'OK/ZC-001' })
    expect(parseReferenceInput('CZ-0001')).toEqual({ kind: 'POTA', value: 'CZ-0001' })
    expect(parseReferenceInput('US-10000')).toEqual({ kind: 'POTA', value: 'US-10000' })
    expect(parseReferenceInput('OKFF-0001')).toEqual({ kind: 'WWFF', value: 'OKFF-0001' })
    expect(parseReferenceInput('OKR-1001')).toEqual({ kind: 'TOTA', value: 'OKR-1001' })
  })

  it('lowercases input is normalized to upper', () => {
    expect(parseReferenceInput('ok/zc-001')).toEqual({ kind: 'SOTA', value: 'OK/ZC-001' })
  })

  it('rejects empty or nonsense', () => {
    expect(parseReferenceInput('')).toBeNull()
    expect(parseReferenceInput('HELLO')).toBeNull()
    expect(parseReferenceInput('OK-12')).toBeNull() // too few digits
  })
})

describe('reference edge shapes', () => {
  it('WWFF wins over POTA when a two-part token has an FF prefix', () => {
    expect(matchReference('GFF/0123')).toEqual({ kind: 'WWFF', value: 'GFF-0123' })
  })

  it('rejects a two-digit last part (satellite-shaped)', () => {
    expect(matchReference('RS/44')).toBeNull()
  })

  it('rejects a six-digit last part', () => {
    expect(matchReference('US/000001')).toBeNull()
  })
})
