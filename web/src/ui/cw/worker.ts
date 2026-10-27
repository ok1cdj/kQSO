// CW decoder worker: keeps the DeepCW models and the ONNX runtime in OPFS (cw/), runs
// the model and the streaming transcript, so the main thread only sends audio and shows
// text. Downloads come from <site>/cw/ (scripts/cwdata.py) and are checked against the
// pinned sha256 before they are stored. Inference is single-threaded: without COOP/COEP
// there is no SharedArrayBuffer, and the narrow model needs ~0.2 s per step anyway.

/// <reference lib="webworker" />
import type * as Ort from 'onnxruntime-web'
import ortGlueUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import assets from '../../core/cw/assets.json'
import { bestPath, decodeCtc, type CtcResult } from '../../core/cw/ctc'
import { narrowSpectrogram, shiftedSpectrogram, wideSpectrogram, type Spectrogram } from '../../core/cw/dsp'
import { CwStream } from '../../core/cw/stream'
import type { CwAsset, CwModel, CwRequest, CwResponse, CwStatus, CwTuning } from './protocol'

declare const self: DedicatedWorkerGlobalScope

// VITE_CW_URL (e.g. http://localhost:8099/) points a dev build at local files.
const CW_URL: string = import.meta.env.VITE_CW_URL || 'https://kqso.ok1cdj.com/cw/'
const DIR = 'cw'
const STEP_MS = 1000

interface FileSpec {
  file: string
  bytes: number
  sha256: string
}

const FILES: Record<CwAsset, FileSpec> = {
  ort: __CW_ORT__,
  narrow: assets.models.narrow,
  wide: assets.models.wide,
}

function post(msg: CwResponse): void {
  self.postMessage(msg)
}

// --- OPFS ----------------------------------------------------------------------------

async function dir(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true })
}

async function storedSize(name: string): Promise<number> {
  try {
    return (await (await (await dir()).getFileHandle(name)).getFile()).size
  } catch {
    return -1
  }
}

async function readFile(name: string): Promise<ArrayBuffer> {
  return (await (await (await dir()).getFileHandle(name)).getFile()).arrayBuffer()
}

async function writeFile(name: string, data: Uint8Array): Promise<void> {
  const handle = await (await dir()).getFileHandle(name, { create: true })
  const access = await handle.createSyncAccessHandle()
  try {
    access.truncate(0)
    access.write(data, { at: 0 })
    access.flush()
  } finally {
    access.close()
  }
}

/** Files of an older runtime or model, left behind by an update. */
async function removeStale(): Promise<void> {
  const keep = new Set(Object.values(FILES).map((f) => f.file))
  const d = await dir()
  for await (const name of d.keys()) if (!keep.has(name)) await d.removeEntry(name)
}

async function isStored(asset: CwAsset): Promise<boolean> {
  return (await storedSize(FILES[asset].file)) === FILES[asset].bytes
}

async function status(): Promise<CwStatus> {
  const one = async (a: CwAsset) => ({ bytes: FILES[a].bytes, stored: await isStored(a) })
  return { ort: await one('ort'), narrow: await one('narrow'), wide: await one('wide') }
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The runtime and `model`, whichever aren't stored yet, with progress over both. */
async function download(model: CwModel): Promise<void> {
  const missing: CwAsset[] = []
  for (const a of ['ort', model] as const) if (!(await isStored(a))) missing.push(a)
  const total = missing.reduce((sum, a) => sum + FILES[a].bytes, 0)
  let loaded = 0
  post({ id: 0, event: 'progress', loaded, total })
  for (const asset of missing) {
    const spec = FILES[asset]
    const res = await fetch(CW_URL + spec.file)
    if (!res.ok || !res.body) throw new Error(`${spec.file}: HTTP ${res.status}`)
    const data = new Uint8Array(spec.bytes)
    let at = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (at + value.length > data.length) throw new Error(`${spec.file}: larger than expected`)
      data.set(value, at)
      at += value.length
      loaded += value.length
      post({ id: 0, event: 'progress', loaded, total })
    }
    if (at !== spec.bytes || hex(await crypto.subtle.digest('SHA-256', data)) !== spec.sha256) {
      throw new Error(`${spec.file}: corrupted download`)
    }
    await writeFile(spec.file, data)
  }
  await removeStale()
}

