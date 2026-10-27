// CW decoder controller, one for the whole app (like the KST chat): the settings, the
// audio input, the worker and the transcript. It listens only while it is turned on and
// a log is open in CW (the logging screen says so with setActive); in SSB / FM or away
// from the log the input and the model rest. The logging screen shows the transcript
// under the header and puts a tapped word into the log line; Settings downloads the
// model and sets the pitch. Screens subscribe and re-render on change.

import type { KQSOPlatform } from '../../platform/index'
import { switchOn } from '../dom'
import { t } from '../i18n'
import { CwCapture, NoTabAudioError, TAB_SOURCE, audioInputs, unlockInputs, type AudioInput } from './audio'
import { CwDecoderClient, cwDecoderAvailable, type CwModel, type CwStatus, type CwTuning } from './client'

export const CW_SETTINGS = {
  on: 'cwOn', // '1' = turned on: listens whenever a log is open in CW
  model: 'cwModel', // 'narrow' | 'wide'
  pitch: 'cwPitch', // Hz, the rig's CW pitch
  width: 'cwWidth', // Hz, wide model's filter around the pitch; '' = the whole band
  device: 'cwDevice', // audio input deviceId, '' = the default one, 'tab' = another browser tab
} as const

export const PITCH_MIN = 400
export const PITCH_MAX = 1200
const PITCH_DEFAULT = 700
/** The transcript keeps this many words: two lines' worth under the header and some to scroll. */
const KEEP_WORDS = 80
const LEVEL_EVERY_MS = 250

/** 'tab': listening from another tab, waiting for the click that picks it (pickTab). */
export type CwState = 'off' | 'starting' | 'tab' | 'on' | 'error'

export class CwDecoderController {
  readonly available = cwDecoderAvailable()
  private readonly client = new CwDecoderClient()
  private readonly capture = new CwCapture()
  private readonly listeners = new Set<() => void>()
  state: CwState = 'off'
  /** Turned on by the user (Settings, Alt+U); it runs only while also active. */
  enabled = false
  /** A log is open in CW. */
  private active = false
  private syncing: Promise<void> = Promise.resolve()
  /** The last run() found the runtime and the model downloaded. */
  private filesReady = false
  error = ''
  model: CwModel = 'narrow'
  pitchHz = PITCH_DEFAULT
  widthHz: number | undefined
  deviceId = ''
  /** Final words, oldest first. */
  words: string[] = []
  /** The not-yet-final tail. */
  pending = ''
  /** Peak of the input in dBFS, refreshed a few times a second while on. */
  level = -Infinity
  private levelAt = 0

  constructor(private readonly platform: KQSOPlatform) {
    this.client.onText = (committed, pending) => {
      if (committed) this.words = [...this.words, ...committed.split(' ')].slice(-KEEP_WORDS)
      this.pending = pending
      this.notify()
    }
    this.client.onError = (error) => this.fail(error)
  }

  /** Reads the settings; listening starts when a log in CW makes it active. */
  async init(): Promise<void> {
    if (!this.available) return
    const get = (k: string) => this.platform.getSetting(k)
    this.model = (await get(CW_SETTINGS.model)) === 'wide' ? 'wide' : 'narrow'
    this.pitchHz = clampPitch(Number(await get(CW_SETTINGS.pitch)) || PITCH_DEFAULT)
    this.widthHz = Number(await get(CW_SETTINGS.width)) || undefined
    this.deviceId = (await get(CW_SETTINGS.device)) ?? ''
    this.enabled = switchOn(await get(CW_SETTINGS.on), false)
    // Turned on: cache the worker and the runtime's JS for an offline log later.
    if (this.enabled) void this.client.warm().catch(() => {})
    this.notify()
    this.sync()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  get tuning(): CwTuning {
    return { model: this.model, pitchHz: this.pitchHz, ...(this.model === 'wide' && this.widthHz ? { widthHz: this.widthHz } : {}) }
  }

  status(): Promise<CwStatus> {
    return this.client.status()
  }

  /** The runtime and the chosen model are downloaded. */
  async ready(): Promise<boolean> {
    const s = await this.status()
    return s.ort.stored && s[this.model].stored
  }

  download(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    return this.client.download(this.model, onProgress)
  }

  async remove(): Promise<void> {
    await this.setEnabled(false)
    await this.syncing
    await this.client.remove()
  }

  inputs(): Promise<{ inputs: AudioInput[]; locked: boolean }> {
    return audioInputs()
  }

  unlockInputs(): Promise<void> {
    return unlockInputs()
  }

  /** Settings and Alt+U: on = listen whenever a log is open in CW. */
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on
    if (on) void this.client.warm().catch(() => {})
    if (on) this.error = ''
    await this.platform.setSetting(CW_SETTINGS.on, on ? '1' : '0')
    this.notify()
    this.sync()
  }

  toggle(): Promise<void> {
    return this.setEnabled(!this.enabled)
  }

