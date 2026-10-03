// Settings. Display mode is the first item. Also: a link to the
// "How to log" help, the callsign database (bundled sets, own layer, export/import),
// the active storage backend, and About. Language follows
// navigator.language with no in-app switch.

import { LiveDb, WAVELOG_SETTINGS, apiBase, dbDate, userHeader, MACRO_SLOTS, WPM_MAX, WPM_MIN, withMacro, resetMacros } from '../../core/index'
import type { ProfileId, RunMode, WavelogStation } from '../../core/index'
import { platformKind } from '../../platform/index'
import type { KQSOPlatform } from '../../platform/index'
import { currentDisplayMode, setDisplayMode } from '../../theme/mode'
import type { DisplayMode } from '../../theme/mode'
import type { Screen } from '../app'
import { el, button, fieldRow, switchOn, tilePicker } from '../dom'
import { connect } from '../wavelog'
import { wavelogErrorText } from '../wavelog-text'
import { t } from '../i18n'
import { BUNDLED_DB_SETTING, BUNDLED_IDS, bundledInfo } from '../bundled-db'
import { MAP_LABELS_SETTING } from './map'
import { RADAR_SETTING } from '../radar'
import { STATS_SETTING, setStatsEnabled } from '../stats'
import { KEYER_SETTINGS } from '../keyer'
import type { KeyerController } from '../keyer'
import { UPDATE_SETTINGS } from '../update'

export interface SettingsNav {
  back(): void
  openHelp(): void
  openWhatsNew(): void
}

const STORAGE_KEY: Record<ReturnType<typeof platformKind>, 'settings.storageNative' | 'settings.storageOpfs' | 'settings.storageMemory'> = {
  native: 'settings.storageNative',
  opfs: 'settings.storageOpfs',
  memory: 'settings.storageMemory',
}

const SET_LABEL = {
  vkv: 'settings.dbSet_vkv',
  sat: 'settings.dbSet_sat',
  awards: 'settings.dbSet_awards',
} as const

const PROFILE_TILES: ReadonlyArray<readonly [ProfileId, 'newlog.profileAktivace' | 'newlog.profileObecny' | 'newlog.profileVkv' | 'newlog.profileSat']> = [
  ['aktivace', 'newlog.profileAktivace'],
  ['obecny', 'newlog.profileObecny'],
  ['vkv', 'newlog.profileVkv'],
  ['sat', 'newlog.profileSat'],
]

export class SettingsScreen implements Screen {
  private readonly root = el('div', 'screen screen--list')
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly keyer: KeyerController,
    private readonly nav: SettingsNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {
    this.unsubscribe?.()
  }

  private async render(): Promise<void> {
    const bar = el('div', 'bar')
    bar.append(button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'), el('b', 'title', t('settings.title')))

    const persisted = await this.platform.isPersisted()
    this.root.replaceChildren(
      bar,
      this.displayModeSetting(),
      this.helpSetting(),
      await this.callDbSetting(),
      await this.wavelogSetting(),
      await this.mapLabelsSetting(),
      await this.radarSetting(),
      ...(this.keyer.available ? [await this.keyerSetting()] : []),
      this.storageSetting(persisted),
      ...(this.platform.nativeVersion ? [await this.updateSetting()] : [await this.statsSetting()]),
      this.about(),
    )
  }

  private displayModeSetting(): HTMLElement {
    const wrap = el('div', 'setting')
    wrap.append(el('span', 'field-label', t('settings.display')))
    const seg = el('div', 'segmented')

    const mkBtn = (mode: DisplayMode, label: string): HTMLButtonElement => {
      const b = button(label, () => void this.pick(mode, seg), 'btn')
      b.dataset.mode = mode
      b.setAttribute('aria-pressed', String(currentDisplayMode() === mode))
      return b
    }
    seg.append(mkBtn('standard', t('settings.standard')), mkBtn('eink', t('settings.eink')))
    wrap.append(seg)
    return wrap
  }

  private async pick(mode: DisplayMode, seg: HTMLElement): Promise<void> {
    await setDisplayMode(this.platform, mode) // instant, no reload
    for (const b of Array.from(seg.querySelectorAll<HTMLButtonElement>('button'))) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
    }
  }

  /** Callsign DB: bundled-set switch + versions, own layer size, export/import/delete. */
  private async callDbSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    const live = LiveDb.fromText(await this.platform.readCallDb())
    const status = el('div', 'about')
    const ownLine = el('div', undefined, t('settings.dbOwn', { n: live.size }))

