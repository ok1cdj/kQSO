// CW decoder, the signal part: FFT / STFT, the spectrogram the DeepCW model takes in and
// the per-bin CW detector behind the tuning indicator.
// Ported from DeepCW (github.com/e04/web-deep-cw-decoder @ f3bea57: src/stft.ts,
// src/utils/spectrogramUtils.ts, src/utils/audioFilters.ts, src/const.ts), trimmed to
// the English narrow / wide models. Copyright (c) 2026 e04, MIT License, see
// LICENSE-DeepCW.txt next to this file.
//
// Audio runs at 9600 Hz; the models were trained at 3200 Hz (fft 256, hop 48), so the
// STFT here is scaled by 3 to keep the same window / hop durations and 12.5 Hz bins.

export const SAMPLE_RATE = 9600
export const FFT_LENGTH = 768
export const HOP_LENGTH = 144
export const OUTPUT_TIME_STRIDE = 2
export const OUTPUT_HOP_LENGTH = HOP_LENGTH * OUTPUT_TIME_STRIDE
export const BIN_RESOLUTION = SAMPLE_RATE / FFT_LENGTH
/** The wide model sees 400–1200 Hz; the narrow one only 3 bins around one tone. */
export const DECODABLE_MIN_FREQ_HZ = 400
export const DECODABLE_MAX_FREQ_HZ = 1200
export const NARROW_SHIFT_BINS = 3
export const CW_DETECT_HOP_LENGTH = 192

/** Output frame t of the model is centred on this sample of its input (centre padding). */
export function outputFrameCenterSample(frame: number): number {
  return frame * OUTPUT_HOP_LENGTH
}

// --- FFT -------------------------------------------------------------------------

/** In-place complex FFT (interleaved re/im). Radix-2 for powers of two, Bluestein otherwise
 *  (FFT_LENGTH = 768 is not a power of two). */
export class FFT {
  readonly fftSize: number
  private readonly isPowerOfTwo: boolean
  private reverseTable?: Uint32Array
  private sinTable?: Float32Array
  private cosTable?: Float32Array
  private bluesteinSize?: number
  private bluesteinChirpTable?: Float32Array
  private bluesteinKernelFft?: Float32Array
  private bluesteinFft?: FFT

  constructor(fftSize: number) {
    if (fftSize <= 0) throw new Error('FFT size must be positive.')
    this.fftSize = fftSize
    this.isPowerOfTwo = (fftSize & (fftSize - 1)) === 0
    if (this.isPowerOfTwo) this.initPowerOfTwoTables()
    else this.initBluesteinTables()
  }

  private initPowerOfTwoTables(): void {
    const n = this.fftSize
    const reverse = new Uint32Array(n)
    const sin = new Float32Array(n)
    const cos = new Float32Array(n)
    let limit = 1
    let bit = n >> 1
    while (limit < n) {
      for (let i = 0; i < limit; i++) reverse[i + limit] = reverse[i]! + bit
      limit <<= 1
      bit >>= 1
    }
    for (let i = 0; i < n; i++) {
      const angle = (-2 * Math.PI * i) / n
      sin[i] = Math.sin(angle)
      cos[i] = Math.cos(angle)
    }
    this.reverseTable = reverse
    this.sinTable = sin
    this.cosTable = cos
  }

