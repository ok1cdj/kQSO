// In-memory KQSOPlatform: reference implementation and test double. Pure (a Map of
// strings), so it runs under the core tsconfig and in Vitest's node environment.
// Also used as a fallback when OPFS is unavailable.

import type { LogMeta } from '../core/model'
import { readLogFile, writeLogHeader } from '../core/index'
import type { KQSOPlatform, LogSummary } from './types'

interface Entry {
  content: string
  journal: string
}

export class MemoryPlatform implements KQSOPlatform {
  // displayMode omitted → undefined (web/memory does not force a mode)
  private readonly logs = new Map<string, Entry>()
  private readonly settings = new Map<string, string>()
  private callDb = ''
  private counter = 0

  async listLogs(): Promise<LogSummary[]> {
    const out: LogSummary[] = []
    for (const [id, entry] of this.logs) {
      const { meta, count } = readLogFile(entry.content)
      out.push({ id, name: meta.name, profile: meta.profile, qsoCount: count })
    }
    return out
  }

  async createLog(meta: LogMeta): Promise<string> {
    const id = `log-${++this.counter}`
    this.logs.set(id, { content: writeLogHeader(meta), journal: '' })
    return id
  }

  async appendQso(logId: string, adifRecord: string): Promise<void> {
    const entry = this.require(logId)
    entry.content += adifRecord.endsWith('\n') ? adifRecord : adifRecord + '\n'
  }

  async readLog(logId: string): Promise<string> {
    return this.require(logId).content
  }

  async rewriteLog(logId: string, content: string): Promise<void> {
    this.require(logId).content = content
  }

  async deleteLog(logId: string): Promise<void> {
    this.logs.delete(logId)
  }

  async writeJournal(logId: string, text: string): Promise<void> {
    this.require(logId).journal = text
  }

  async readJournal(logId: string): Promise<string> {
    return this.require(logId).journal
  }

  async clearJournal(logId: string): Promise<void> {
    this.require(logId).journal = ''
  }

  async exportLog(): Promise<void> {
    /* no-op in memory */
  }

  async shareLog(): Promise<void> {
    /* no-op in memory */
  }

  async exportText(): Promise<void> {
    /* no-op in memory */
  }

  async readCallDb(): Promise<string> {
    return this.callDb
  }

  async writeCallDb(text: string): Promise<void> {
    this.callDb = text
  }

  keepAwake(): void {
    /* no-op in memory */
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value)
  }

  async isPersisted(): Promise<boolean> {
    return false // in-memory storage is never persistent
  }

  private require(logId: string): Entry {
    const entry = this.logs.get(logId)
    if (!entry) throw new Error(`unknown log: ${logId}`)
    return entry
  }
}
