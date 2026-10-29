// CW decoder: the input's native rate (44.1 / 48 kHz) down to the decoder's 9600 Hz, where
// the browser can't do it (WebKit, the iOS app: an AudioContext at 9600 Hz with a
// microphone source). Chrome resamples itself (ui/cw/audio.ts). A windowed-sinc low-pass
// below the new Nyquist, then linear interpolation between the filtered samples. Streaming:
// blocks of any length, the filter history and the read position carry over.

/** Taps of the low-pass FIR (odd: a centre tap). 63 at 48 kHz: down by ~50 dB from 5.6 kHz,
 *  so what folds back onto the CW tones (400–1200 Hz) comes from 8.4 kHz and up. */
const TAPS = 63

export class Resampler {
  private readonly taps: Float32Array
  /** Input samples per output sample. */
  private readonly step: number
  /** The last TAPS − 1 input samples (the filter's memory). */
  private history: Float32Array
  /** Where the next output sample lies, in input samples from the current block's start;
   *  −1 … 0 = between the previous block's last filtered sample and this block's first. */
  private pos = 0
  private lastFiltered = 0

  constructor(fromRate: number, toRate: number) {
    this.step = fromRate / toRate
    this.taps = lowPass(TAPS, (0.45 * toRate) / fromRate)
    this.history = new Float32Array(TAPS - 1)
  }

  /** One block in, the resampled samples it completes out (possibly none). */
  process(input: Float32Array): Float32Array {
    const n = input.length
    if (n === 0) return new Float32Array(0)
    // History + block, filtered at the input rate.
    const buf = new Float32Array(this.history.length + n)
    buf.set(this.history)
    buf.set(input, this.history.length)
    const filtered = new Float32Array(n)
    const taps = this.taps
    for (let i = 0; i < n; i++) {
      let acc = 0
      for (let k = 0; k < TAPS; k++) acc += taps[k]! * buf[i + k]!
      filtered[i] = acc
    }
    this.history = buf.slice(n)

    const out = new Float32Array(Math.max(0, Math.ceil((n - 1 - this.pos) / this.step)))
    let count = 0
    let pos = this.pos
    while (pos < n - 1) {
      const i = Math.floor(pos)
      const frac = pos - i
      const a = i < 0 ? this.lastFiltered : filtered[i]!
      const b = filtered[i + 1]!
      out[count++] = a + (b - a) * frac
      pos += this.step
    }
    this.pos = pos - n
    this.lastFiltered = filtered[n - 1]!
    return count === out.length ? out : out.slice(0, count)
  }
}

/** Hamming-windowed sinc, `cutoff` in cycles per sample, unity gain at DC. */
function lowPass(length: number, cutoff: number): Float32Array {
  const m = (length - 1) / 2
  const h = new Float32Array(length)
  let sum = 0
  for (let i = 0; i < length; i++) {
    const x = i - m
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1)))
    sum += h[i]!
  }
  for (let i = 0; i < length; i++) h[i] = h[i]! / sum
  return h
}
