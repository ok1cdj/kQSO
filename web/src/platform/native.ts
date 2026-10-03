// Android WebView bridge. The shell injects `window.KQSONative`
// via addJavascriptInterface — a SYNCHRONOUS object (methods return strings, not
// Promises). NativePlatform wraps it into the async KQSOPlatform the app expects.
// In phase 1 (browser) KQSONative is absent and this stays dormant.

import type { LogMeta } from '../core/model'
import { readLogFile, writeLogHeader } from '../core/index'
import type { KQSOPlatform, LogSummary } from './types'

/** The raw @JavascriptInterface surface. Pure file I/O keyed by log id (mirrors the OPFS worker). */
interface NativeBridge {
  displayMode(): string
  appVersion(): string
  isPersisted(): boolean
  list(): string // JSON array of log ids
  createHeader(id: string, content: string): void
  append(id: string, text: string): void
  read(id: string): string
  rewrite(id: string, content: string): void
  remove(id: string): void
  writeJournal(id: string, text: string): void
  readJournal(id: string): string
  clearJournal(id: string): void
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  exportLog(id: string, filename: string): void
  exportText(content: string, filename: string): void
  readCallDb(): string
  writeCallDb(text: string): void
  shareLog(id: string, filename: string): void
  keepAwake(on: boolean): void
}

declare global {
  interface Window {
    KQSONative?: NativeBridge
  }
}

class NativePlatform implements KQSOPlatform {
  readonly displayMode: 'eink' | 'standard'
  readonly nativeVersion: string

  constructor(private readonly raw: NativeBridge) {
    const m = raw.displayMode()
    this.displayMode = m === 'standard' ? 'standard' : 'eink'
    this.nativeVersion = raw.appVersion()
  }

  private newId(name: string): string {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'log'
    return `${slug}-${Math.random().toString(36).slice(2, 8)}`
  }

  async listLogs(): Promise<LogSummary[]> {
    const ids = JSON.parse(this.raw.list()) as string[]
    return ids.map((id) => {
      const { meta, count } = readLogFile(this.raw.read(id))
      return { id, name: meta.name, profile: meta.profile, qsoCount: count }
    })
  }

  async createLog(meta: LogMeta): Promise<string> {
    const id = this.newId(meta.name)
    this.raw.createHeader(id, writeLogHeader(meta))
    return id
  }

  async appendQso(logId: string, adifRecord: string): Promise<void> {
    this.raw.append(logId, adifRecord.endsWith('\n') ? adifRecord : adifRecord + '\n')
  }

  async readLog(logId: string): Promise<string> {
    return this.raw.read(logId)
  }

  async rewriteLog(logId: string, content: string): Promise<void> {
    this.raw.rewrite(logId, content)
  }

  async deleteLog(logId: string): Promise<void> {
    this.raw.remove(logId)
  }

  async writeJournal(logId: string, text: string): Promise<void> {
    this.raw.writeJournal(logId, text)
  }

  async readJournal(logId: string): Promise<string> {
    return this.raw.readJournal(logId)
  }

  async clearJournal(logId: string): Promise<void> {
    this.raw.clearJournal(logId)
  }

  async getSetting(key: string): Promise<string | null> {
    // A Kotlin null comes through the bridge as undefined, not null — and the callers
    // test `=== null` for "never set" (switchOn: a default-off switch would read Yes).
    return this.raw.getSetting(key) ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.raw.setSetting(key, value)
  }

  async exportLog(logId: string, filename: string): Promise<void> {
    this.raw.exportLog(logId, filename)
  }

  async exportText(content: string, filename: string): Promise<void> {
    this.raw.exportText(content, filename)
  }

  async readCallDb(): Promise<string> {
    return this.raw.readCallDb()
  }

  async writeCallDb(text: string): Promise<void> {
    this.raw.writeCallDb(text)
  }

  async shareLog(logId: string, filename: string): Promise<void> {
    this.raw.shareLog(logId, filename)
  }

  async isPersisted(): Promise<boolean> {
    return this.raw.isPersisted()
  }

  keepAwake(on: boolean): void {
    this.raw.keepAwake(on)
  }
}

export function nativePlatform(): KQSOPlatform | null {
  return typeof window !== 'undefined' && window.KQSONative ? new NativePlatform(window.KQSONative) : null
}
