// iOS shell (ios/kQSO, WKWebView). The page talks to Swift through the message handler
// `kqso` with replies (WKScriptMessageHandlerWithReply): postMessage({op, args}) resolves
// with the answer. This adapts it to the Android bridge interface, so NativePlatform and
// the BLE links (platform/native.ts) serve both shells unchanged. Values the app reads
// synchronously — version, display mode, MTUs — the shell keeps in window.KQSOIos
// (a document-start user script, the MTUs updated as links come up).

import type { NativeBridge } from './native'

interface IosMessageHandler {
  postMessage(msg: { op: string; args: unknown[] }): Promise<unknown>
}

/** Set by the shell before the page runs. */
interface IosInfo {
  appVersion: string
  displayMode: string
  keyerMtu?: number
  rigMtu?: number
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { kqso?: IosMessageHandler } }
    KQSOIos?: IosInfo
  }
}

/** Running inside the iOS shell. */
export function iosShell(): boolean {
  return window.webkit?.messageHandlers?.kqso !== undefined && window.KQSOIos !== undefined
}

/** The iOS shell as a NativeBridge, or undefined outside it. */
export function iosBridge(): NativeBridge | undefined {
  const handler = window.webkit?.messageHandlers?.kqso
  const info = window.KQSOIos
  if (!handler || !info) return undefined
  // Every call goes through the one handler; Swift dispatches on `op` (Bridge.swift).
  const call =
    <T>(op: string) =>
    (...args: unknown[]): Promise<T> =>
      handler.postMessage({ op, args }) as Promise<T>
  // Fire and forget: nothing to wait for, and no unhandled rejection if it fails.
  const send =
    (op: string) =>
    (...args: unknown[]): void =>
      void handler.postMessage({ op, args }).catch(() => {})
  return {
    displayMode: () => info.displayMode,
    appVersion: () => info.appVersion,
    installSource: () => 'ios', // App Store / TestFlight keep it up to date
    isPersisted: call<boolean>('isPersisted'),
    list: call<string>('list'),
    createHeader: call<void>('createHeader'),
    append: call<void>('append'),
    read: call<string>('read'),
    rewrite: call<void>('rewrite'),
    remove: call<void>('remove'),
    writeJournal: call<void>('writeJournal'),
    readJournal: call<string>('readJournal'),
    clearJournal: call<void>('clearJournal'),
    getSetting: call<string | null>('getSetting'),
    setSetting: call<void>('setSetting'),
    exportLog: call<void>('exportLog'),
    exportText: call<void>('exportText'),
    readCallDb: call<string>('readCallDb'),
    writeCallDb: call<void>('writeCallDb'),
    shareLog: call<void>('shareLog'),
    keepAwake: send('keepAwake'),
    setDarkBars: send('setDarkBars'),
    keyerConnect: send('keyerConnect'),
    keyerDisconnect: send('keyerDisconnect'),
    keyerForget: send('keyerForget'),
    keyerWrite: send('keyerWrite'),
    keyerMtu: () => window.KQSOIos?.keyerMtu ?? 20,
    rigConnect: send('rigConnect'),
    rigDisconnect: send('rigDisconnect'),
    rigForget: send('rigForget'),
    rigWrite: send('rigWrite'),
    rigMtu: () => window.KQSOIos?.rigMtu ?? 20,
  }
}
