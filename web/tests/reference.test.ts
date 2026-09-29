import { describe, it, expect } from 'vitest'
import { matchReference, parseReferenceInput } from '../src/core/reference'

describe('reference detection', () => {
  it('SOTA — three parts, last 3 digits', () => {
    expect(matchReference('OK/ZC/001')).toEqual({ kind: 'SOTA', value: 'OK/ZC-001' })
  })

  it('POTA — two parts, last 4 digits', () => {
    expect(matchReference('OK/0001')).toEqual({ kind: 'POTA', value: 'OK-0001' })
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
    expect(parseReferenceInput('OK/0001')).toEqual({ kind: 'POTA', value: 'OK-0001' })
    expect(parseReferenceInput('OKFF/0001')).toEqual({ kind: 'WWFF', value: 'OKFF-0001' })
  })

  it('accepts the already-canonical dash form', () => {
    expect(parseReferenceInput('OK/ZC-001')).toEqual({ kind: 'SOTA', value: 'OK/ZC-001' })
    expect(parseReferenceInput('OK-0001')).toEqual({ kind: 'POTA', value: 'OK-0001' })
    expect(parseReferenceInput('OKFF-0001')).toEqual({ kind: 'WWFF', value: 'OKFF-0001' })
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

  it('rejects a five-digit last part', () => {
    expect(matchReference('OK/00001')).toBeNull()
  })
})
