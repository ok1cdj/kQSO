import { describe, it, expect } from 'vitest'
import {
  FFT,
  OUTPUT_HOP_LENGTH,
  narrowSpectrogram,
  shiftedSpectrogram,
  wideSpectrogram,
  type Spectrogram,
} from '../src/core/cw/dsp'
import { BLANK_INDEX, VOCABULARY, bestPath, decodeCtc, type CtcResult } from '../src/core/cw/ctc'
import { CwStream, confirmedSplit } from '../src/core/cw/stream'
import { cutToDigits, cwWord, cwWords } from '../src/core/cw/words'
import { findCw, tuneDirection } from '../src/core/cw/tune'
import { synthCw } from './cw-synth'
import reference from './fixtures/cw-spectrogram.json'

describe('FFT', () => {
  function naiveDft(re: number[]): Float32Array {
    const n = re.length
    const out = new Float32Array(n * 2)
    for (let k = 0; k < n; k++) {
      let sr = 0
      let si = 0
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n
        sr += re[t]! * Math.cos(a)
        si += re[t]! * Math.sin(a)
      }
      out[k * 2] = sr
      out[k * 2 + 1] = si
    }
    return out
  }

  it.each([64, 768])('matches a plain DFT for n = %i (radix-2 and Bluestein)', (n) => {
    const signal = Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.9) + ((i * 7919) % 13) / 13)
    const x = new Float32Array(n * 2)
    signal.forEach((v, i) => (x[i * 2] = v))
    new FFT(n).transform(x)
    const expected = naiveDft(signal)
    let maxDiff = 0
    for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(x[i]! - expected[i]!))
    expect(maxDiff).toBeLessThan(1e-3)
  })
})

describe('spectrogram', () => {
  const audio = synthCw('CQ TEST OK1CDJ', { wpm: 22, pitchHz: 700, snr: 3, seed: 7 })

  function expectMatches(spec: Spectrogram | undefined, ref: { dims: number[]; step: number; picks: number[]; sum: number }) {
    expect(spec).toBeDefined()
    expect(spec!.dims).toEqual(ref.dims)
    ref.picks.forEach((v, i) => expect(spec!.data[i * ref.step]).toBeCloseTo(v, 5))
    let sum = 0
    for (const v of spec!.data) sum += v
    expect(sum).toBeCloseTo(ref.sum, 2)
  }

  it('the synthetic signal is the one the reference was made from', () => {
    expect(audio.length).toBe(reference.samples)
  })
  it('wide model input matches DeepCW', () => expectMatches(wideSpectrogram(audio), reference.wide))
  it('wide model with a band-pass matches DeepCW', () => expectMatches(wideSpectrogram(audio, 700, 200), reference.wideFiltered))
  it('shifted wide model input matches DeepCW', () => expectMatches(shiftedSpectrogram(audio, 700, 100), reference.shifted))
  it('narrow model input matches DeepCW', () => expectMatches(narrowSpectrogram(audio, 700), reference.narrow))

  it('too little audio gives no spectrogram', () => {
    expect(narrowSpectrogram(new Float32Array(100), 700)).toBeUndefined()
  })
})

const idx = (ch: string) => VOCABULARY.indexOf(ch)
const B = BLANK_INDEX
const SP = idx(' ')

describe('CTC', () => {
  it('picks the best class per frame', () => {
    expect(bestPath([0, 5, 1, 9, 2, 2], 2, 3)).toEqual([1, 0])
  })

  it('collapses repeats, drops blanks, keeps doubled letters split by a blank', () => {
    const path = [B, idx('T'), idx('T'), B, idx('E'), B, idx('E'), SP, SP, idx('5'), B]
    const r = decodeCtc(path)
    expect(r.text).toBe('TEE 5')
    expect(r.chars.map((c) => [c.char, c.startFrame, c.endFrame])).toEqual([
      ['T', 1, 2],
      ['E', 4, 4],
      ['E', 6, 6],
      [' ', 7, 8],
      ['5', 9, 9],
    ])
    expect(r.wordGaps).toEqual([{ startFrame: 7, endFrame: 8 }])
  })

  it('a gap running to the end is closed at the last frame', () => {
    expect(decodeCtc([idx('K'), SP, SP]).wordGaps).toEqual([{ startFrame: 1, endFrame: 2 }])
  })
})

/** A fake model: the text with one output frame per character slot, laid out so that a
 *  word gap sits at the given sample. */
function fakeResult(words: string[], gapAtSamples: number[]): CtcResult {
  const chars: CtcResult['chars'] = []
  const wordGaps: CtcResult['wordGaps'] = []
  let frame = 0
  words.forEach((w, i) => {
    for (const c of w) chars.push({ char: c, startFrame: frame, endFrame: frame++ })
    const gapSample = gapAtSamples[i]
    if (gapSample !== undefined) {
      const gapFrame = Math.round(gapSample / OUTPUT_HOP_LENGTH)
      frame = Math.max(frame, gapFrame)
      chars.push({ char: ' ', startFrame: frame, endFrame: frame })
      wordGaps.push({ startFrame: frame, endFrame: frame })
      frame++
    }
  })
  return { text: chars.map((c) => c.char).join(''), wordGaps, chars }
}

