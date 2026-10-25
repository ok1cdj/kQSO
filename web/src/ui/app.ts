// App shell: owns the platform and swaps full-screen views. No framework — a screen
// is just an object that mounts into the root and cleans up after itself.

import { getPlatform } from '../platform/index'
import type { KQSOPlatform } from '../platform/index'
import { LogListScreen } from './screens/loglist'
import { NewLogScreen } from './screens/newlog'
import { LoggingScreen } from './screens/logging'
import { QsoListScreen } from './screens/qsolist'
import { QsoEditScreen } from './screens/qsoedit'
import { SettingsScreen } from './screens/settings'
import { HelpScreen } from './screens/help'
import { ManualScreen } from './screens/manual'
import { EdiExportScreen } from './screens/ediexport'
import { MapScreen } from './screens/map'
import { StatsScreen } from './screens/stats'
import { WhatsNewScreen } from './screens/whatsnew'
import { ChatScreen } from './screens/chat'
import type { ChatContext } from './screens/chat'
import { takeUnseenNotes } from './whatsnew'
import { WHATS_NEW } from '../core/index'
import type { WhatsNewEntry } from '../core/index'
import { trackScreen } from './stats'
import { KeyerController } from './keyer'
import { KST_SETTINGS, KstController } from './kst'
import { RigController } from './rig'

export interface Screen {
  mount(root: HTMLElement): void | Promise<void>
  unmount(): void
}

export class App {
  private readonly platform: KQSOPlatform = getPlatform()
  // Radio and CW keyer: one link each for the whole app, so they survive screen changes.
  // A radio via the keyer rides on the keyer's link (its CI-V tunnel).
  private readonly rig = new RigController(this.platform)
  private readonly keyer = new KeyerController(this.platform, this.rig)
  // ON4KST chat: one link too, it stays up while moving between screens.
  private readonly kst = new KstController(this.platform)
  private root!: HTMLElement
  private current: Screen | null = null
  // System Back (Android button / gesture, the browser's Back, the iOS edge swipe) does
  // what the screen's own "‹" does. Away from the log list one extra history entry stands
  // for "in the app": Back pops it and calls the screen's back, and the next screen puts
  // it back unless that is the log list, where Back leaves (closes the Android app).
  private back: (() => void) | undefined
  private guarded = false // our extra entry is on top of the history
  private ignorePop = false // the popstate of our own history.back()

  mount(root: HTMLElement): void {
    this.root = root
    window.addEventListener('popstate', () => this.onPopState())
    // The Android app asks here first on Back (MainActivity): true = the screen went back.
    // Its WebView skips history entries pushed before any tap (What's new at start), so
    // history alone would close the app there.
    const w = window as unknown as { kqsoBack?: () => boolean }
    w.kqsoBack = () => {
      if (!this.back) return false
      this.back()
      return true
    }
    this.rig.attachKeyer(this.keyer.civLink)
    // The keyer's settings first: a radio via the keyer may bring its link up.
    void this.keyer.init().then(() => this.rig.init())
    this.kst.init()
    // Until the chat has its screens: try it from the console (npm run dev + the local relay).
    if (import.meta.env.DEV) {
      const w = window as unknown as { kqsoKst?: KstController; kqsoKstLogin?: (call: string, pass: string) => Promise<void> }
      w.kqsoKst = this.kst
      w.kqsoKstLogin = async (call, pass) => {
        await this.platform.setSetting(KST_SETTINGS.call, call)
        await this.platform.setSetting(KST_SETTINGS.pass, pass)
        await this.kst.connect()
      }
    }
    void this.start()
  }

  /** After an update: the new version's notes once, then the log list. */
  private async start(): Promise<void> {
    const notes = await takeUnseenNotes(this.platform, __APP_VERSION__).catch(() => [])
    if (notes.length > 0) this.showWhatsNew(notes, () => this.showLogList())
    else this.showLogList()
  }

  showWhatsNew(entries: readonly WhatsNewEntry[], back: () => void): void {
    this.show(new WhatsNewScreen(entries, { back }), 'whatsnew', back)
  }

