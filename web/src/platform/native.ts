// Android WebView bridge. The shell injects `window.KQSONative`
// via addJavascriptInterface — a SYNCHRONOUS object (methods return strings, not
// Promises). NativePlatform wraps it into the async KQSOPlatform the app expects.
// In phase 1 (browser) KQSONative is absent and this stays dormant.

import type { LogMeta } from '../core/model'
import { readLogFile, writeLogHeader } from '../core/index'
import type { KQSOPlatform, KeyerLinkState, KeyerTransport, LogSummary } from './types'

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
  // CW keyer (app/…/KeyerBle.kt); answers come back through window.__kqsoKeyer.
  keyerConnect?(pick: boolean): void
  keyerDisconnect?(): void
  keyerForget?(): void
  keyerWrite?(chunk: string): void
  keyerMtu?(): number
}

/** What the native side calls back (KeyerBle.js()). */
interface NativeKeyerCallbacks {
  state(s: KeyerLinkState, name: string): void
  data(text: string): void
  battery(pct: number): void
  /** Answer to keyerConnect: tried = false when there was no keyer to try. */
  done(tried: boolean, error: string | null): void
}

declare global {
  interface Window {
    KQSONative?: NativeBridge
    __kqsoKeyer?: NativeKeyerCallbacks
  }
}

/** The keyer over the APK's native BLE (KeyerBle.kt): the scan + chooser dialog, GATT
 *  and the remembered keyer live in Kotlin; this only adapts calls and callbacks. */
class NativeKeyer implements KeyerTransport {
  private dataCb: (text: string) => void = () => {}
  private stateCb: (s: KeyerLinkState, name?: string) => void = () => {}
  private batteryCb: (pct: number) => void = () => {}
  private pending: { resolve: (tried: boolean) => void; reject: (e: Error) => void } | undefined

  constructor(private readonly raw: NativeBridge) {
    window.__kqsoKeyer = {
      state: (s, name) => this.stateCb(s, name || undefined),
      data: (text) => this.dataCb(text),
      battery: (pct) => this.batteryCb(pct),
      done: (tried, error) => {
        const p = this.pending
        this.pending = undefined
        if (!p) return
        if (error === null) p.resolve(tried)
        // A closed chooser is the same "nothing picked" as in Web Bluetooth.
        else p.reject(error === 'cancelled' ? new DOMException(error, 'NotFoundError') : new Error(error))
      },
    }
  }

  get mtu(): number {
    return this.raw.keyerMtu?.() ?? 20
  }

  connect(pick: boolean): Promise<boolean> {
    this.pending?.reject(new DOMException('superseded', 'NotFoundError'))
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject }
      this.raw.keyerConnect!(pick)
    })
  }

  async disconnect(): Promise<void> {
    this.raw.keyerDisconnect?.()
  }

  async forget(): Promise<void> {
    this.raw.keyerForget?.()
  }

  write(chunk: string): void {
    this.raw.keyerWrite?.(chunk)
  }

  onData(cb: (text: string) => void): void {
    this.dataCb = cb
  }

  onState(cb: (s: KeyerLinkState, name?: string) => void): void {
    this.stateCb = cb
  }

  onBattery(cb: (pct: number) => void): void {
    this.batteryCb = cb
  }
}

class NativePlatform implements KQSOPlatform {
  readonly displayMode: 'eink' | 'standard'
  readonly nativeVersion: string
  readonly keyer: KeyerTransport | undefined

  constructor(private readonly raw: NativeBridge) {
    const m = raw.displayMode()
    this.displayMode = m === 'standard' ? 'standard' : 'eink'
    this.nativeVersion = raw.appVersion()
    this.keyer = raw.keyerConnect ? new NativeKeyer(raw) : undefined
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
