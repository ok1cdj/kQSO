// End-to-end with the real DeepCW models: synthetic CW → spectrogram → onnxruntime-web →
// CTC → text. The models aren't in the repo (they're downloaded on demand by the app), so
// this runs only when CW_MODEL_DIR points at a directory with model_narrow.onnx and
// model.onnx from github.com/e04/deepcw-engine:
//   CW_MODEL_DIR=/path/to/models npx vitest run tests/cw-model.test.ts

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ort from 'onnxruntime-web'
import { narrowSpectrogram, wideSpectrogram, type Spectrogram } from '../src/core/cw/dsp'
import { bestPath, decodeCtc } from '../src/core/cw/ctc'
import { CwStream } from '../src/core/cw/stream'
import { synthCw } from './cw-synth'

const dir = process.env.CW_MODEL_DIR ?? ''
const present = dir !== '' && existsSync(join(dir, 'model_narrow.onnx')) && existsSync(join(dir, 'model.onnx'))

describe.skipIf(!present)('DeepCW models', () => {
  ort.env.wasm.numThreads = 1
  const load = (name: string) => ort.InferenceSession.create(readFileSync(join(dir, name)), { executionProviders: ['wasm'] })

  async function decode(session: ort.InferenceSession, spec: Spectrogram | undefined): Promise<string> {
    const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', spec!.data, spec!.dims) })
    const t = out[session.outputNames[0]!]!
    return decodeCtc(bestPath(t.data as Float32Array, t.dims[1]!, t.dims[2]!)).text.trim()
  }

  const text = 'CQ TEST DE OK1CDJ OK1CDJ K'

  it.each([
    [20, 700, 4],
    [28, 600, 2],
    [16, 650, 1],
    [35, 700, 3],
  ])('narrow and wide decode %i WPM at %i Hz, SNR %f', async (wpm, pitchHz, snr) => {
    const [narrow, wide] = await Promise.all([load('model_narrow.onnx'), load('model.onnx')])
    const audio = synthCw(text, { wpm, pitchHz, snr, seed: wpm })
    expect(await decode(narrow, narrowSpectrogram(audio, pitchHz))).toBe(text)
    expect(await decode(wide, wideSpectrogram(audio))).toBe(text)
  }, 30_000)

  it('streams a QSO in 1 s chunks', async () => {
    const narrow = await load('model_narrow.onnx')
    const audio = synthCw('CQ CQ TEST DE OK1CDJ OK1CDJ TEST K OK2IH 5NN 001 JO70FD TU', { wpm: 24, pitchHz: 700, snr: 3, seed: 3 })
    const stream = new CwStream()
    const committed: string[] = []
    const infer = async (a: Float32Array) => {
      const spec = narrowSpectrogram(a, 700)!
      const out = await narrow.run({ [narrow.inputNames[0]!]: new ort.Tensor('float32', spec.data, spec.dims) })
      const t = out[narrow.outputNames[0]!]!
      return decodeCtc(bestPath(t.data as Float32Array, t.dims[1]!, t.dims[2]!))
    }
    for (let i = 0; i < audio.length; i += 9600) {
      stream.push(audio.subarray(i, i + 9600))
      const step = await stream.step(infer)
      if (step?.committed) committed.push(step.committed)
    }
    expect(committed.join(' ')).toBe('CQ CQ TEST DE OK1CDJ OK1CDJ TEST K OK2IH 5NN 001 JO70FD')
  }, 60_000)
})