  /** `name` is the anonymous screen name for the web statistics (stats.ts); `back` what
   *  system Back does there — none on the log list. */
  private show(screen: Screen, name: string, back?: () => void): void {
    trackScreen(name)
    this.current?.unmount()
    this.current = screen
    this.back = back
    this.syncHistory()
    void screen.mount(this.root)
  }

  private syncHistory(): void {
    if (this.back && !this.guarded) {
      history.pushState({ kqso: true }, '')
      this.guarded = true
    } else if (!this.back && this.guarded) {
      // Back to the log list by the app's own button: drop the extra entry, so the next
      // Back leaves instead of doing nothing.
      this.guarded = false
      this.ignorePop = true
      history.back()
    }
  }

  private onPopState(): void {
    if (this.ignorePop) {
      this.ignorePop = false
      return
    }
    this.guarded = false
    this.back?.()
  }

  showLogList(): void {
    // No log open: the chat goes offline (in ON4KST too); the chat screen connects it again.
    if (this.kst.wanted || this.kst.link !== 'off') this.kst.disconnect()
    this.show(
      new LogListScreen(this.platform, {
        openLog: (id) => this.showLogging(id),
        newLog: () => this.showNewLog(),
        openSettings: () => this.showSettings(),
        openHelp: () => this.showHelp(() => this.showLogList()),
        exportEdi: (id) => this.showEdiExport(id),
      }),
      'logs',
    )
  }

  showSettings(): void {
    this.show(
      new SettingsScreen(this.platform, this.keyer, this.rig, this.kst, {
        back: () => this.showLogList(),
        openHelp: () => this.showHelp(() => this.showSettings()),
        openWhatsNew: () => this.showWhatsNew(WHATS_NEW, () => this.showSettings()),
        openManual: () => this.showManual(() => this.showSettings()),
      }),
      'settings',
      () => this.showLogList(),
    )
  }

  showNewLog(): void {
    this.show(
      new NewLogScreen(this.platform, {
        created: (id) => this.showLogging(id),
        cancel: () => this.showLogList(),
      }),
      'newlog',
      () => this.showLogList(),
    )
  }

  /** `line`: typed in on open (the chat's "Log": call + locator). */
  showLogging(logId: string, line = ''): void {
    this.show(
      new LoggingScreen(this.platform, this.keyer, this.rig, this.kst, logId, {
        toLogList: () => this.showLogList(),
        toQsoList: () => this.showQsoList(logId),
        editQso: (index) => this.showQsoEdit(logId, index, () => this.showLogging(logId)),
        toHelp: () => this.showHelp(() => this.showLogging(logId)),
        toChat: (ctx) => this.showChat(logId, ctx),
      }, line),
      'logging',
      () => this.showLogList(), // an entered partial QSO is in the journal, as with "‹ Logs"
    )
  }

  showChat(logId: string, ctx: ChatContext): void {
    const back = (): void => this.showLogging(logId)
    this.show(new ChatScreen(this.platform, this.kst, logId, ctx, { back, toLog: (line) => this.showLogging(logId, line) }), 'chat', back)
  }

  showEdiExport(logId: string): void {
    const back = (): void => this.showLogList()
    this.show(new EdiExportScreen(this.platform, logId, { back }), 'edi', back)
  }

  showHelp(back: () => void): void {
    this.show(new HelpScreen({ back, openManual: () => this.showManual(() => this.showHelp(back)) }), 'help', back)
  }

  showManual(back: () => void): void {
    this.show(new ManualScreen({ back }), 'manual', back)
  }

  showQsoList(logId: string): void {
    const back = (): void => this.showLogging(logId)
    const toList = (): void => this.showQsoList(logId)
    this.show(
      new QsoListScreen(this.platform, logId, {
        back,
        editQso: (index) => this.showQsoEdit(logId, index, toList),
        toMap: () => this.show(new MapScreen(this.platform, logId, { back: toList }), 'map', toList),
        toStats: () => this.show(new StatsScreen(this.platform, logId, { back: toList }), 'stats', toList),
      }),
      'qsolist',
      back,
    )
  }

  /** `back` returns to wherever the edit was opened from (QSO list or logging). */
  showQsoEdit(logId: string, index: number, back: () => void): void {
    this.show(
      new QsoEditScreen(this.platform, logId, index, {
        done: back,
      }),
      'qsoedit',
      back, // like the edit's own Back: nothing saved
    )
  }
}