  private initBluesteinTables(): void {
    const n = this.fftSize
    const convolutionSize = nextPowerOfTwo(n * 2 - 1)
    const chirp = new Float32Array(n * 2)
    const kernel = new Float32Array(convolutionSize * 2)
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * ((i * i) % (n * 2))) / n
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      chirp[i * 2] = c
      chirp[i * 2 + 1] = s
      kernel[i * 2] = c
      kernel[i * 2 + 1] = s
      if (i !== 0) {
        const mirrored = convolutionSize - i
        kernel[mirrored * 2] = c
        kernel[mirrored * 2 + 1] = s
      }
    }
    const fft = new FFT(convolutionSize)
    fft.transform(kernel)
    this.bluesteinSize = convolutionSize
    this.bluesteinChirpTable = chirp
    this.bluesteinKernelFft = kernel
    this.bluesteinFft = fft
  }

  transform(x: Float32Array): void {
    if (x.length !== this.fftSize * 2) throw new Error('FFT input length does not match configured FFT size.')
    if (this.isPowerOfTwo) this.powerOfTwoTransform(x)
    else this.bluesteinTransform(x)
  }

  private powerOfTwoTransform(x: Float32Array): void {
    const n = this.fftSize
    const reverse = this.reverseTable!
    const sin = this.sinTable!
    const cos = this.cosTable!
    for (let i = 0; i < n; i++) {
      const r = reverse[i]!
      if (i < r) {
        const re = x[i * 2]!
        const im = x[i * 2 + 1]!
        x[i * 2] = x[r * 2]!
        x[i * 2 + 1] = x[r * 2 + 1]!
        x[r * 2] = re
        x[r * 2 + 1] = im
      }
    }
    for (let half = 1; half < n; half *= 2) {
      const step = 2 * half
      const angleStep = n / step
      for (let i = 0; i < n; i += step) {
        for (let j = 0; j < half; j++) {
          const wRe = cos[j * angleStep]!
          const wIm = sin[j * angleStep]!
          const a = (i + j) * 2
          const b = (i + j + half) * 2
          const tr = wRe * x[b]! - wIm * x[b + 1]!
          const ti = wRe * x[b + 1]! + wIm * x[b]!
          const ur = x[a]!
          const ui = x[a + 1]!
          x[a] = ur + tr
          x[a + 1] = ui + ti
          x[b] = ur - tr
          x[b + 1] = ui - ti
        }
      }
    }
  }

  private bluesteinTransform(x: Float32Array): void {
    const n = this.fftSize
    const m = this.bluesteinSize!
    const chirp = this.bluesteinChirpTable!
    const kernel = this.bluesteinKernelFft!
    const fft = this.bluesteinFft!
    const work = new Float32Array(m * 2)
    for (let i = 0; i < n; i++) {
      const re = x[i * 2]!
      const im = x[i * 2 + 1]!
      const cRe = chirp[i * 2]!
      const cIm = chirp[i * 2 + 1]!
      work[i * 2] = re * cRe + im * cIm
      work[i * 2 + 1] = im * cRe - re * cIm
    }
    fft.transform(work)
    for (let i = 0; i < m; i++) {
      const re = work[i * 2]!
      const im = work[i * 2 + 1]!
      const kRe = kernel[i * 2]!
      const kIm = kernel[i * 2 + 1]!
      work[i * 2] = re * kRe - im * kIm
      work[i * 2 + 1] = re * kIm + im * kRe
    }
    inverseTransform(work, fft)
    for (let i = 0; i < n; i++) {
      const re = work[i * 2]!
      const im = work[i * 2 + 1]!
      const cRe = chirp[i * 2]!
      const cIm = chirp[i * 2 + 1]!
      x[i * 2] = re * cRe + im * cIm
      x[i * 2 + 1] = im * cRe - re * cIm
    }
  }
}

function nextPowerOfTwo(value: number): number {
  let p = 1
  while (p < value) p <<= 1
  return p
}

function inverseTransform(x: Float32Array, fft: FFT): void {
  const n = fft.fftSize
  for (let i = 0; i < n; i++) x[i * 2 + 1] = -x[i * 2 + 1]!
  fft.transform(x)
  for (let i = 0; i < n; i++) {
    x[i * 2] = x[i * 2]! / n
    x[i * 2 + 1] = -x[i * 2 + 1]! / n
  }
}

// --- STFT ------------------------------------------------------------------------

/** Hann-windowed STFT; hands each frame's spectrum (interleaved re/im) to a callback. */
export class STFT {
  private readonly fft: FFT
  private readonly window: Float32Array
  private readonly complexFrame: Float32Array

  constructor(
    readonly fftSize: number,
    readonly hopSize: number,
  ) {
    if (fftSize <= 0) throw new Error('FFT size must be positive.')
    if (hopSize <= 0) throw new Error('Hop size must be positive.')
    this.fft = new FFT(fftSize)
    this.window = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize))
    this.complexFrame = new Float32Array(fftSize * 2)
  }

  frameCount(signalLength: number): number {
    if (signalLength < this.fftSize) return 0
    return Math.floor((signalLength - this.fftSize) / this.hopSize) + 1
  }

  forEachSpectrum(signal: Float32Array, each: (spectrum: Float32Array, frame: number) => void): number {
    const frame = this.complexFrame
    let index = 0
    for (let i = 0; i + this.fftSize <= signal.length; i += this.hopSize) {
      for (let j = 0; j < this.fftSize; j++) {
        frame[j * 2] = signal[i + j]! * this.window[j]!
        frame[j * 2 + 1] = 0
      }
      this.fft.transform(frame)
      each(frame, index)
      index++
    }
    return index
  }
}

// --- spectrogram (model input) ---------------------------------------------------------

/** Model input: [batch, channel, time, frequency]. */
export interface Spectrogram {
  data: Float32Array
  dims: [1, 1, number, number]
}