    const seg = el('div', 'segmented')
    const on = (await this.platform.getSetting(BUNDLED_DB_SETTING)) !== '0'
    const mk = (value: '1' | '0', label: string): HTMLButtonElement => {
      const b = button(label, () => {
        void this.platform.setSetting(BUNDLED_DB_SETTING, value)
        for (const x of Array.from(seg.querySelectorAll<HTMLButtonElement>('button'))) {
          x.setAttribute('aria-pressed', String(x === b))
        }
      }, 'btn')
      b.setAttribute('aria-pressed', String((value === '1') === on))
      return b
    }
    seg.append(mk('1', t('common.yes')), mk('0', t('common.no')))

    const sets = el('div', 'about')
    for (const id of BUNDLED_IDS) {
      const i = bundledInfo(id)
      sets.append(el('div', undefined, t('settings.dbSet', { set: t(SET_LABEL[id]), v: i.version, d: i.updated, n: i.count })))
    }

    const save = async (): Promise<void> => {
      await this.platform.writeCallDb(live.toText(userHeader(new Date())))
      ownLine.textContent = t('settings.dbOwn', { n: live.size })
    }
    const actions = el('div', 'segmented')
    actions.append(
      button(t('settings.dbExport'), () => {
        void this.platform.exportText(live.toText(userHeader(new Date())), `kqso-calldb-${dbDate(new Date())}.tsv`)
      }, 'btn'),
    )
    const file = el('input')
    file.type = 'file'
    file.accept = '.tsv,.txt,text/tab-separated-values,text/plain'
    file.hidden = true
    file.addEventListener('change', () => {
      const f = file.files?.[0]
      if (!f) return
      void f.text().then(async (text) => {
        const n = live.importText(text)
        await save()
        status.textContent = t('settings.dbImported', { n })
        file.value = ''
      })
    })
    actions.append(button(t('settings.dbImport'), () => file.click(), 'btn'), file)
    actions.append(
      button(t('common.delete'), () => {
        if (!confirm(t('settings.dbClearConfirm', { n: live.size }))) return
        live.clear()
        void save().then(() => (status.textContent = ''))
      }, 'btn'),
    )

