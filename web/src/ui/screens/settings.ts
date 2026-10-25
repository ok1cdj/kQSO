// Settings, one page ordered by how often it's used: display, map, Wavelog; then the
// one-time / technical parts folded with a state line (callsign database, offline
// references, radio CI-V, M5 keyer); storage, and About with the "How to log" help.
// Language follows navigator.language with no in-app switch.

import { LiveDb, SKED_DEFAULT, WAVELOG_SETTINGS, apiBase, dbDate, userHeader, MACRO_SLOTS, ESM_ONLY_SLOTS, infoLabel, cqLabel, WPM_MAX, WPM_MIN, withMacro, resetMacros, xvertBands, rigHasBand, RIG_MODELS, parseMHz, bandForFreq } from '../../core/index'
import type { ProfileId, RunMode, WavelogStation, Xvert } from '../../core/index'
import { platformKind } from '../../platform/index'
import type { KQSOPlatform } from '../../platform/index'
import { currentDisplayMode, currentThemeMode, setDisplayMode, setThemeMode } from '../../theme/mode'
import type { DisplayMode, ThemeMode } from '../../theme/mode'
import type { Screen } from '../app'
import { el, button, fieldRow, strokeIcon, switchOn, tilePicker } from '../dom'
import { connect } from '../wavelog'
import { wavelogErrorText } from '../wavelog-text'
import { lang, t } from '../i18n'
import { BUNDLED_DB_SETTING, BUNDLED_IDS, bundledInfo } from '../bundled-db'
import { MAP_LABELS_SETTING } from './map'
import { RADAR_SETTING } from '../radar'
import { STATS_SETTING, setStatsEnabled } from '../stats'
import { KEYER_SETTINGS } from '../keyer'
import { KST_SETTINGS, kstStatus } from '../kst'
import type { KstController } from '../kst'
import { KEYBOARD_MODES, KEYBOARD_SETTING, parseKeyboardMode } from '../keyboard'
import type { KeyboardMode } from '../keyboard'
import { keyerGuideLink } from '../keyer-guide'
import { APP_STORE_URL, PLAY_URL } from '../stores'
import type { KeyerController } from '../keyer'
import { RIG_SETTINGS } from '../rig'
import type { RigController } from '../rig'
import { UPDATE_SETTINGS, checksUpdates } from '../update'
import { fieldsAround, parseField } from '../../core/refdb'
import { REFS_URL, downloadTile, removeTile, storedTiles } from '../refsync'

export interface SettingsNav {
  back(): void
  openHelp(): void
  openWhatsNew(): void
  openManual(): void
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

const CHEVRON = 'M9 6l6 6-6 6'

/** Folded sections open in this run of the app: Help / What's new and back keeps them open. */
const openFolds = new Set<string>()

export class SettingsScreen implements Screen {
  private readonly root = el('div', 'screen screen--list')
  private unsubscribe: (() => void) | undefined
  private unsubscribeRig: (() => void) | undefined
  private unsubscribeRigCw: (() => void) | undefined
  private unsubscribeKst: (() => void) | undefined

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly keyer: KeyerController,
    private readonly rig: RigController,
    private readonly kst: KstController,
    private readonly nav: SettingsNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {
    this.unsubscribe?.()
    this.unsubscribeRig?.()
    this.unsubscribeRigCw?.()
    this.unsubscribeKst?.()
  }

