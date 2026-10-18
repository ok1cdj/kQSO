// New log form. Classic inputs (system keyboard is fine here).
// Band/mode are dropdowns (no typing). Reference accepts slash or dash. Operator
// call + locator prefill from the last remembered values (saved on create); each
// log still keeps its own meta in the .adi.

import {
  BANDS,
  MODES,
  PROFILES,
  SATELLITES,
  isFullLocator,
  latLonToGrid,
  matchBand,
  matchMode,
  parseReferenceInput,
  readLogFile,
  satelliteByLabel,
  satelliteSignal,
} from '../../core/index'
import type { AwardReference, LogMeta, ProfileId } from '../../core/index'
import type { KQSOPlatform } from '../../platform/index'
import type { Screen } from '../app'
import { el, button, fieldError, fieldRow, selectRow, strokeIcon, tilePicker } from '../dom'
import type { Tile } from '../dom'
import { t } from '../i18n'
import { trackEvent } from '../stats'

export interface NewLogNav {
  created(id: string): void
  cancel(): void
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
/** Local date as DDMMYYYY — the suggested log name. */
const dateName = (d: Date): string => `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${d.getFullYear()}`

const BAND_OPTIONS = BANDS.map((b) => [b, b] as const)
const MODE_OPTIONS = MODES.map((m) => [m, m] as const)


// "My location" crosshair: ring, centre dot, four ticks out.
const LOCATE_ICON = 'M12 2v4M12 18v4M2 12h4M18 12h4M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0'

// The four log profiles. Aktivace carries a sub-line naming its schemes.
const PROFILE_TILES = (): readonly Tile[] => [
  { value: 'aktivace', title: t('newlog.profileAktivace'), sub: t('newlog.profileAktivaceSub') },
  { value: 'obecny', title: t('newlog.profileObecny') },
  { value: 'vkv', title: t('newlog.profileVkv') },
  { value: 'sat', title: t('newlog.profileSat') },
]

// Each satellite tile shows the bird, "FM" for repeaters, and uplink↑/downlink↓.
const SAT_TILES: readonly Tile[] = SATELLITES.map((s) => ({
  value: s.label,
  title: s.fm ? `${s.label} FM` : s.label,
  sub: `${s.up}↑${s.down}↓`,
}))

export class NewLogScreen implements Screen {
  private readonly root = el('form', 'screen screen--form')

  constructor(
    private readonly platform: KQSOPlatform,
    private readonly nav: NewLogNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    void this.render()
  }

  unmount(): void {}

  private async render(): Promise<void> {
    const prev = await this.lastMeta()
    // Operator identity: last remembered call/locator win over the last log's.
    const rememberedCall = (await this.platform.getSetting('myCall')) ?? prev.myCall
    const rememberedGrid = (await this.platform.getSetting('myGrid')) ?? prev.myGrid
    // Satellite profile seeds its signal from the last-used bird (band/mode come
    // from the satellite, so the band/mode selects are hidden for it).
    const rememberedSat = satelliteByLabel((await this.platform.getSetting('satLabel')) ?? '') ?? SATELLITES[0]!

    // Default name = today's date (DDMMYYYY), pre-selected so typing overwrites it.
    const today = dateName(new Date())
    const name = fieldRow(t('newlog.name'), today, { placeholder: t('newlog.namePlaceholder') })
    // syncFields is defined below; the tile's onChange only fires on tap (after render).
    const profile = tilePicker(t('newlog.profile'), PROFILE_TILES(), prev.profile, () => onProfile())
    const myCall = fieldRow(t('newlog.myCall'), rememberedCall)
    const myGrid = fieldRow(t('newlog.myGrid'), rememberedGrid)
    // Every profile needs the own call: ADIF STATION_CALLSIGN, {MYCALL} in the CW macros.
    const callError = fieldError(myCall, t('newlog.myCallRequired'))
    // VKV contest can't score QRB without the own locator — block Create until it's valid.
    const gridError = fieldError(myGrid, t('newlog.myGridRequired'))
    this.addLocate(myGrid)
    const myRef = fieldRow(t('newlog.myRef'), '', { placeholder: t('newlog.myRefPlaceholder') })
    const band = selectRow(t('newlog.band'), BAND_OPTIONS, prev.defaultSignal.band)
    const mode = selectRow(t('newlog.mode'), MODE_OPTIONS, prev.defaultSignal.mode)
    // One log per satellite pass — the bird is chosen here, not on the logging screen.
    const sat = tilePicker(t('newlog.satellite'), SAT_TILES, prev.satLabel ?? rememberedSat.label)

    const collect = (): LogMeta => {
      const profileId = profile.value() as ProfileId
      const chosenSat = satelliteByLabel(sat.value()) ?? rememberedSat
      const meta: { -readonly [K in keyof LogMeta]: LogMeta[K] } = {
        name: name.input.value.trim() || today,
        profile: profileId,
        myCall: myCall.input.value.trim().toUpperCase(),
        myGrid: myGrid.input.value.trim().toUpperCase(),
        defaultSignal:
          profileId === 'sat'
            ? satelliteSignal(chosenSat, 'SSB')
            : {
                band: matchBand(band.select.value) ?? prev.defaultSignal.band,
                mode: matchMode(mode.select.value) ?? prev.defaultSignal.mode,
              },
      }
      if (profileId === 'sat') meta.satLabel = chosenSat.label
      const ref: AwardReference | null =
        profileId === 'aktivace' ? parseReferenceInput(myRef.input.value) : null
      if (ref) meta.myRef = ref
      return meta
    }

    const actions = el('div', 'form-actions')
    actions.append(
      button(t('newlog.create'), () => {
        const meta = collect()
        if (meta.myCall === '') {
          callError.show()
          return
        }
        if (PROFILES[meta.profile].requiresGrid && !isFullLocator(meta.myGrid)) {
          gridError.show()
          return
        }
        void this.create(meta)
      }, 'btn btn--primary'),
      button(t('common.cancel'), () => this.nav.cancel(), 'btn'),
    )

    this.root.replaceChildren(
      el('div', 'bar', t('newlog.title')),
      name.row,
      profile.row,
      myCall.row,
      myGrid.row,
      myRef.row,
      band.row,
      mode.row,
      sat.row,
      actions,
    )

    // Show only the fields a profile uses: satellite logs pick a bird (which sets
    // band/mode); the reference is Activation-only.
    const syncFields = (): void => {
      const profileId = profile.value()
      const isSat = profileId === 'sat'
      band.row.hidden = isSat
      mode.row.hidden = isSat
      sat.row.hidden = !isSat
      myRef.row.hidden = profileId !== 'aktivace'
    }
    // Picking VHF contest starts it on 2m SSB (still changeable below). Only on a tap:
    // a VKV log prefilled from the last one keeps that log's band and mode.
    const onProfile = (): void => {
      if (profile.value() === 'vkv') {
        band.select.value = '2m'
        mode.select.value = 'SSB'
      }
      syncFields()
    }
    syncFields()
    name.input.focus()
    name.input.select()
  }