  /** The logging screen: a log is open and its mode is CW. */
  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    this.sync()
  }

  /** Bring the input and the worker in line with enabled && active, one change at a time. */
  private sync(): void {
    this.syncing = this.syncing.then(async () => {
      const want = this.available && this.enabled && this.active
      if (want && this.state === 'off') await this.run()
      else if (!want && this.state !== 'off') await this.halt()
    })
  }

  private async run(): Promise<void> {
    this.filesReady = await this.ready().catch(() => false)
    if (!this.filesReady) {
      this.fail(t('cw.needDownload'))
      return
    }
    // The share dialog opens only from a click: the log shows a button for it.
    if (this.deviceId === TAB_SOURCE) {
      this.state = 'tab'
      this.notify()
      return
    }
    this.state = 'starting'
    this.error = ''
    this.notify()
    try {
      await this.client.start(this.tuning)
      await this.listen()
      this.state = 'on'
    } catch (err) {
      await this.client.stop().catch(() => {})
      this.capture.stop()
      this.fail(micError(err))
      return
    }
    this.notify()
  }

  /** The log offers "Pick the tab": waiting for it, or after a failed pick (no sound,
   *  sharing stopped) — not when the model is missing, that needs Settings first. */
  get canPickTab(): boolean {
    return this.deviceId === TAB_SOURCE && (this.state === 'tab' || (this.state === 'error' && this.filesReady))
  }

  /** The click on "Pick the tab": the browser's share dialog opens right from it. */
  async pickTab(): Promise<void> {
    if (!this.canPickTab) return
    this.state = 'starting'
    this.error = ''
    this.notify()
    try {
      await this.listen() // first, while the click still counts
      await this.client.start(this.tuning)
      this.state = 'on'
    } catch (err) {
      this.capture.stop()
      await this.client.stop().catch(() => {})
      // Cancelled in the dialog: back to the button.
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.state = 'tab'
        this.notify()
      } else this.fail(micError(err))
      return
    }
    this.notify()
  }

  private listen(): Promise<void> {
    return this.capture.start(
      this.deviceId,
      (block) => this.client.audio(block),
      (db) => this.onLevel(db),
      () => {
        // A tab whose sharing was stopped: offer the button again; a lost device: say so.
        if (this.deviceId === TAB_SOURCE) {
          void this.client.stop().catch(() => {})
          this.state = 'tab'
          this.level = -Infinity
          this.notify()
        } else this.fail(t('cw.inputEnded'))
      },
    )
  }

  private async halt(): Promise<void> {
    this.capture.stop()
    await this.client.stop().catch(() => {})
    this.state = 'off'
    this.pending = ''
    this.level = -Infinity
    this.notify()
  }

  clear(): void {
    this.words = []
    this.pending = ''
    this.notify()
  }

  async setModel(model: CwModel): Promise<void> {
    this.model = model
    await this.platform.setSetting(CW_SETTINGS.model, model)
    await this.retune()
  }

  async setPitch(hz: number): Promise<void> {
    this.pitchHz = clampPitch(hz)
    await this.platform.setSetting(CW_SETTINGS.pitch, String(this.pitchHz))
    await this.retune()
  }

  async setWidth(hz: number | undefined): Promise<void> {
    this.widthHz = hz && hz > 0 ? Math.round(hz) : undefined
    await this.platform.setSetting(CW_SETTINGS.width, this.widthHz ? String(this.widthHz) : '')
    await this.retune()
  }

  async setDevice(deviceId: string): Promise<void> {
    this.deviceId = deviceId
    await this.platform.setSetting(CW_SETTINGS.device, deviceId)
    if (this.state === 'on') {
      this.syncing = this.syncing.then(() => this.halt())
      this.sync()
    }
  }

  private async retune(): Promise<void> {
    if (this.state !== 'on') {
      this.notify()
      return
    }
    // A model that isn't downloaded can't run: stop and say so.
    this.filesReady = await this.ready()
    if (!this.filesReady) {
      await this.halt()
      this.fail(t('cw.needDownload'))
      return
    }
    // start() again: loads another model's session if needed, restarts the audio buffer.
    await this.client.start(this.tuning).catch((err: unknown) => this.fail(err instanceof Error ? err.message : String(err)))
    this.pending = ''
    this.notify()
  }

  private onLevel(db: number): void {
    const now = Date.now()
    if (now - this.levelAt < LEVEL_EVERY_MS) return
    this.levelAt = now
    this.level = db
    this.notify()
  }

  private fail(error: string): void {
    this.capture.stop()
    this.state = 'error'
    this.error = error
    this.level = -Infinity
    this.notify()
  }
}

function clampPitch(hz: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(hz)))
}

function micError(err: unknown): string {
  if (err instanceof NoTabAudioError) return t('cw.noTabAudio')
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('cw.noMic')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('cw.noInput')
  return err instanceof Error ? err.message : String(err)
}