  private async render(): Promise<void> {
    const bar = el('div', 'bar')
    bar.append(button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'), el('b', 'title', t('settings.title')))

    const persisted = await this.platform.isPersisted()
    this.root.replaceChildren(
      bar,
      this.displayModeSetting(),
      await this.keyboardSetting(),
      await this.mapSetting(),
      await this.wavelogSetting(),
      await this.callDbSetting(),
      ...(this.platform.refTiles ? [await this.refsSetting()] : []),
      ...(this.rig.available ? [await this.rigSetting()] : []),
      ...(this.keyer.available ? [await this.keyerSetting()] : []),
      ...(this.kst.available ? [await this.kstSetting()] : []),
      this.storageSetting(persisted),
      ...(this.platform.nativeVersion
        ? checksUpdates(this.platform)
          ? [await this.updateSetting()]
          : []
        : [await this.statsSetting()]),
      this.about(),
    )
  }

  /** A folded section: the summary row is the title, a state line and a chevron. */
  private fold(id: string, title: string, state: HTMLElement, ...body: Node[]): HTMLElement {
    const d = el('details', 'setting setting--fold')
    d.open = openFolds.has(id)
    d.addEventListener('toggle', () => {
      if (d.open) openFolds.add(id)
      else openFolds.delete(id)
    })
    const head = el('span', 'setting__head')
    state.classList.add('about')
    head.append(el('span', 'field-label', title), state)
    const summary = el('summary')
    summary.append(head, strokeIcon(CHEVRON, 'icon'))
    const content = el('div', 'setting__body')
    content.append(...body)
    d.append(summary, content)
    return d
  }

  /** Standard / E-ink, and under it the standard-mode theme (hidden in e-ink, which is always black on white). */
  private displayModeSetting(): HTMLElement {
    const wrap = el('div', 'setting')
    wrap.append(el('span', 'field-label', t('settings.display')))
    const seg = el('div', 'segmented')
    const themeSeg = el('div', 'segmented')
    const showTheme = (): void => {
      themeSeg.style.display = currentDisplayMode() === 'standard' ? '' : 'none'
    }

    const mkBtn = (mode: DisplayMode, label: string): HTMLButtonElement => {
      const b = button(label, () => void this.pick(mode, seg).then(showTheme), 'btn')
      b.dataset.mode = mode
      b.setAttribute('aria-pressed', String(currentDisplayMode() === mode))
      return b
    }
    const mkTheme = (theme: ThemeMode, label: string): HTMLButtonElement => {
      const b = button(label, () => void this.pickTheme(theme, themeSeg), 'btn')
      b.dataset.mode = theme
      b.setAttribute('aria-pressed', String(currentThemeMode() === theme))
      return b
    }
    seg.append(mkBtn('standard', t('settings.standard')), mkBtn('eink', t('settings.eink')))
    themeSeg.append(mkTheme('system', t('settings.themeSystem')), mkTheme('light', t('settings.themeLight')), mkTheme('dark', t('settings.themeDark')))
    showTheme()
    wrap.append(seg, themeSeg)
    return wrap
  }

  /** Logging keyboard: kQSO's own / the system one / none (hardware keyboard). */
  private async keyboardSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    wrap.append(el('span', 'field-label', t('settings.keyboard')))
    const current = parseKeyboardMode(await this.platform.getSetting(KEYBOARD_SETTING))
    const label: Record<KeyboardMode, string> = {
      kqso: t('settings.keyboardKqso'),
      system: t('settings.keyboardSystem'),
      none: t('settings.keyboardNone'),
    }
    const seg = el('div', 'segmented')
    for (const mode of KEYBOARD_MODES) {
      const b = button(label[mode], () => {
        void this.platform.setSetting(KEYBOARD_SETTING, mode)
        for (const x of Array.from(seg.querySelectorAll<HTMLButtonElement>('button'))) {
          x.setAttribute('aria-pressed', String(x === b))
        }
      }, 'btn')
      b.setAttribute('aria-pressed', String(mode === current))
      seg.append(b)
    }
    wrap.append(seg, el('div', 'about', t('settings.keyboardHint')))
    return wrap
  }

  private async pick(mode: DisplayMode, seg: HTMLElement): Promise<void> {
    await setDisplayMode(this.platform, mode) // instant, no reload
    for (const b of Array.from(seg.querySelectorAll<HTMLButtonElement>('button'))) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
    }
  }

