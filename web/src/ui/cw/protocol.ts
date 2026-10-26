// Message protocol between the main thread (CwDecoderClient) and the CW worker.
// DOM-free: shared by a DOM program and a WebWorker program.

export type CwModel = 'narrow' | 'wide'

/** What the decoder listens to. */
export interface CwTuning {
  model: CwModel
  /** The CW tone the station is tuned to (the rig's CW pitch). */
  pitchHz: number
  /** Wide model only: band around the pitch it hears; undefined = the whole 400–1200 Hz. */
  widthHz?: number
}

/** One download: the runtime or a model. */
export type CwAsset = 'ort' | CwModel

export interface CwAssetStatus {
  bytes: number
  stored: boolean
}

export type CwStatus = Record<CwAsset, CwAssetStatus>

export type CwRequest =
  | { id: number; op: 'status' }
  | { id: number; op: 'download'; model: CwModel }
  | { id: number; op: 'remove' }
  | { id: number; op: 'start'; tuning: CwTuning }
  | { id: number; op: 'tune'; tuning: CwTuning }
  | { id: number; op: 'stop' }
  // fire-and-forget: mono 9600 Hz samples, transferred
  | { id: 0; op: 'audio'; samples: Float32Array }

/** Replies carry the request id; events (id 0) come by themselves. */
export type CwResponse =
  | { id: number; ok: true; value?: unknown }
  | { id: number; ok: false; error: string }
  | { id: 0; event: 'progress'; loaded: number; total: number }
  | { id: 0; event: 'text'; committed: string; pending: string }
  | { id: 0; event: 'error'; error: string }

/** CwRequest variants with the `id` stripped (assigned by the RPC layer). */
export type CwRequestBody = CwRequest extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never
