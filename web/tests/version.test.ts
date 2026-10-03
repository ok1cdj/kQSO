import { describe, it, expect } from 'vitest'
import { announceUpdate, compareVersions, parseVersion } from '../src/core/version'
import { WHATS_NEW, notesSince, seenBaseline } from '../src/core/whatsnew'

describe('versions', () => {
  it('parses release tags and compares numerically', () => {
    expect(parseVersion('v1.6.4')).toBe('1.6.4')
    expect(parseVersion('1.6')).toBe('1.6')
    expect(parseVersion('v1.6-beta')).toBeUndefined()
    expect(compareVersions('1.6.10', '1.6.9')).toBeGreaterThan(0)
    expect(compareVersions('1.6', '1.6.0')).toBe(0)
    expect(compareVersions('1.6.3', '1.7')).toBeLessThan(0)
  })

  it('announces only a newer release the user has not hidden', () => {
    expect(announceUpdate('1.6.4', '1.6.5', null)).toBe('1.6.5')
    expect(announceUpdate('1.6.4', '1.6.4', null)).toBeUndefined()
    expect(announceUpdate('1.6.5', '1.6.4', null)).toBeUndefined()
    expect(announceUpdate('1.6.4', '1.6.5', '1.6.5')).toBeUndefined()
    expect(announceUpdate('1.6.4', '1.6.6', '1.6.5')).toBe('1.6.6') // hidden only until the next one
    expect(announceUpdate('1.6.4', null, null)).toBeUndefined()
  })
})

describe("what's new", () => {
  it('entries are newest first, each with CS and EN text', () => {
    const versions = WHATS_NEW.map((e) => e.version)
    expect(versions).toEqual([...versions].sort((a, b) => compareVersions(b, a)))
    for (const e of WHATS_NEW) expect(e.cs.length === e.en.length && e.cs.length > 0).toBe(true)
  })

  it('notes after the seen version up to the current one', () => {
    expect(notesSince('1.6.3', '1.6.4').map((e) => e.version)).toEqual(['1.6.4'])
    expect(notesSince('1.6.4', '1.6.4')).toEqual([])
    expect(notesSince('1.6.2', '1.6.3')).toEqual([]) // 1.6.4 not installed yet
  })

  it('baseline: saved wins; none saved → fresh install shows nothing, an update from 1.6.3 shows the new notes', () => {
    expect(seenBaseline('1.6.4', true, '1.6.5')).toBe('1.6.4')
    expect(notesSince(seenBaseline(null, false, '1.6.4'), '1.6.4')).toEqual([])
    expect(notesSince(seenBaseline(null, true, '1.6.4'), '1.6.4').map((e) => e.version)).toEqual(['1.6.4'])
  })
})
