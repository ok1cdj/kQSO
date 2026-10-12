import { describe, it, expect } from 'vitest'
import { IC705, RIG_MODELS, modelById, modelForAddr, rigHasBand, rigTunes, xvertBands, knowsBands } from '../src/core/rigmodel'
import { BANDS } from '../src/core/dictionaries'
import { readBandStack } from '../src/core/civ'

describe('radio definitions', () => {
  it('one model per address, bands we know', () => {
    const addrs = RIG_MODELS.map((m) => m.addr)
    expect(new Set(addrs).size).toBe(addrs.length)
    for (const m of RIG_MODELS) {
      for (const b of [...m.bands, ...(m.optional ?? [])]) expect(BANDS).toContain(b)
      for (const b of Object.keys(m.bandStack ?? {})) expect(m.bands).toContain(b)
    }
  })
  it('the IC-706 family tells itself apart by address', () => {
    expect(modelForAddr(0x48).label).toBe('IC-706')
    expect(rigHasBand(modelForAddr(0x4e), '2m')).toBe(true)
    expect(rigHasBand(modelForAddr(0x4e), '70cm')).toBe(false)
    expect(rigHasBand(modelForAddr(0x58), '70cm')).toBe(true)
  })
  it('optional units count only when switched on', () => {
    const m = modelById('ic910')!
    expect(rigHasBand(m, '23cm')).toBe(false)
    expect(rigHasBand(m, '23cm', ['23cm'])).toBe(true)
    expect(xvertBands(m)).toContain('23cm')
    expect(xvertBands(m, ['23cm'])).not.toContain('23cm')
  })
  it('an unknown address: generic, every band tried, nothing through CI-V', () => {
    const m = modelForAddr(0x4d)
    expect(m.id).toBe('generic')
    expect(m.label).toBe('CI-V 4D')
    expect(knowsBands(m)).toBe(false)
    expect(rigHasBand(m, '23cm')).toBe(true)
    expect(rigTunes(m, 10_368_000_000)).toBe(true)
    expect(m.cwCiv).toBeUndefined()
    expect(m.voice).toBeUndefined()
  })
  it('what a radio tunes', () => {
    expect(rigTunes(IC705, 145_500_000)).toBe(true)
    expect(rigTunes(IC705, 300_000_000)).toBe(false)
    expect(rigTunes(modelById('ic7300')!, 70_200_000)).toBe(true)
    expect(rigTunes(modelById('ic7300')!, 144_300_000)).toBe(false)
  })
  it('band stack codes per model', () => {
    const hex = (u: Uint8Array | undefined): string => Array.from(u ?? [], (b) => b.toString(16).padStart(2, '0')).join(' ')
    expect(hex(readBandStack('23cm', modelById('ic9700')!.bandStack))).toBe('fe fe a4 e0 1a 01 03 01 fd')
    expect(readBandStack('20m', modelById('ic706mk2')!.bandStack)).toBeUndefined()
  })
  it('transverter bands: 4 m and up the radio does not work', () => {
    expect(xvertBands(modelById('ic7300')!)).not.toContain('4m')
    expect(xvertBands(modelById('ic9700')!)).not.toContain('23cm')
    expect(xvertBands(IC705)).toContain('4m')
    expect(xvertBands(IC705)).not.toContain('20m')
  })
})
