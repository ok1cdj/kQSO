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
import { trackScreen } from './stats'
import { KeyerController } from './keyer'

export interface Screen {
  mount(root: HTMLElement): void | Promise<void>
  unmount(): void
}

export class App {
  private readonly platform: KQSOPlatform = getPlatform()
  // CW keyer: one link for the whole app, so it survives screen changes.
  private readonly keyer = new KeyerController(this.platform)
  private root!: HTMLElement
  private current: Screen | null = null

  mount(root: HTMLElement): void {
    this.root = root
    void this.keyer.init()
    this.showLogList()
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
      new SettingsScreen(this.platform, this.keyer, {
        back: () => this.showLogList(),
        openHelp: () => this.showHelp(() => this.showSettings()),
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
      new LoggingScreen(this.platform, this.keyer, logId, {
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