  private async pickTheme(theme: ThemeMode, seg: HTMLElement): Promise<void> {
    await setThemeMode(this.platform, theme) // instant, no reload
    for (const b of Array.from(seg.querySelectorAll<HTMLButtonElement>('button'))) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === theme))
    }
  }

  /** Callsign DB: bundled-set switch + versions, own layer size, export/import/delete. */
  private async callDbSetting(): Promise<HTMLElement> {
    const live = LiveDb.fromText(await this.platform.readCallDb())
    const status = el('div', 'about')
    const ownLine = el('div', undefined, t('settings.dbOwn', { n: live.size }))

    const seg = el('div', 'segmented')
    const on = (await this.platform.getSetting(BUNDLED_DB_SETTING)) !== '0'
    let bundledOn = on
    const state = el('span')
    const paintState = (): void => {
      state.textContent = t('settings.dbSummary', { on: t(bundledOn ? 'common.yes' : 'common.no').toLowerCase(), n: live.size })
    }
    paintState()
    const mk = (value: '1' | '0', label: string): HTMLButtonElement => {
      const b = button(label, () => {
        void this.platform.setSetting(BUNDLED_DB_SETTING, value)
        bundledOn = value === '1'
        paintState()
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
      paintState()
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

    return this.fold('db', t('settings.db'), state, el('div', undefined, t('settings.dbBundled')), seg, sets, ownLine, actions, status)
  }

  /** Offline references for New log: the stored fields (each deletable), downloading the
   *  area around the position or a typed field / locator, and where the data comes from. */
  private async refsSetting(): Promise<HTMLElement> {
    const state = el('span')
    const list = el('div', 'refs-list')
    const status = el('div', 'about')
    const say = (text: string): void => {
      status.textContent = text
    }
    const num = (n: number): string => n.toLocaleString(lang)

    const showList = async (): Promise<void> => {
      const tiles = await storedTiles(this.platform)
      const names = tiles.map((tile) => tile.field)
      state.textContent =
        tiles.length === 0
          ? t('settings.refsSummaryNone')
          : t('settings.refsSummary', { n: tiles.length, fields: names.slice(0, 4).join(', ') + (names.length > 4 ? ' …' : '') })
      if (tiles.length === 0) {
        list.replaceChildren(el('div', 'about', t('settings.refsNone')))
        return
      }
      list.replaceChildren(
        ...tiles.map((tile) => {
          const row = el('div', 'refs-row')
          row.append(
            el('span', 'refs-row__text', t('settings.refsTile', { field: tile.field, n: num(tile.count), d: tile.updated })),
            button(t('common.delete'), () => {
              void removeTile(this.platform, tile.field).then(showList)
            }, 'btn btn--small'),
          )
          return row
        }),
      )
    }

    // Downloads one field after another; the buttons are off meanwhile.
    const busy: HTMLButtonElement[] = []
    const fetchFields = async (fields: readonly string[]): Promise<void> => {
      for (const b of busy) b.disabled = true
      const got: string[] = []
      const failed: string[] = []
      for (const f of fields) {
        say(t('settings.refsDownloading', { field: f }))
        // A full storage throws on the write: that field failed, the next may fit.
        const ok = await downloadTile(this.platform, f).catch(() => false)
        ;(ok ? got : failed).push(f)
      }
      await showList().catch(() => {})
      say(
        [
          got.length > 0 ? t('settings.refsDownloaded', { fields: got.join(', ') }) : '',
          failed.length > 0 ? t('settings.refsFailed', { fields: failed.join(', ') }) : '',
        ].filter(Boolean).join(' '),
      )
      for (const b of busy) b.disabled = false
    }

    const area = fieldRow(t('settings.refsArea'), '', { placeholder: 'JN69' })
    const fetchArea = button(t('settings.refsAreaDownload'), () => {
      const field = parseField(area.input.value)
      if (!field) {
        say(t('settings.refsAreaBad'))
        return
      }
      void fetchFields([field])
    }, 'btn')
    busy.push(fetchArea)
    const actions = el('div', 'segmented')
    actions.append(fetchArea)

    const getPosition = this.platform.getPosition
    if (getPosition) {
      const around = button(t('settings.refsAround'), () => {
        say(t('newlog.locating'))
        getPosition()
          .then((p) => fetchFields(fieldsAround(p.lat, p.lon, 25)))
          .catch(() => say(t('settings.refsNoPosition')))
      }, 'btn')
      busy.push(around)
      actions.prepend(around)
    }

    const sources = el('div', 'about')
    const a = el('a', undefined, t('settings.refsSources'))
    a.href = `${REFS_URL}LICENSE.txt`
    a.target = '_blank'
    a.rel = 'noopener'
    sources.append(a)

    await showList()
    return this.fold('refs', t('settings.refs'), state, el('div', undefined, t('settings.refsAbout')), list, area.row, actions, status, sources)
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

  /**
   * ON4KST chat: the account (call, password — never shown back) and the sked template.
   * "Save and connect" stores them and connects, so a wrong password shows right here.
   */
  private async kstSetting(): Promise<HTMLElement> {
    const K = KST_SETTINGS
    const p = this.platform
    const savedPass = (await p.getSetting(K.pass)) ?? ''
    const call = fieldRow(t('settings.kstCall'), (await p.getSetting(K.call)) ?? '', { placeholder: 'OK1ABC' })
    const pass = fieldRow(t('settings.kstPass'), '', { placeholder: savedPass ? `•••• ${t('settings.kstPassSaved')}` : '' })
    pass.input.type = 'password'
    pass.input.autocapitalize = 'off'
    const sked = fieldRow(t('settings.kstSked'), (await p.getSetting(K.sked)) || SKED_DEFAULT)
    sked.input.autocapitalize = 'off'
    const state = el('span')
    const status = el('div', 'about')
    const muted = el('div', 'setting')
    let mutedKey = ''
    const paintMuted = (): void => {
      const list = this.kst.muted
      if (list.join() === mutedKey && muted.firstChild) return
      mutedKey = list.join()
      const rows = el('div', 'segmented segmented--wrap')
      rows.append(...list.map((c) => button(`${c} ✕`, () => this.kst.setMuted(c, false), 'btn btn--small')))
      muted.replaceChildren(el('span', 'field-label', t('settings.kstMuted')), list.length ? rows : el('div', 'about', t('settings.kstMutedNone')))
    }
    const paint = (): void => {
      paintMuted()
      status.textContent = kstStatus(this.kst)
      state.textContent = this.kst.link === 'on' || this.kst.wanted ? status.textContent : savedPass ? t('kst.off') : t('settings.kstSummaryOff')
    }
    this.unsubscribeKst?.()
    this.unsubscribeKst = this.kst.subscribe(paint)
    paint()

    const save = async (): Promise<void> => {
      await p.setSetting(K.call, call.input.value.trim().toUpperCase())
      const pw = pass.input.value
      if (pw) await p.setSetting(K.pass, pw)
      await p.setSetting(K.sked, sked.input.value.trim() === SKED_DEFAULT ? '' : sked.input.value.trim())
      pass.input.value = ''
      if (pw || savedPass) pass.input.placeholder = `•••• ${t('settings.kstPassSaved')}`
      this.kst.disconnect()
      await this.kst.connect()
    }
    const actions = el('div', 'segmented')
    actions.append(
      button(t('settings.kstSave'), () => void save(), 'btn'),
      button(t('kst.disconnect'), () => this.kst.disconnect(), 'btn'),
      button(t('settings.kstForget'), () => {
        void (async () => {
          this.kst.disconnect()
          await p.setSetting(K.pass, '')
          pass.input.placeholder = ''
          status.textContent = t('settings.kstForgotten')
        })()
      }, 'btn'),
    )
    const reg = el('div', 'about')
    const a = el('a', undefined, t('settings.kstRegister'))
    a.href = 'https://www.on4kst.org/'
    a.target = '_blank'
    a.rel = 'noopener'
    reg.append(a)
    const hints = [el('div', 'about', t('settings.kstPassHint'))]
    if (!this.platform.nativeVersion) hints.push(el('div', 'about', t('settings.kstWeb')))
    return this.fold('kst', t('settings.kst'), state, el('div', undefined, t('settings.kstAbout')), call.row, pass.row, ...hints, sked.row, actions, status, muted, reg)
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

  /** Map: the calls next to the QSO dots (default on) and the rain radar on the VKV map
   *  (default OFF, off = no network). */
  private async mapSetting(): Promise<HTMLElement> {
    const wrap = el('div', 'setting')
    wrap.append(
      el('span', 'field-label', t('settings.mapLabels')),
      await this.yesNo(MAP_LABELS_SETTING),
      el('span', 'field-label', t('settings.radar')),
      await this.yesNo(RADAR_SETTING, undefined, false),
      el('div', 'about', t('settings.radarHint')),
    )
    return wrap
  }

  /**
   * The M5 keyer — one device, so one place to connect it: the link (Connect /
   * Disconnect / Forget, status, the radio it has on CI-V) shows when anything uses the
   * keyer, CW keying or the radio via the keyer. Below, the switch "CW keying" (default
   * off) and the default speed, ESM and the macro editor (profile × RUN / S&P).
   */
  private async keyerSetting(): Promise<HTMLElement> {
    const k = this.keyer
    const r = this.rig
    const state = el('span')
    const body = el('div', 'keyer-settings')
    // The switch is CW keying by the M5 keyer; speed, ESM and macros serve a radio keying CW over CI-V too.
    const atom = el('div', 'keyer-settings')
    const cw = el('div', 'keyer-settings')
    const viaKeyer = (): boolean => r.enabled && r.source === 'keyer'
    const show = (): void => {
      atom.hidden = !k.enabled && !viaKeyer()
      cw.hidden = !k.enabled && !r.enabled
    }
    const seg = await this.yesNo(KEYER_SETTINGS.enabled, (on) => {
      void k.setEnabled(on, false).then(() => {
        show()
        paint()
      }) // yesNo has saved it
      atom.hidden = !on && !viaKeyer()
    }, false)
    this.unsubscribeRigCw?.()
    this.unsubscribeRigCw = this.rig.subscribe(show)
    show()

    const status = el('div', 'about')
    const speedValue = el('b', 'keyer-wpm')
    const paint = (): void => {
      const n = k.notice
      if (n?.type === 'connectFailed') {
        status.textContent = t('settings.keyerFailed', { msg: n.message })
        k.clearNotice()
      } else if (k.link === 'on') {
        // The radio on its CI-V bus, when the radio goes via the keyer.
        const civ = !viaKeyer() || r.oldFirmware ? undefined : r.controls ? t('settings.keyerCiv', { radio: r.model.label }) : t('settings.keyerNoCiv')
        status.textContent = [k.name ?? 'keyer', k.version, k.battery !== undefined ? `${k.battery} %` : undefined, civ]
          .filter((x) => x !== undefined)
          .join(' · ')
      } else if (k.link === 'connecting') {
        status.textContent = t('settings.keyerConnecting', { name: k.name ?? 'keyer' })
      } else {
        status.textContent = k.name ? `${k.name} · ${t('settings.keyerOff')}` : t('settings.keyerOff')
      }
      speedValue.textContent = `${k.defaultWpm} WPM`
      state.textContent = [atom.hidden ? t('settings.keyerSummaryOff') : status.textContent, cw.hidden ? undefined : `${k.defaultWpm} WPM`]
        .filter((x) => x !== undefined)
        .join(' · ')
    }
    this.unsubscribe?.()
    const unK = k.subscribe(paint)
    const unR = r.subscribe(paint)
    this.unsubscribe = () => {
      unK()
      unR()
    }
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

    const esm = await this.yesNo(KEYER_SETTINGS.esm, (on) => void k.setEsm(on, false), false) // yesNo has saved it

    atom.append(status, link)
    const guide = el('div', 'about')
    guide.append(keyerGuideLink(t('settings.keyerGuide')))
    cw.append(
      el('span', 'field-label', t('settings.keyerSpeed')),
      speed,
      el('div', 'about', t('settings.keyerSpeedHint')),
      el('span', 'field-label', t('settings.keyerEsm')),
      esm,
      el('div', 'about', t('settings.keyerEsmHint')),
      this.macroEditor(),
    )
    body.append(cw)
    return this.fold('keyer', t('settings.keyerDevice'), state, guide, atom, el('span', 'field-label', t('settings.keyer')), seg, el('div', 'about', t('settings.keyerHint')), body)
  }

  /** Radio over CI-V: on / off; the IC-705's own Bluetooth (APK) or any Icom through the
   *  keyer; the model (auto by address) and its optional units; Connect / Disconnect /
   *  Forget; what the radio is on; transverters. */
  private async rigSetting(): Promise<HTMLElement> {
    const r = this.rig
    const state = el('span')
    const body = el('div', 'keyer-settings')
    body.hidden = !r.enabled
    const seg = await this.yesNo(RIG_SETTINGS.enabled, (on) => {
      body.hidden = !on
      void r.setEnabled(on, false).then(() => paint()) // yesNo has saved it
    }, false)

    // IC-705 Bluetooth | via the keyer — only where both exist (APK).
    const source = el('div', 'segmented')
    source.hidden = !r.sourceChoice
    const sourceBtns = (['ic705', 'keyer'] as const).map((src) => {
      const b = button(t(src === 'ic705' ? 'settings.rigSourceIc705' : 'settings.rigSourceKeyer'), () => void r.setSource(src), 'btn')
      source.append(b)
      return { src, b }
    })

    // Model (via the keyer): Auto (what the address says) or one from the table.
    const model = el('div', 'segmented segmented--wrap')
    const modelBtns = [{ id: 'auto', label: '' }, ...RIG_MODELS.map((m) => ({ id: m.id, label: m.label }))].map(({ id, label }) => {
      const b = button(label, () => void r.setModel(id), 'btn')
      model.append(b)
      return { id, b }
    })
    const modelHint = el('div', 'about', t('settings.rigModelHint'))
    const modelBox = el('div', 'keyer-settings')
    modelBox.append(el('span', 'field-label', t('settings.rigModel')), model, modelHint)
    // Optional units of the model (IC-910: 23 cm).
    const options = el('div', 'segmented segmented--wrap')

    const status = el('div', 'about')
    // Via the keyer the link is the keyer's (its section): no second set of buttons here.
    const keyerNote = el('div', 'about')
    const link = el('div', 'segmented')
    const name = (): string => (r.source === 'keyer' ? r.model.label : r.name ?? 'IC-705')
    const via = (): string => (r.source === 'keyer' && r.name ? ` · ${t('settings.rigVia', { name: r.name })}` : '')
    let shownModel = ''
    const xvertBox = el('div', 'keyer-settings')
    const paint = (): void => {
      for (const { src, b } of sourceBtns) b.setAttribute('aria-pressed', String(r.source === src))
      modelBox.hidden = r.source !== 'keyer'
      link.hidden = r.source === 'keyer'
      keyerNote.hidden = r.source !== 'keyer'
      keyerNote.textContent = t(this.keyer.link === 'off' ? 'settings.rigKeyerOff' : 'settings.rigKeyerLink')
      const det = r.detectedModel
      const addr = r.addr === undefined ? '' : `, ${r.addr.toString(16).toUpperCase().padStart(2, '0')}`
      for (const { id, b } of modelBtns) {
        b.setAttribute('aria-pressed', String(r.modelChoice === id || (id === 'auto' && !RIG_MODELS.some((m) => m.id === r.modelChoice))))
        if (id === 'auto') b.textContent = r.addr === undefined ? t('settings.rigModelAuto') : `${t('settings.rigModelAuto')} (${det.label}${addr})`
      }
      const m = r.model
      options.replaceChildren(
        ...(m.optional ?? []).map((band) => {
          const b = button(t('settings.rigOption', { band }), () => void r.setOption(band, !r.options.includes(band)), 'btn')
          b.setAttribute('aria-pressed', String(r.options.includes(band)))
          return b
        }),
      )
      options.hidden = (m.optional ?? []).length === 0
      // The transverter bands follow the radio: rebuilt when the model or a unit changes.
      const key = `${m.id}|${r.options.join(',')}`
      if (key !== shownModel) {
        shownModel = key
        void this.xvertSetting().then((x) => xvertBox.replaceChildren(x))
      }

      const n = r.notice
      if (n?.type === 'connectFailed') {
        status.textContent = t('settings.rigFailed', { msg: n.message })
        r.clearNotice()
      } else if (r.oldFirmware) {
        status.textContent = t('settings.rigFirmware')
        if (n?.type === 'firmware') r.clearNotice()
      } else if (r.controls) {
        const f = r.freqHz !== undefined ? `${(r.freqHz / 1e6).toFixed(3)} MHz` : undefined
        status.textContent = [name(), f, r.mode].filter((x) => x !== undefined).join(' · ') + via()
      } else if (r.link === 'on') {
        status.textContent = t('settings.rigHandshake', { name: name() })
      } else if (r.link === 'connecting') {
        status.textContent = r.source === 'keyer' && this.keyer.link === 'on' ? t('settings.rigNoRadio', { name: r.name ?? 'keyer' }) : t('settings.rigConnecting', { name: r.source === 'keyer' ? (r.name ?? 'keyer') : name() })
      } else {
        status.textContent = r.name ? `${r.name} · ${t('settings.rigOff')}` : t('settings.rigOff')
      }
      state.textContent = r.enabled ? status.textContent : t('settings.rigSummaryOff')
    }
    this.unsubscribeRig?.()
    const unR = r.subscribe(paint)
    const unK = this.keyer.subscribe(paint)
    this.unsubscribeRig = () => {
      unR()
      unK()
    }
    paint()

    link.append(
      button(t('settings.keyerConnect'), () => void r.connect(true), 'btn'),
      button(t('settings.keyerDisconnect'), () => void r.disconnect(), 'btn'),
      button(t('settings.keyerForget'), () => void r.forget(), 'btn'),
    )
    body.append(source, modelBox, options, status, keyerNote, link, xvertBox)
    return this.fold('rig', t('settings.rig'), state, seg, el('div', 'about', t('settings.rigHint')), body)
  }

  /** Transverters: XVERT on / off, and per band the RF frequency that is which IF on the
   *  radio (3cm 10368.000 = 145.000). A row is saved once both numbers make sense. */
  private async xvertSetting(): Promise<HTMLElement> {
    const r = this.rig
    const wrap = el('div', 'keyer-settings')
    const table = el('div', 'xvert-table')
    table.hidden = !r.xvertOn
    const seg = await this.yesNo(RIG_SETTINGS.xvert, (on) => {
      table.hidden = !on
      void r.setXvertOn(on, false) // yesNo has saved it
    }, false)

    const rows = xvertBands(r.model, r.options).map((band) => {
      const x = r.xverts.find((v) => v.band === band)
      const mhz = (hz: number | undefined): string => (hz === undefined ? '' : (hz / 1e6).toFixed(3))
      const row = el('div', 'xvert-row')
      // The band is the row's own switch: only a pressed one is used.
      const on = button(band, () => {
        on.setAttribute('aria-pressed', String(on.getAttribute('aria-pressed') !== 'true'))
        void save()
      }, 'btn')
      on.setAttribute('aria-pressed', String(x?.on === true))
      const rf = el('input', 'field-input')
      const ifr = el('input', 'field-input')
      for (const [input, value, ph] of [[rf, mhz(x?.rfHz), 'RF MHz'], [ifr, mhz(x?.ifHz), 'IF MHz']] as const) {
        input.type = 'text'
        input.inputMode = 'decimal'
        input.autocomplete = 'off'
        input.value = value
        input.placeholder = ph
        input.addEventListener('change', () => void save())
      }
      row.append(on, rf, ifr)
      return { band, row, on, rf, ifr }
    })

    const save = async (): Promise<void> => {
      // Rows of bands this radio works itself are not shown, but stay stored (another radio).
      const xs: Xvert[] = r.xverts.filter((x) => !rows.some((row) => row.band === x.band))
      for (const { band, row, on, rf, ifr } of rows) {
        const rfHz = parseMHz(rf.value)
        const ifHz = parseMHz(ifr.value)
        const empty = rf.value.trim() === '' && ifr.value.trim() === ''
        const ok = rfHz !== undefined && ifHz !== undefined && bandForFreq(rfHz) === band && rigHasBand(r.model, bandForFreq(ifHz) ?? '', r.options)
        row.classList.toggle('field--error', !empty && !ok)
        if (ok) xs.push({ band, rfHz, ifHz, on: on.getAttribute('aria-pressed') === 'true' })
      }
      await r.saveXverts(xs)
    }

    table.append(...rows.map((x) => x.row), el('div', 'about', t('settings.xvertHint')))
    wrap.append(el('span', 'field-label', t('settings.xvert')), seg, table)
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
          const label =
            slot === 'INFO' ? infoLabel(p) : slot === 'CQ' ? cqLabel(mode) : ESM_ONLY_SLOTS.includes(slot) ? `${slot} · ESM` : slot
          const f = fieldRow(label, k.macroText(p, slot, mode))
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
    )
    // The apps in the stores (shown everywhere: in an app it's where to rate / share it).
    const stores = el('div')
    const link = (label: string, href: string): HTMLAnchorElement => {
      const a = el('a', undefined, label)
      a.href = href
      a.target = '_blank'
      a.rel = 'noopener'
      return a
    }
    stores.append(`${t('settings.aboutApps')} `, link('Google Play', PLAY_URL))
    if (APP_STORE_URL) stores.append(' · ', link('App Store', APP_STORE_URL))
    const links = el('div', 'segmented')
    links.append(
      button(`${t('settings.manual')} ›`, () => this.nav.openManual(), 'btn btn--small'),
      button(`${t('settings.help')} ›`, () => this.nav.openHelp(), 'btn btn--small'),
      button(`${t('settings.whatsNew')} ›`, () => this.nav.openWhatsNew(), 'btn btn--small'),
    )
    wrap.append(stores, links)
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
