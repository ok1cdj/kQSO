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
import { EdiExportScreen } from './screens/ediexport'
import { MapScreen } from './screens/map'
import { StatsScreen } from './screens/stats'
import { WhatsNewScreen } from './screens/whatsnew'
import { takeUnseenNotes } from './whatsnew'
import { WHATS_NEW } from '../core/index'
import type { WhatsNewEntry } from '../core/index'
import { trackScreen } from './stats'
import { KeyerController } from './keyer'
import { RigController } from './rig'

export interface Screen {
  mount(root: HTMLElement): void | Promise<void>
  unmount(): void
}

export class App {
  private readonly platform: KQSOPlatform = getPlatform()
  // IC-705 and CW keyer: one link each for the whole app, so they survive screen changes.
  private readonly rig = new RigController(this.platform)
  private readonly keyer = new KeyerController(this.platform, this.rig)
  private root!: HTMLElement
  private current: Screen | null = null

  mount(root: HTMLElement): void {
    this.root = root
    void this.rig.init()
    void this.keyer.init()
    void this.start()
  }

  /** After an update: the new version's notes once, then the log list. */
  private async start(): Promise<void> {
    const notes = await takeUnseenNotes(this.platform, __APP_VERSION__).catch(() => [])
    if (notes.length > 0) this.showWhatsNew(notes, () => this.showLogList())
    else this.showLogList()
  }

  showWhatsNew(entries: readonly WhatsNewEntry[], back: () => void): void {
    this.show(new WhatsNewScreen(entries, { back }), 'whatsnew')
  }

  /** `name` is the anonymous screen name for the web statistics (stats.ts). */
  private show(screen: Screen, name: string): void {
    trackScreen(name)
    this.current?.unmount()
    this.current = screen
    void screen.mount(this.root)
  }

  showLogList(): void {
    this.show(
      new LogListScreen(this.platform, {
        openLog: (id) => this.showLogging(id),
        newLog: () => this.showNewLog(),
        openSettings: () => this.showSettings(),
        exportEdi: (id) => this.showEdiExport(id),
      }),
      'logs',
    )
  }

  showSettings(): void {
    this.show(
      new SettingsScreen(this.platform, this.keyer, this.rig, {
        back: () => this.showLogList(),
        openHelp: () => this.showHelp(() => this.showSettings()),
        openWhatsNew: () => this.showWhatsNew(WHATS_NEW, () => this.showSettings()),
      }),
      'settings',
    )
  }

  showNewLog(): void {
    this.show(
      new NewLogScreen(this.platform, {
        created: (id) => this.showLogging(id),
        cancel: () => this.showLogList(),
      }),
      'newlog',
    )
  }

  showLogging(logId: string): void {
    this.show(
      new LoggingScreen(this.platform, this.keyer, this.rig, logId, {
        toLogList: () => this.showLogList(),
        toQsoList: () => this.showQsoList(logId),
        editQso: (index) => this.showQsoEdit(logId, index, () => this.showLogging(logId)),
        toHelp: () => this.showHelp(() => this.showLogging(logId)),
      }),
      'logging',
    )
  }

  showEdiExport(logId: string): void {
    this.show(new EdiExportScreen(this.platform, logId, { back: () => this.showLogList() }), 'edi')
  }

  showHelp(back: () => void): void {
    this.show(new HelpScreen({ back }), 'help')
  }

  showQsoList(logId: string): void {
    this.show(
      new QsoListScreen(this.platform, logId, {
        back: () => this.showLogging(logId),
        editQso: (index) => this.showQsoEdit(logId, index, () => this.showQsoList(logId)),
        toMap: () => this.show(new MapScreen(this.platform, logId, { back: () => this.showQsoList(logId) }), 'map'),
        toStats: () => this.show(new StatsScreen(this.platform, logId, { back: () => this.showQsoList(logId) }), 'stats'),
      }),
      'qsolist',
    )
  }

  /** `back` returns to wherever the edit was opened from (QSO list or logging). */
  showQsoEdit(logId: string, index: number, back: () => void): void {
    this.show(
      new QsoEditScreen(this.platform, logId, index, {
        done: back,
      }),
      'qsoedit',
    )
  }
}