    wrap.append(el('span', 'field-label', t('settings.db')), el('div', undefined, t('settings.dbBundled')), seg, sets, ownLine, actions, status)
    return wrap
  }

  /**
   * Wavelog push: URL + v2 token → "Connect" checks the token and lists
   * the station profiles; picking one saves it. The token is never shown back.
   */
  private async wavelogSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    const K = WAVELOG_SETTINGS
    const savedUrl = (await this.platform.getSetting(K.url)) ?? ''
    const savedToken = (await this.platform.getSetting(K.token)) ?? ''
    const savedStation = parseStation(await this.platform.getSetting(K.station))

    const url = fieldRow(t('settings.wlUrl'), savedUrl, { placeholder: 'https://log.example.org' })
    url.input.autocapitalize = 'off'
    url.input.inputMode = 'url'
    const token = fieldRow(t('settings.wlToken'), '', {
      placeholder: savedToken ? `wl2_…${savedToken.slice(-4)} ${t('settings.wlTokenSaved')}` : 'wl2_…',
    })
    token.input.type = 'password'
    token.input.autocapitalize = 'off'
    const hint = el('div', 'about', t('settings.wlHint'))
    const status = el('div', 'about', savedStation ? t('settings.wlStation', { name: stationLabel(savedStation) }) : '')
    const pick = el('div', 'segmented')
    pick.hidden = true

    const choose = async (s: WavelogStation): Promise<void> => {
      await this.platform.setSetting(K.station, JSON.stringify(s))
      for (const b of Array.from(pick.querySelectorAll<HTMLButtonElement>('button'))) {
        b.setAttribute('aria-pressed', String(b.dataset.id === String(s.id)))
      }
      status.textContent = t('settings.wlStation', { name: stationLabel(s) })
    }

    const doConnect = async (): Promise<void> => {
      const tok = token.input.value.trim() || savedToken
      let base: string
      try {
        base = apiBase(url.input.value)
      } catch (e) {
        status.textContent = wavelogErrorText(e)
        return
      }
      status.textContent = t('settings.wlConnecting')
      try {
        const { owner, stations } = await connect(base, tok)
        await this.platform.setSetting(K.url, url.input.value.trim())
        await this.platform.setSetting(K.token, tok)
        token.input.value = ''
        token.input.placeholder = `wl2_…${tok.slice(-4)} ${t('settings.wlTokenSaved')}`
        pick.replaceChildren(
          ...stations.map((s) => {
            const b = button(stationLabel(s), () => void choose(s), 'btn')
            b.dataset.id = String(s.id)
            b.setAttribute('aria-pressed', String(savedStation?.id === s.id))
            return b
          }),
        )
        pick.hidden = stations.length === 0
        status.textContent =
          stations.length === 0 ? t('settings.wlNoStations') : t('settings.wlConnected', { owner, n: stations.length })
      } catch (e) {
        status.textContent = wavelogErrorText(e)
      }
    }

    const actions = el('div', 'segmented')
    actions.append(button(t('settings.wlConnect'), () => void doConnect(), 'btn'))
    if (savedToken) {
      actions.append(
        button(t('settings.wlForget'), () => {
          void (async () => {
            await this.platform.setSetting(K.token, '')
            await this.platform.setSetting(K.station, '')
            token.input.placeholder = 'wl2_…'
            pick.hidden = true
            status.textContent = t('settings.wlForgotten')
          })()
        }, 'btn'),
      )
    }
    pick.classList.add('segmented--wrap')
    wrap.append(el('span', 'field-label', t('settings.wl')), url.row, token.row, hint, actions, pick, status)
    return wrap
  }

  private helpSetting(): HTMLElement {
    const wrap = el('div', 'setting')
    wrap.append(button(`${t('settings.help')} ›`, () => this.nav.openHelp(), 'btn'))
    return wrap
  }

  /** Web only: anonymous usage statistics (stats.ts) on/off, default on. */
  private async statsSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    const seg = await this.yesNo(STATS_SETTING, (on) => setStatsEnabled(on))
    wrap.append(el('span', 'field-label', t('settings.stats')), seg, el('div', 'about', t('settings.statsHint')))
    return wrap
  }

  /** APK only: the daily new-version check on GitHub (update.ts), default on. */
  private async updateSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    const seg = await this.yesNo(UPDATE_SETTINGS.enabled)
    wrap.append(el('span', 'field-label', t('settings.updateCheck')), seg, el('div', 'about', t('settings.updateCheckHint')))
    return wrap
  }

  /** QSO map: the calls next to the dots on/off, default on. */
  private async mapLabelsSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    wrap.append(el('span', 'field-label', t('settings.mapLabels')), await this.yesNo(MAP_LABELS_SETTING))
    return wrap
  }

  /** VKV map: the rain radar on/off, default OFF (off = no network). */
  private async radarSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    const seg = await this.yesNo(RADAR_SETTING, undefined, false)
    wrap.append(el('span', 'field-label', t('settings.radar')), seg, el('div', 'about', t('settings.radarHint')))
    return wrap
  }

  /**
   * CW keyer (Web Bluetooth now, APK later): the master switch "CW keying" (default
   * off — then nothing else shows and no Bluetooth is touched), and when on the link,
   * the default speed and the macro editor (profile × RUN / S&P).
   */
  private async keyerSetting(): Promise<HTMLElement> {
    const k = this.keyer
    const wrap = el('div', 'setting')
    const body = el('div', 'keyer-settings')
    body.hidden = !k.enabled
    const seg = await this.yesNo(KEYER_SETTINGS.enabled, (on) => {
      body.hidden = !on
      void k.setEnabled(on, false) // yesNo has saved it
    }, false)

    const status = el('div', 'about')
    const speedValue = el('b', 'keyer-wpm')
    const paint = (): void => {
      const n = k.notice
      if (n?.type === 'connectFailed') {
        status.textContent = t('settings.keyerFailed', { msg: n.message })
        k.clearNotice()
      } else if (k.link === 'on') {
        status.textContent = [k.name ?? 'keyer', k.version, k.battery !== undefined ? `${k.battery} %` : undefined]
          .filter((x) => x !== undefined)
          .join(' · ')
      } else if (k.link === 'connecting') {
        status.textContent = t('settings.keyerConnecting', { name: k.name ?? 'keyer' })
      } else {
        status.textContent = k.name ? `${k.name} · ${t('settings.keyerOff')}` : t('settings.keyerOff')
      }
      speedValue.textContent = `${k.defaultWpm} WPM`
    }
    this.unsubscribe?.()
    this.unsubscribe = k.subscribe(paint)
    paint()

    const link = el('div', 'segmented')
    link.append(
      button(t('settings.keyerConnect'), () => void k.connect(true), 'btn'),
      button(t('settings.keyerDisconnect'), () => void k.disconnect(), 'btn'),
      button(t('settings.keyerForget'), () => void k.forget(), 'btn'),
    )

    const speed = el('div', 'segmented keyer-speed')
    speed.append(
      button('−', () => void k.setDefaultWpm(Math.max(WPM_MIN, k.defaultWpm - 1)).then(paint), 'btn'),
      speedValue,
      button('+', () => void k.setDefaultWpm(Math.min(WPM_MAX, k.defaultWpm + 1)).then(paint), 'btn'),
    )

    body.append(
      el('span', 'field-label', t('settings.keyerSection')),
      status,
      link,
      el('span', 'field-label', t('settings.keyerSpeed')),
      speed,
      el('div', 'about', t('settings.keyerSpeedHint')),
      this.macroEditor(),
    )
    wrap.append(el('span', 'field-label', t('settings.keyer')), seg, el('div', 'about', t('settings.keyerHint')), body)
    return wrap
  }

  /** Macro texts per profile × RUN / S&P; only edited slots are stored. */
  private macroEditor(): HTMLElement {
    const k = this.keyer
    const wrap = el('div', 'keyer-macros')
    let mode: RunMode = 'run'
    const fields = el('div', 'keyer-macro-fields')
    const profile = tilePicker(
      t('settings.keyerMacros'),
      PROFILE_TILES.map(([value, key]) => ({ value, title: t(key) })),
      'vkv',
      () => fill(),
    )
    const modes = el('div', 'segmented')
    const mk = (m: RunMode, label: string): HTMLButtonElement => {
      const b = button(label, () => {
        mode = m
        for (const x of Array.from(modes.querySelectorAll<HTMLButtonElement>('button'))) x.setAttribute('aria-pressed', String(x === b))
        fill()
      }, 'btn')
      b.setAttribute('aria-pressed', String(m === mode))
      return b
    }
    modes.append(mk('run', 'RUN'), mk('sp', 'S&P'))

    const fill = (): void => {
      const p = profile.value() as ProfileId
      fields.replaceChildren(
        ...MACRO_SLOTS.map((slot) => {
          const f = fieldRow(slot, k.macroText(p, slot, mode))
          f.input.addEventListener('change', () => void k.saveMacros(withMacro(k.macros, p, mode, slot, f.input.value.trim())))
          return f.row
        }),
      )
    }
    fill()

    const reset = button(t('settings.keyerReset'), () => {
      void k.saveMacros(resetMacros(k.macros, profile.value() as ProfileId, mode)).then(fill)
    }, 'btn')
    wrap.append(profile.row, modes, el('div', 'about', t('settings.keyerMacrosHint')), fields, reset)
    return wrap
  }

  /** A Yes/No switch stored as '1'/'0' under `key`; missing = `def` (yes unless said). */
  private async yesNo(key: string, onChange?: (on: boolean) => void, def = true): Promise<HTMLElement> {
    const seg = el('div', 'segmented')
    const on = switchOn(await this.platform.getSetting(key), def)
    const mk = (value: '1' | '0', label: string): HTMLButtonElement => {
      const b = button(label, () => {
        void this.platform.setSetting(key, value)
        onChange?.(value === '1')
        for (const x of Array.from(seg.querySelectorAll<HTMLButtonElement>('button'))) {
          x.setAttribute('aria-pressed', String(x === b))
        }
      }, 'btn')
      b.setAttribute('aria-pressed', String((value === '1') === on))
      return b
    }
    seg.append(mk('1', t('common.yes')), mk('0', t('common.no')))
    return seg
  }

  private storageSetting(persisted: boolean): HTMLElement {
    const wrap = el('div', 'setting')
    wrap.append(
      el('span', 'field-label', t('settings.storage')),
      el('div', undefined, t(STORAGE_KEY[platformKind()])),
      el('div', 'about', persisted ? t('settings.persistYes') : t('settings.persistNo')),
    )
    return wrap
  }

  private about(): HTMLElement {
    const wrap = el('div', 'setting about')
    wrap.append(
      el('div', undefined, t('settings.aboutName')),
      el('div', undefined, t('settings.versionWeb', { v: `${__APP_VERSION__} · ${buildStamp(__BUILD_TIME__)}` })),
    )
    // APK version only when running inside the native shell.
    if (this.platform.nativeVersion) {
      wrap.append(el('div', undefined, t('settings.versionApp', { v: this.platform.nativeVersion })))
    }
    wrap.append(
      el('div', undefined, t('settings.aboutLicense')),
      el('div', undefined, t('settings.aboutAuthor')),
      el('div', undefined, 'github.com/ok1cdj/kQSO'),
      button(t('settings.whatsNew'), () => this.nav.openWhatsNew(), 'btn btn--small'),
    )
    return wrap
  }
}

/** Local build time as DD.MM.YYYY HH:MM. */
function buildStamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function parseStation(json: string | null): WavelogStation | null {
  if (!json) return null
  try {
    const s = JSON.parse(json) as WavelogStation
    return typeof s.id === 'number' ? s : null
  } catch {
    return null
  }
}

const stationLabel = (s: WavelogStation): string => (s.callsign && s.callsign !== s.name ? `${s.name} (${s.callsign})` : s.name)