const stft = new STFT(FFT_LENGTH, HOP_LENGTH)
const TOTAL_BINS = FFT_LENGTH / 2 + 1
const START_BIN = Math.ceil(DECODABLE_MIN_FREQ_HZ / BIN_RESOLUTION)
const END_BIN = Math.floor(DECODABLE_MAX_FREQ_HZ / BIN_RESOLUTION) + 1
const CROPPED_BINS = END_BIN - START_BIN // 65, what the wide model takes
const CENTER_PAD = FFT_LENGTH / 2
const NORMAL_CENTER_BIN = Math.round((START_BIN + END_BIN - 1) / 2) // bin 64 = 800 Hz
const NARROW_CENTER_IDX = Math.floor(NARROW_SHIFT_BINS / 2)
const NOISE_LEVEL_QUANTILE = 0.9
const NOISE_LEVEL_RAYLEIGH_FACTOR = Math.sqrt(-2 * Math.log(1 - NOISE_LEVEL_QUANTILE))
const NOISE_LEVEL_MIN_RELATIVE_TO_PEAK = 1e-3
const NOISE_LEVEL_MIN = 1e-5

/** The model's "noise_q90_log1p" normalisation, in place. `noiseSource` lets zero-filled
 *  bins be left out of the noise estimate. */
function normalizeNoiseLog1p(spec: Float32Array, noiseSource: Float32Array = spec): void {
  if (noiseSource.length === 0) return
  const sorted = Float32Array.from(noiseSource).sort()
  const noise = Math.max(
    sorted[Math.floor(NOISE_LEVEL_QUANTILE * (sorted.length - 1))]! / NOISE_LEVEL_RAYLEIGH_FACTOR,
    sorted[sorted.length - 1]! * NOISE_LEVEL_MIN_RELATIVE_TO_PEAK,
    NOISE_LEVEL_MIN,
  )
  for (let i = 0; i < spec.length; i++) spec[i] = Math.log1p(spec[i]! / noise)
}

/** Reflect-pads like a centred STFT so frame t is centred on sample t * HOP_LENGTH. */
function centerPad(audio: Float32Array): Float32Array | undefined {
  if (audio.length <= CENTER_PAD + 1) return undefined
  const padded = new Float32Array(audio.length + CENTER_PAD * 2)
  for (let i = 0; i < CENTER_PAD; i++) {
    padded[i] = audio[CENTER_PAD - i]!
    padded[CENTER_PAD + audio.length + i] = audio[audio.length - 2 - i]!
  }
  padded.set(audio, CENTER_PAD)
  return padded
}

function magnitude(spectrum: Float32Array, bin: number): number {
  const re = spectrum[bin * 2]!
  const im = spectrum[bin * 2 + 1]!
  return Math.sqrt(re * re + im * im)
}

/** Wide model, whole 400–1200 Hz band, optionally band-passed around `filterHz`. */
export function wideSpectrogram(audio: Float32Array, filterHz?: number, filterWidthHz?: number): Spectrogram | undefined {
  const input = filterHz !== undefined && filterWidthHz ? bandpass(audio, SAMPLE_RATE, filterHz, filterWidthHz) : audio
  const padded = centerPad(input)
  if (!padded) return undefined
  const steps = stft.frameCount(padded.length)
  const data = new Float32Array(steps * CROPPED_BINS)
  stft.forEachSpectrum(padded, (spectrum, frame) => {
    const offset = frame * CROPPED_BINS
    for (let bin = START_BIN; bin < END_BIN; bin++) data[offset + bin - START_BIN] = magnitude(spectrum, bin)
  })
  normalizeNoiseLog1p(data)
  return { data, dims: [1, 1, steps, CROPPED_BINS] }
}

/** Wide model fed only `widthHz` around `targetHz`, moved to its 800 Hz centre; the other
 *  bins stay zero (and out of the noise estimate). */
export function shiftedSpectrogram(audio: Float32Array, targetHz: number, widthHz: number): Spectrogram | undefined {
  const padded = centerPad(audio)
  if (!padded) return undefined
  const steps = stft.frameCount(padded.length)
  const targetBin = Math.round(targetHz / BIN_RESOLUTION)
  const halfWidth = Math.ceil(widthHz / 2 / BIN_RESOLUTION)
  const destCenter = NORMAL_CENTER_BIN - START_BIN
  const data = new Float32Array(steps * CROPPED_BINS)
  stft.forEachSpectrum(padded, (spectrum, frame) => {
    const offset = frame * CROPPED_BINS
    for (let d = -halfWidth; d <= halfWidth; d++) {
      const src = targetBin + d
      const dest = destCenter + d
      if (src >= 0 && src < TOTAL_BINS && dest >= 0 && dest < CROPPED_BINS) data[offset + dest] = magnitude(spectrum, src)
    }
  })
  const destStart = Math.max(0, destCenter - halfWidth)
  const destEnd = Math.min(CROPPED_BINS, destCenter + halfWidth + 1)
  const populated = new Float32Array(steps * (destEnd - destStart))
  for (let t = 0; t < steps; t++) {
    populated.set(data.subarray(t * CROPPED_BINS + destStart, t * CROPPED_BINS + destEnd), t * (destEnd - destStart))
  }
  normalizeNoiseLog1p(data, populated)
  return { data, dims: [1, 1, steps, CROPPED_BINS] }
}