  /** The locate button next to the locator: the device position → 6-character locator. Asked only
   *  on the tap, so nobody who doesn't use it ever sees the permission prompt. */
  private addLocate(field: { row: HTMLElement; input: HTMLInputElement }): void {
    const getPosition = this.platform.getPosition
    if (!getPosition) return
    const note = el('span', 'field-note')
    note.hidden = true
    const say = (text: string): void => {
      note.textContent = text
      note.hidden = text === ''
    }
    const locate = button('', () => {
      locate.disabled = true
      say(t('newlog.locating'))
      getPosition()
        .then((p) => {
          field.input.value = latLonToGrid(p.lat, p.lon)
          field.input.dispatchEvent(new Event('input')) // clears a "required" error
          // Android's approximate location is ~2 km off: the subsquare may be wrong.
          say(p.accuracy > 2000 ? t('newlog.locateRough', { km: Math.round(p.accuracy / 1000) }) : '')
        })
        .catch((e: unknown) => {
          const why = e instanceof Error ? e.message : ''
          say(t(why === 'denied' ? 'newlog.locateDenied' : why === 'timeout' ? 'newlog.locateTimeout' : 'newlog.locateUnavailable'))
        })
        .finally(() => {
          locate.disabled = false
        })
    }, 'btn btn--icon')
    locate.append(strokeIcon(LOCATE_ICON, 'icon'))
    locate.title = t('newlog.locate')
    locate.setAttribute('aria-label', t('newlog.locate'))
    const inline = el('span', 'field-inline')
    field.input.replaceWith(inline)
    inline.append(field.input, locate)
    inline.after(note)
  }

  private async create(meta: LogMeta): Promise<void> {
    // Remember operator identity for the next New Log (not per-log — logs keep their own meta).
    await this.platform.setSetting('myCall', meta.myCall)
    await this.platform.setSetting('myGrid', meta.myGrid)
    if (meta.satLabel !== undefined) await this.platform.setSetting('satLabel', meta.satLabel)
    const id = await this.platform.createLog(meta)
    trackEvent('log-create', { profile: meta.profile })
    this.nav.created(id)
  }

  /** Prefill source for profile/report/band/mode: the most recent log's meta, or fallbacks. */
  private async lastMeta(): Promise<LogMeta> {
    const logs = await this.platform.listLogs()
    const last = logs[logs.length - 1]
    if (last) {
      const { meta } = readLogFile(await this.platform.readLog(last.id))
      return meta
    }
    return {
      name: '',
      profile: 'aktivace',
      myCall: '',
      myGrid: '',
      defaultSignal: { band: '40m', mode: 'SSB' },
    }
  }
}
