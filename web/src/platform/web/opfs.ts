// Web KQSOPlatform: OPFS-backed, all file I/O delegated to the worker (the only
// place SyncAccessHandle works). Parsing (readLogFile) stays here on the main
// thread so the worker is pure I/O. Export/share/keepAwake are minimal here.

import type { LogMeta } from '../../core/model'
import { readLogFile, writeLogHeader } from '../../core/index'
import type { KQSOPlatform, KeyerTransport, LogSummary } from '../types'
import { WebBluetoothKeyer, webBluetoothAvailable } from './keyer'
import type { RequestBody, WorkerRequest, WorkerResponse } from './protocol'

/** True when OPFS + Workers are available (i.e. the web shim can persist). */
export function opfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof Worker !== 'undefined'
  )
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export class WebPlatform implements KQSOPlatform {
  private readonly worker: Worker
  private seq = 0
  private readonly pending = new Map<number, Pending>()
  private wakeLock: WakeLockSentinel | null = null
  private persistRequested = false
  private settingsWrites: Promise<void> = Promise.resolve()
  /** CW keyer over Web Bluetooth — Chrome / Edge only; Safari and Firefox have none. */
  readonly keyer: KeyerTransport | undefined = webBluetoothAvailable() ? new WebBluetoothKeyer() : undefined

  constructor() {
    // Ask for persistent storage as early as possible. On an installed PWA the
    // browser grants it without a prompt; before install it simply returns false.
    this.requestPersist()
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resp = e.data
      const p = this.pending.get(resp.id)
      if (!p) return
      this.pending.delete(resp.id)
      if (resp.ok) p.resolve(resp.value)
      else p.reject(new Error(resp.error))
    }
  }

  private call<T>(body: RequestBody): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ ...body, id } as WorkerRequest)
    })
  }

  private newId(name: string): string {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'log'
    const rand = Math.random().toString(36).slice(2, 8)
    return `${slug}-${rand}`
  }

  async listLogs(): Promise<LogSummary[]> {
    const ids = await this.call<string[]>({ op: 'list' })
    const out: LogSummary[] = []
    for (const id of ids) {
      const content = await this.call<string>({ op: 'read', logId: id })
      const { meta, count } = readLogFile(content)
      out.push({ id, name: meta.name, profile: meta.profile, qsoCount: count })
    }
    return out
  }

  async createLog(meta: LogMeta): Promise<string> {
    // Creating a log is also a user gesture — request persistence here too so the
    // grant can happen at the earliest storage write.
    this.requestPersist()
    const id = this.newId(meta.name)
    await this.call<void>({ op: 'createHeader', logId: id, content: writeLogHeader(meta) })
    return id
  }

  async appendQso(logId: string, adifRecord: string): Promise<void> {
    // Request persistent storage on the first QSO save, still within the user
    // gesture that triggered it. Synchronous call before any await.
    this.requestPersist()
    const text = adifRecord.endsWith('\n') ? adifRecord : adifRecord + '\n'
    await this.call<void>({ op: 'append', logId, text })
  }

  private requestPersist(): void {
    if (this.persistRequested) return
    this.persistRequested = true
    void navigator.storage?.persist?.().catch(() => {})
  }

  async isPersisted(): Promise<boolean> {
    return (await navigator.storage?.persisted?.()) ?? false
  }

  readLog(logId: string): Promise<string> {
    return this.call<string>({ op: 'read', logId })
  }

  async rewriteLog(logId: string, content: string): Promise<void> {
    await this.call<void>({ op: 'rewrite', logId, content })
  }

  async deleteLog(logId: string): Promise<void> {
    await this.call<void>({ op: 'delete', logId })
  }

  async writeJournal(logId: string, text: string): Promise<void> {
    await this.call<void>({ op: 'writeJournal', logId, text })
  }

  readJournal(logId: string): Promise<string> {
    return this.call<string>({ op: 'readJournal', logId })
  }

  async clearJournal(logId: string): Promise<void> {
    await this.call<void>({ op: 'clearJournal', logId })
  }

  async exportLog(logId: string, filename: string): Promise<void> {
    const content = await this.readLog(logId)
    download(content, filename)
  }

  async exportText(content: string, filename: string): Promise<void> {
    download(content, filename)
  }

  readCallDb(): Promise<string> {
    return this.call<string>({ op: 'readCallDb' })
  }

  async writeCallDb(text: string): Promise<void> {
    await this.call<void>({ op: 'writeCallDb', content: text })
  }

  async shareLog(logId: string, filename: string): Promise<void> {
    const content = await this.readLog(logId)
    const file = new File([content], filename, { type: 'text/plain' })
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return
      } catch {
        /* user cancelled or share failed → fall back to download */
      }
    }
    download(content, filename)
  }

  private async allSettings(): Promise<Record<string, string>> {
    const text = await this.call<string>({ op: 'readSettings' })
    if (!text) return {}
    try {
      const obj = JSON.parse(text) as unknown
      return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  async getSetting(key: string): Promise<string | null> {
    return (await this.allSettings())[key] ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    // Read-modify-write of one JSON file: chained, so two quick changes (a switch and
    // the keyer's own setting, say) cannot overwrite each other.
    const next = this.settingsWrites.then(async () => {
      const s = await this.allSettings()
      s[key] = value
      await this.call<void>({ op: 'writeSettings', content: JSON.stringify(s) })
    })
    this.settingsWrites = next.catch(() => {})
    return next
  }

  keepAwake(on: boolean): void {
    if (on) {
      navigator.wakeLock
        ?.request('screen')
        .then((s) => {
          this.wakeLock = s
        })
        .catch(() => {
          /* wake lock unavailable/denied — non-fatal */
        })
    } else {
      void this.wakeLock?.release().catch(() => {})
      this.wakeLock = null
    }
  }
}

function download(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