describe('streaming', () => {
  const second = 9600

  it('waits for 2 s of audio', async () => {
    const s = new CwStream()
    s.push(new Float32Array(second))
    expect(await s.step(async () => fakeResult(['X'], []))).toBeUndefined()
  })

  it('commits up to the last word gap behind the live edge and keeps the tail', async () => {
    const s = new CwStream()
    s.push(new Float32Array(6 * second))
    // gaps at 2.5 s and 5.5 s; 5.5 s is within the 1.25 s guard of the 6 s edge
    const step = await s.step(async () => fakeResult(['CQ', 'OK1CDJ', 'K'], [2.5 * second, 5.5 * second]))
    expect(step).toEqual({ committed: 'CQ', pending: '' })
    // the gap at 2.5 s rounds to output frame 83
    expect(s.pendingSamples).toBe(6 * second - 83 * OUTPUT_HOP_LENGTH)
  })

  it('shows everything as pending while no gap is safe to commit', async () => {
    const s = new CwStream()
    s.push(new Float32Array(3 * second))
    const step = await s.step(async () => fakeResult(['OK1', 'CDJ'], [2.5 * second]))
    expect(step).toEqual({ committed: '', pending: 'OK1 CDJ' })
    expect(s.pendingSamples).toBe(3 * second)
  })

  it('commits a full 30 s without a gap whole', async () => {
    const s = new CwStream()
    s.push(new Float32Array(31 * second))
    const step = await s.step(async (audio) => {
      expect(audio.length).toBe(30 * second)
      return fakeResult(['VVVVVVVV'], [])
    })
    expect(step).toEqual({ committed: 'VVVVVVVV', pending: '' })
    expect(s.pendingSamples).toBe(second)
  })

  it('a reset while the model runs drops that result and keeps the new audio', async () => {
    const s = new CwStream()
    s.push(new Float32Array(6 * second))
    const step = await s.step(async () => {
      s.reset()
      s.push(new Float32Array(second))
      return fakeResult(['CQ', 'DE'], [2.5 * second])
    })
    expect(step).toBeUndefined()
    expect(s.pendingSamples).toBe(second)
  })

  it('new audio pushed while the model runs survives the commit', async () => {
    const s = new CwStream()
    const first = new Float32Array(6 * second)
    s.push(first)
    const late = new Float32Array(second).fill(0.5)
    await s.step(async () => {
      s.push(late)
      return fakeResult(['CQ', 'TEST'], [3 * second])
    })
    expect(s.pendingSamples).toBe(4 * second)
  })

  it('confirmedSplit ignores gaps in the first 2 s', () => {
    expect(confirmedSplit([{ startFrame: 10, endFrame: 12 }], 10 * second)).toBeUndefined()
  })
})

describe('words', () => {
  it('turns cut numbers into digits', () => {
    expect(cutToDigits('5NN')).toBe('599')
    expect(cutToDigits('ENN')).toBe('599')
    expect(cutToDigits('5NNT01')).toBe('599001')
    expect(cutToDigits('1TT')).toBe('100')
    expect(cutToDigits('TO')).toBeUndefined()
    expect(cutToDigits('TEN')).toBeUndefined()
    expect(cutToDigits('TU')).toBeUndefined()
  })

  it('tells calls, numbers and locators from the rest', () => {
    expect(cwWords('CQ TEST OK1CDJ OK1CDJ/P 5NN 001 JO70FD JN79 TU 73')).toEqual([
      { kind: 'other', value: 'CQ' },
      { kind: 'other', value: 'TEST' },
      { kind: 'call', value: 'OK1CDJ' },
      { kind: 'call', value: 'OK1CDJ/P' },
      { kind: 'number', value: '599' },
      { kind: 'number', value: '001' },
      { kind: 'locator', value: 'JO70FD' },
      { kind: 'locator', value: 'JN79' },
      { kind: 'other', value: 'TU' },
      { kind: 'other', value: '73' },
    ])
  })

  it('upper-cases', () => {
    expect(cwWord('ok2ih')).toEqual({ kind: 'call', value: 'OK2IH' })
  })
})

describe('tuning indicator', () => {
  const mix = (...parts: Float32Array[]) => {
    const n = Math.min(...parts.map((p) => p.length))
    const out = new Float32Array(n)
    for (const p of parts) for (let i = 0; i < n; i++) out[i]! += p[i]!
    return out
  }

  it('finds a station off the pitch', () => {
    const audio = synthCw('CQ TEST OK1CDJ', { pitchHz: 640, snr: 3, seed: 4 })
    const s = findCw(audio, 700)
    expect(s).toBeDefined()
    expect(Math.abs(s!.hz - 640)).toBeLessThanOrEqual(12.5)
    expect(tuneDirection(s!.hz, 700)).toBe(-1)
  })

  it('says tuned in when the station is at the pitch', () => {
    const s = findCw(synthCw('CQ TEST OK1CDJ', { pitchHz: 700, snr: 3, seed: 5 }), 700)
    expect(tuneDirection(s!.hz, 700)).toBe(0)
  })

  it('keeps the station at the pitch over a stronger one elsewhere', () => {
    const mine = synthCw('CQ TEST OK1CDJ', { pitchHz: 700, snr: Infinity, seed: 6 })
    const other = synthCw('TEST OK2IH OK2IH', { pitchHz: 950, snr: Infinity, seed: 7 }).map((v) => v * 3)
    const noise = synthCw('', { snr: 1, seed: 8, padS: 6 })
    const s = findCw(mix(mine, other, noise), 700)
    expect(Math.abs(s!.hz - 700)).toBeLessThanOrEqual(12.5)
  })

  it('finds nothing in plain noise', () => {
    expect(findCw(synthCw('', { snr: 1, seed: 9, padS: 3 }), 700)).toBeUndefined()
  })
})