async function remove(): Promise<void> {
  stop()
  sessions.clear()
  await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true })
}

// --- inference -------------------------------------------------------------------------

let ortModule: Promise<typeof Ort> | undefined
const sessions = new Map<CwModel, Promise<Ort.InferenceSession>>()

/** Fetch the runtime's JS while online, so the service worker has it for the field: it
 *  caches lazily and starts empty after every deploy. The wasm and models are in OPFS. */
async function warm(): Promise<void> {
  await Promise.all([import('onnxruntime-web/wasm'), fetch(ortGlueUrl)])
}

function runtime(): Promise<typeof Ort> {
  ortModule ??= (async () => {
    const binary = await readFile(FILES.ort.file)
    const ort = await import('onnxruntime-web/wasm')
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = { mjs: ortGlueUrl }
    ort.env.wasm.wasmBinary = binary
    return ort
  })()
  ortModule.catch(() => (ortModule = undefined))
  return ortModule
}

function session(model: CwModel): Promise<Ort.InferenceSession> {
  let s = sessions.get(model)
  if (!s) {
    s = (async () => {
      const ort = await runtime()
      return ort.InferenceSession.create(new Uint8Array(await readFile(FILES[model].file)), { executionProviders: ['wasm'] })
    })()
    s.catch(() => sessions.delete(model))
    sessions.set(model, s)
  }
  return s
}

function spectrogram(audio: Float32Array, t: CwTuning): Spectrogram | undefined {
  if (t.model === 'narrow') return narrowSpectrogram(audio, t.pitchHz)
  return t.widthHz ? shiftedSpectrogram(audio, t.pitchHz, t.widthHz) : wideSpectrogram(audio)
}

async function infer(audio: Float32Array, t: CwTuning): Promise<CtcResult> {
  const spec = spectrogram(audio, t)
  if (!spec) return { text: '', wordGaps: [], chars: [] }
  const [ort, s] = await Promise.all([runtime(), session(t.model)])
  const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', spec.data, spec.dims) })
  const logProbs = out[s.outputNames[0]!]!
  return decodeCtc(bestPath(logProbs.data as Float32Array, logProbs.dims[1]!, logProbs.dims[2]!))
}

// --- streaming -------------------------------------------------------------------------

const stream = new CwStream()
let tuning: CwTuning | undefined
let timer: ReturnType<typeof setInterval> | undefined
let busy = false

async function start(t: CwTuning): Promise<void> {
  await session(t.model) // load now, so a missing or broken file shows as an error here
  tuning = t
  stream.reset()
  timer ??= setInterval(() => void pump(), STEP_MS)
}

function tune(t: CwTuning): void {
  if (!tuning) return
  tuning = t
  stream.reset()
  post({ id: 0, event: 'text', committed: '', pending: '' })
}

function stop(): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  tuning = undefined
  stream.reset()
}

async function pump(): Promise<void> {
  const t = tuning
  if (busy || !t) return
  busy = true
  try {
    const step = await stream.step((audio) => infer(audio, t))
    if (step && tuning === t) post({ id: 0, event: 'text', ...step })
  } catch (err) {
    // The same audio would fail again every second: stop until the next start.
    stop()
    post({ id: 0, event: 'error', error: err instanceof Error ? err.message : String(err) })
  } finally {
    busy = false
  }
}

// --- messages -------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<CwRequest>) => {
  const req = e.data
  if (req.op === 'audio') {
    if (tuning) stream.push(req.samples)
    return
  }
  try {
    let value: unknown
    switch (req.op) {
      case 'status':
        value = await status()
        break
      case 'warm':
        await warm()
        break
      case 'download':
        await download(req.model)
        break
      case 'remove':
        await remove()
        break
      case 'start':
        await start(req.tuning)
        break
      case 'tune':
        tune(req.tuning)
        break
      case 'stop':
        stop()
        break
    }
    post({ id: req.id, ok: true, value })
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
