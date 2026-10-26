// Synthetic CW for the decoder tests: PARIS timing, 5 ms raised-cosine edges, white
// Gaussian noise from a seeded PRNG, so the same arguments always give the same samples.

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....',
  '6': '-....', '7': '--...', '8': '---..', '9': '----.', '/': '-..-.', '?': '..--..',
  '.': '.-.-.-', ',': '--..--',
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SynthOptions {
  wpm?: number
  pitchHz?: number
  /** Tone amplitude over the noise standard deviation; Infinity = no noise. */
  snr?: number
  sampleRate?: number
  seed?: number
  /** Silence before and after, in seconds. */
  padS?: number
}

/** Keying envelope (1 = tone) per sample for `text`. */
function envelope(text: string, wpm: number, sampleRate: number, padS: number): Float32Array {
  const dot = Math.round((1.2 / wpm) * sampleRate)
  const on: boolean[] = []
  const add = (units: number, value: boolean) => {
    for (let i = 0; i < units * dot; i++) on.push(value)
  }
  const pad = Math.round(padS * sampleRate)
  for (let i = 0; i < pad; i++) on.push(false)
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  words.forEach((word, w) => {
    if (w > 0) add(7, false)
    Array.from(word).forEach((ch, c) => {
      if (c > 0) add(3, false)
      Array.from(MORSE[ch] ?? '').forEach((el, e) => {
        if (e > 0) add(1, false)
        add(el === '.' ? 1 : 3, true)
      })
    })
  })
  for (let i = 0; i < pad; i++) on.push(false)

  // 5 ms raised-cosine edges against key clicks.
  const edge = Math.max(1, Math.round(0.005 * sampleRate))
  const env = new Float32Array(on.length)
  let level = 0
  for (let i = 0; i < on.length; i++) {
    level = on[i] ? Math.min(1, level + 1 / edge) : Math.max(0, level - 1 / edge)
    env[i] = 0.5 - 0.5 * Math.cos(Math.PI * level)
  }
  return env
}

export function synthCw(text: string, opts: SynthOptions = {}): Float32Array {
  const { wpm = 20, pitchHz = 700, snr = 4, sampleRate = 9600, seed = 1, padS = 1 } = opts
  const env = envelope(text, wpm, sampleRate, padS)
  const random = mulberry32(seed)
  const out = new Float32Array(env.length)
  const amplitude = 0.3
  const sigma = Number.isFinite(snr) ? amplitude / snr : 0
  for (let i = 0; i < env.length; i++) {
    // Box–Muller
    const u = Math.max(random(), 1e-12)
    const v = random()
    const noise = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    out[i] = amplitude * env[i]! * Math.sin((2 * Math.PI * pitchHz * i) / sampleRate) + sigma * noise
  }
  return out
}
