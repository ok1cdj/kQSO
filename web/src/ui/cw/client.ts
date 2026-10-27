// CW decoder, main-thread side: the RPC to the CW worker (models, inference, transcript)
// and the audio capture that feeds it. Web only for now: the Android and iOS apps need
// microphone permissions in their shells first (plans/cw-dekoder.md, phase 2).

import { platformKind } from '../../platform/index'
import type { CwModel, CwRequestBody, CwResponse, CwStatus, CwTuning } from './protocol'

export type { CwModel, CwStatus, CwTuning } from './protocol'

/** The browser can store the models (OPFS), run the worker and record audio into a
 *  9600 Hz AudioContext. Chrome / Edge only: Firefox refuses to connect a 48 kHz input
 *  to a context at another rate. */
export function cwDecoderAvailable(): boolean {
  return platformKind() === 'opfs' && typeof navigator.mediaDevices?.getUserMedia === 'function' && /Chrome\//.test(navigator.userAgent)
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export class CwDecoderClient {
  private worker: Worker | undefined
  private seq = 0
  private readonly pending = new Map<number, Pending>()
  private progress: ((loaded: number, total: number) => void) | undefined
  /** New committed text (append it) and the pending tail (replaces the previous one). */
  onText: ((committed: string, pending: string) => void) | undefined
  /** The tuning indicator: the CW signal heard, undefined = none. */
  onSignal: ((signal: { hz: number; snrDb: number } | undefined) => void) | undefined
  /** The decode loop failed (a broken model file, out of memory). */
  onError: ((error: string) => void) | undefined

  status(): Promise<CwStatus> {
    return this.call({ op: 'status' })
  }

  /** Load the worker and the runtime's JS now (online), so they work offline later. */
  warm(): Promise<void> {
    return this.call({ op: 'warm' })
  }

  /** The runtime and the model, whichever aren't stored yet. */
  async download(model: CwModel, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    this.progress = onProgress
    try {
      await this.call({ op: 'download', model })
    } finally {
      this.progress = undefined
    }
  }

  remove(): Promise<void> {
    return this.call({ op: 'remove' })
  }

  start(tuning: CwTuning): Promise<void> {
    return this.call({ op: 'start', tuning })
  }

  /** New pitch / model / filter; the transcript so far stays, the audio buffer restarts. */
  tune(tuning: CwTuning): Promise<void> {
    return this.call({ op: 'tune', tuning })
  }

  stop(): Promise<void> {
    return this.call({ op: 'stop' })
  }

  audio(samples: Float32Array): void {
    this.get().postMessage({ id: 0, op: 'audio', samples }, [samples.buffer])
  }

  private get(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<CwResponse>) => this.receive(e.data)
    }
    return this.worker
  }

  private receive(msg: CwResponse): void {
    if ('event' in msg) {
      if (msg.event === 'progress') this.progress?.(msg.loaded, msg.total)
      else if (msg.event === 'text') this.onText?.(msg.committed, msg.pending)
      else if (msg.event === 'signal') this.onSignal?.(msg.signal ?? undefined)
      else this.onError?.(msg.error)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.value)
    else p.reject(new Error(msg.error))
  }

  private call<T>(body: CwRequestBody): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.get().postMessage({ ...body, id })
    })
  }
}
