// Message protocol between the main thread (WebPlatform) and the OPFS worker.
// DOM-free: shared by a DOM program and a WebWorker program.

export type WorkerRequest =
  | { id: number; op: 'createHeader'; logId: string; content: string }
  | { id: number; op: 'append'; logId: string; text: string }
  | { id: number; op: 'read'; logId: string }
  | { id: number; op: 'rewrite'; logId: string; content: string }
  | { id: number; op: 'delete'; logId: string }
  | { id: number; op: 'writeJournal'; logId: string; text: string }
  | { id: number; op: 'readJournal'; logId: string }
  | { id: number; op: 'clearJournal'; logId: string }
  | { id: number; op: 'list' }
  | { id: number; op: 'readSettings' }
  | { id: number; op: 'writeSettings'; content: string }
  | { id: number; op: 'readCallDb' }
  | { id: number; op: 'writeCallDb'; content: string }
  | { id: number; op: 'readRefTile'; field: string }
  | { id: number; op: 'writeRefTile'; field: string; content: string }
  | { id: number; op: 'listRefTiles' }
  | { id: number; op: 'removeRefTile'; field: string }

export type WorkerResponse =
  | { id: number; ok: true; value?: unknown }
  | { id: number; ok: false; error: string }

/** WorkerRequest variants with the `id` stripped (assigned by the RPC layer). */
export type RequestBody = WorkerRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never
