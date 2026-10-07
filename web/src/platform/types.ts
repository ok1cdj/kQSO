// The single boundary between the app and its host. Two implementations,
// one API: the OPFS web shim and the Android KQSONative bridge.
// NOTHING outside src/platform/ may touch storage — that is what keeps the APK shell cheap.
//
// DOM-free on purpose: this type is imported by both DOM and WebWorker programs and
// by the pure core tests. Keep it to strings/Promises/plain data.

import type { LogMeta, ProfileId } from '../core/model'

/** One row in the log list: enough to render without opening the file. */
export interface LogSummary {
  readonly id: string
  readonly name: string
  readonly profile: ProfileId
  readonly qsoCount: number
}

/** Link state of the CW keyer. */
export type KeyerLinkState = 'off' | 'connecting' | 'on'

/**
 * BLE link to the M5-ESP32-keyer (Nordic UART). Text lines both ways; the line
 * protocol itself is core/keyer.ts. Present only where the host can do BLE: Web
 * Bluetooth in Chrome now, the APK's native bridge later (phase 3).
 */
export interface KeyerTransport {
  /** `pick` = show the device chooser (needs a user tap); otherwise reconnect the
   *  remembered keyer quietly, and do nothing when there is none. Resolves false
   *  when there was no keyer to try (no remembered one, chooser unavailable). */
  connect(pick: boolean): Promise<boolean>
  disconnect(): Promise<void>
  /** Drop the remembered keyer (the next connect asks again). */
  forget(): Promise<void>
  /** One write of at most `mtu` bytes; writes go out in order. */
  write(chunk: string): void
  readonly mtu: number
  onData(cb: (text: string) => void): void
  onState(cb: (s: KeyerLinkState, name?: string) => void): void
  onBattery(cb: (pct: number) => void): void
}

/**
 * BLE link to an Icom IC-705 (CI-V over Icom's BLE serial). Raw bytes both ways; the
 * handshake and CI-V itself are core/civ.ts. APK only.
 */
export interface RigTransport {
  /** As KeyerTransport.connect: `pick` = chooser, otherwise the remembered radio quietly. */
  connect(pick: boolean): Promise<boolean>
  disconnect(): Promise<void>
  forget(): Promise<void>
  /** One write of at most `mtu` bytes; writes go out in order. */
  write(bytes: Uint8Array): void
  readonly mtu: number
  onData(cb: (bytes: Uint8Array) => void): void
  onState(cb: (s: KeyerLinkState, name?: string) => void): void
}

export interface KQSOPlatform {
  /** Host-forced display mode; the web shim leaves it undefined. */
  readonly displayMode?: 'eink' | 'standard'

  /** Native shell (APK) version, shown in About; undefined in the browser. */
  readonly nativeVersion?: string

  /** APK: the installing app (com.android.vending = Google Play); undefined
   *  when sideloaded (GitHub APK), unknown, or in the browser. */
  readonly installSource?: string | undefined

  listLogs(): Promise<LogSummary[]>
  createLog(meta: LogMeta): Promise<string> // returns the new log id
  appendQso(logId: string, adifRecord: string): Promise<void> // append one record, never rewrite
  readLog(logId: string): Promise<string>
  rewriteLog(logId: string, content: string): Promise<void> // edit/delete only — rare, may be slow
  deleteLog(logId: string): Promise<void>

  // Crash journal: the in-progress QSO is mirrored so it survives a kill.
  writeJournal(logId: string, text: string): Promise<void> // overwrite with the current partial
  readJournal(logId: string): Promise<string> // '' when empty
  clearJournal(logId: string): Promise<void> // after a commit

  exportLog(logId: string, filename: string): Promise<void>
  /** Save arbitrary text as a file the user picks/downloads (callsign DB export). */
  exportText(content: string, filename: string): Promise<void>
  shareLog(logId: string, filename: string): Promise<void>
  keepAwake(on: boolean): void
  /** APK: dark system bars + window background behind them (dark theme). */
  setDarkBars?(dark: boolean): void

  // Small persistent key/value store for app-wide preferences (operator call/grid
  // remembered for the next New Log, display mode, …). Not per-log; logs keep their
  // own meta in the .adi. All storage still goes through the platform.
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>

  // Callsign database, live layer (calldb.ts): ONE app-wide TSV file, separate from
  // the logs — deleting logs never touches it.
  readCallDb(): Promise<string> // '' when none yet
  writeCallDb(text: string): Promise<void>

  /** Whether storage is persistent, i.e. exempt from WebKit's 7-day eviction. */
  isPersisted(): Promise<boolean>

  /** CW keyer over BLE; undefined where the host has no BLE (Safari, Firefox, memory). */
  readonly keyer?: KeyerTransport | undefined

  /** IC-705 over BLE; APK only. */
  readonly rig?: RigTransport | undefined
}
