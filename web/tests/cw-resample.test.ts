import { describe, it, expect } from 'vitest'
import { Resampler } from '../src/core/cw/resample'

function tone(rate: number, hz: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate)
  return out
}

/** Amplitude of `hz` in `x` (a single-bin DFT), skipping the filter's start-up. */
function level(x: Float32Array, rate: number, hz: number): number {
  let re = 0
  let im = 0
  const from = 200
  for (let i = from; i < x.length; i++) {
    re += x[i]! * Math.cos((2 * Math.PI * hz * i) / rate)
    im -= x[i]! * Math.sin((2 * Math.PI * hz * i) / rate)
  }
  return (2 * Math.hypot(re, im)) / (x.length - from)
}

function inBlocks(r: Resampler, x: Float32Array, size: number): Float32Array {
  const parts: Float32Array[] = []
  for (let i = 0; i < x.length; i += size) parts.push(r.process(x.subarray(i, i + size)))
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('Resampler', () => {
  for (const rate of [48000, 44100]) {
    it(`keeps a 700 Hz CW tone from ${rate} Hz at 9600 Hz`, () => {
      const out = inBlocks(new Resampler(rate, 9600), tone(rate, 700, 1), 4096)
      expect(Math.abs(out.length - 9600)).toBeLessThanOrEqual(2)
      expect(level(out, 9600, 700)).toBeCloseTo(0.5, 1)
    })

    it(`keeps out what would fold onto the CW tones (${rate} Hz)`, () => {
      // 8.9 kHz at 9600 Hz would alias to 700 Hz.
      const out = inBlocks(new Resampler(rate, 9600), tone(rate, 8900, 1), 4096)
      expect(level(out, 9600, 700)).toBeLessThan(0.5 / 300) // < −50 dB
    })
  }

  it('gives the same samples whatever the block size', () => {
    const x = tone(44100, 650, 0.5)
    const whole = new Resampler(44100, 9600).process(x)
    const odd = inBlocks(new Resampler(44100, 9600), x, 333)
    expect(odd.length).toBe(whole.length)
    for (let i = 0; i < whole.length; i++) expect(odd[i]).toBeCloseTo(whole[i]!, 5)
  })
})