/** Narrow model: just the 3 bins around the tone at `targetHz`. */
export function narrowSpectrogram(audio: Float32Array, targetHz: number): Spectrogram | undefined {
  const padded = centerPad(audio)
  if (!padded) return undefined
  const steps = stft.frameCount(padded.length)
  const targetBin = Math.round(targetHz / BIN_RESOLUTION)
  const data = new Float32Array(steps * NARROW_SHIFT_BINS)
  stft.forEachSpectrum(padded, (spectrum, frame) => {
    const offset = frame * NARROW_SHIFT_BINS
    for (let d = -NARROW_CENTER_IDX; d <= NARROW_CENTER_IDX; d++) {
      const src = targetBin + d
      if (src >= 0 && src < TOTAL_BINS) data[offset + NARROW_CENTER_IDX + d] = magnitude(spectrum, src)
    }
  })
  normalizeNoiseLog1p(data)
  return { data, dims: [1, 1, steps, NARROW_SHIFT_BINS] }
}

/** Band-pass biquad, run `passes` times for a steeper skirt. */
export function bandpass(audio: Float32Array, sampleRate: number, centerHz: number, widthHz: number, passes = 4): Float32Array {
  const q = centerHz / widthHz
  const omega = (2 * Math.PI * centerHz) / sampleRate
  const alpha = Math.sin(omega) / (2 * q)
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const b2 = -alpha / a0
  const a1 = (-2 * Math.cos(omega)) / a0
  const a2 = (1 - alpha) / a0
  let input = audio
  let output = new Float32Array(audio.length)
  for (let p = 0; p < passes; p++) {
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i]!
      const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2
      output[i] = y0
      x2 = x1
      x1 = x0
      y2 = y1
      y1 = y0
    }
    input = output
    if (p < passes - 1) output = new Float32Array(audio.length)
  }
  return output
}

// --- CW detection ----------------------------------------------------------------------

const cwDetectStft = new STFT(FFT_LENGTH, CW_DETECT_HOP_LENGTH)
const CW_ON_LEVEL_QUANTILE = 0.9
// Keying sidebands of a strong signal show up as weaker peaks next to it.
const CW_SIDEBAND_MASK_HZ = 150
const CW_SIDEBAND_MASK_DB = 18

export interface BinSnr {
  frequencies: number[]
  snrDb: Float32Array
}

/** Per-bin CW SNR: the bin's keyed-on power (90th percentile over time) against the median
 *  power of the whole band. Pure noise scores about 5 dB. Bins far weaker than a nearby
 *  strong one are taken for its keying sidebands and dropped to 0 dB. */
export function estimateCwBinSnr(audio: Float32Array, minHz: number, maxHz: number): BinSnr | undefined {
  const steps = cwDetectStft.frameCount(audio.length)
  if (steps === 0) return undefined
  const minBin = Math.max(0, Math.ceil(Math.max(0, minHz) / BIN_RESOLUTION))
  const maxBin = Math.min(TOTAL_BINS - 1, Math.floor(Math.min(SAMPLE_RATE / 2, maxHz) / BIN_RESOLUTION))
  const bins = maxBin - minBin + 1
  if (bins <= 0) return undefined

  const powers = new Float32Array(bins * steps)
  cwDetectStft.forEachSpectrum(audio, (spectrum, frame) => {
    for (let bin = minBin; bin <= maxBin; bin++) {
      const re = spectrum[bin * 2]!
      const im = spectrum[bin * 2 + 1]!
      powers[(bin - minBin) * steps + frame] = re * re + im * im
    }
  })
  const noise = Math.max(Float32Array.from(powers).sort()[Math.floor(powers.length / 2)]!, 1e-12)
  const snr = new Float32Array(bins)
  for (let i = 0; i < bins; i++) {
    const sorted = powers.subarray(i * steps, (i + 1) * steps).slice().sort()
    const on = sorted[Math.floor(CW_ON_LEVEL_QUANTILE * (steps - 1))]!
    snr[i] = 10 * Math.log10(Math.max(on, 1e-12) / noise)
  }

  const mask = Math.round(CW_SIDEBAND_MASK_HZ / BIN_RESOLUTION)
  const masked = snr.slice()
  for (let i = 0; i < bins; i++) {
    for (let j = Math.max(0, i - mask); j <= Math.min(bins - 1, i + mask); j++) {
      if (snr[j]! - snr[i]! > CW_SIDEBAND_MASK_DB) {
        masked[i] = 0
        break
      }
    }
  }
  return { frequencies: Array.from({ length: bins }, (_, i) => (minBin + i) * BIN_RESOLUTION), snrDb: masked }
}
