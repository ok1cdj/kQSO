// OPFS worker: the ONLY place that touches the filesystem. Each op opens a
// FileSystemSyncAccessHandle, does its work, and closes it — appends write at the
// current end of file (append, never rewrite). Pure I/O; parsing stays on
// the main thread.

/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from './protocol'

declare const self: DedicatedWorkerGlobalScope

const enc = new TextEncoder()
const dec = new TextDecoder()

const adi = (id: string): string => `${id}.adi`
const journal = (id: string): string => `${id}.journal`
const SETTINGS = '_settings.json' // not a *.adi, so it never shows up in listIds()
const CALLDB = '_calldb.tsv' // callsign DB live layer — likewise not a log

function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function writeFile(name: string, content: string, append: boolean): Promise<void> {
  const dir = await root()
  const fh = await dir.getFileHandle(name, { create: true })
  const h = await fh.createSyncAccessHandle()
  try {
    if (!append) h.truncate(0)
    const at = append ? h.getSize() : 0
    h.write(enc.encode(content), { at })
    h.flush()
  } finally {
    h.close()
  }
}

async function readFile(name: string): Promise<string> {
  const dir = await root()
  let fh: FileSystemFileHandle
  try {
    fh = await dir.getFileHandle(name, { create: false })
  } catch {
    return '' // missing file (e.g. journal never written) → empty
  }
  const h = await fh.createSyncAccessHandle()
  try {
    const size = h.getSize()
    const buf = new Uint8Array(size)
    h.read(buf, { at: 0 })
    return dec.decode(buf)
  } finally {
    h.close()
  }
}

async function remove(name: string): Promise<void> {
  const dir = await root()
  try {
    await dir.removeEntry(name)
  } catch {
    /* already gone */
  }
}

async function listIds(): Promise<string[]> {
  const dir = await root()
  const ids: string[] = []
  for await (const name of dir.keys()) {
    if (name.endsWith('.adi')) ids.push(name.slice(0, -4))
  }
  return ids
}

async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.op) {
    case 'createHeader':
      return writeFile(adi(req.logId), req.content, false)
    case 'append':
      return writeFile(adi(req.logId), req.text, true)
    case 'read':
      return readFile(adi(req.logId))
    case 'rewrite':
      return writeFile(adi(req.logId), req.content, false)
    case 'delete':
      await remove(adi(req.logId))
      await remove(journal(req.logId))
      return
    case 'writeJournal':
      return writeFile(journal(req.logId), req.text, false)
    case 'readJournal':
      return readFile(journal(req.logId))
    case 'clearJournal':
      return writeFile(journal(req.logId), '', false)
    case 'list':
      return listIds()
    case 'readSettings':
      return readFile(SETTINGS)
    case 'writeSettings':
      return writeFile(SETTINGS, req.content, false)
    case 'readCallDb':
      return readFile(CALLDB)
    case 'writeCallDb':
      return writeFile(CALLDB, req.content, false)
  }
}

self.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  handle(req)
    .then((value) => {
      const resp: WorkerResponse = { id: req.id, ok: true, value }
      self.postMessage(resp)
    })
    .catch((err: unknown) => {
      const resp: WorkerResponse = { id: req.id, ok: false, error: String(err) }
      self.postMessage(resp)
    })
})
