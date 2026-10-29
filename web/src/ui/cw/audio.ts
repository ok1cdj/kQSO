// CW decoder audio: the rig's USB sound card (or a line input) as mono 9600 Hz blocks,
// or another browser tab's sound (a WebSDR / KiwiSDR) through screen sharing.
// In Chrome the AudioContext runs at 9600 Hz, so the browser resamples; WebKit (the iOS
// app) records at the device rate and Resampler brings it down. No echo cancellation,
// noise suppression or AGC, which would eat a weak CW tone. A ScriptProcessorNode is
// enough for 2048-sample blocks (~0.2 s) and needs no separate worklet module.

import { SAMPLE_RATE } from '../../core/cw/dsp'
import { Resampler } from '../../core/cw/resample'

const BLOCK = 2048
/** At the device rate (44.1 / 48 kHz): about the same 0.2 s as BLOCK at 9600 Hz. */
const NATIVE_BLOCK = 8192

/** The input "another tab": picked in the browser's share dialog, only on a click. */
export const TAB_SOURCE = 'tab'

/** Chrome / Edge on a computer share a tab's sound; Firefox, Safari and phones don't. */
export function tabAudioAvailable(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function' && /Chrome\//.test(navigator.userAgent) && !/Mobile|Android/.test(navigator.userAgent)
}

/** The shared tab came without sound ("Share tab audio" was off). */
export class NoTabAudioError extends Error {}

export interface AudioInput {
  deviceId: string
  label: string
}

/** Recording devices. Without the microphone permission the browser hides them (no id,
 *  no name): then `locked` and an empty list, see unlockInputs. */
export async function audioInputs(): Promise<{ inputs: AudioInput[]; locked: boolean }> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  const locked = devices.some((d) => !d.deviceId || !d.label)
  const inputs = devices
    .filter((d) => d.deviceId && d.deviceId !== 'default')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }))
  return { inputs, locked }
}

/** Ask for the microphone permission once (and let go at once), so the inputs show. */
export async function unlockInputs(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach((t) => t.stop())
}

export class CwCapture {
  private stream: MediaStream | undefined
  private context: AudioContext | undefined
  private node: ScriptProcessorNode | undefined

  /** Starts recording from `deviceId` ('' = the default input, TAB_SOURCE = a tab the user
   *  picks; that one must run from a click). `onBlock` gets each block (its own buffer, free
   *  to transfer), `onLevel` the block's peak in dBFS, `onEnded` a stop from outside (the
   *  tab's sharing stopped, the device unplugged). */
  async start(
    deviceId: string,
    onBlock: (samples: Float32Array) => void,
    onLevel?: (dbfs: number) => void,
    onEnded?: () => void,
  ): Promise<void> {
    this.stop()
    const stream = deviceId === TAB_SOURCE ? await tabStream() : await deviceStream(deviceId)
    const audio = stream.getAudioTracks()[0]
    audio?.addEventListener('ended', () => {
      if (this.stream === stream) {
        this.stop()
        onEnded?.()
      }
    })
    // Kept from here on, so stop() releases them if a step below throws.
    this.stream = stream
    // Chrome connects a 48 kHz input to a 9600 Hz context; WebKit and Firefox don't (no
    // sound, or an error), so there the context keeps the device rate.
    const own = !/Chrome\//.test(navigator.userAgent)
    const context = own ? new AudioContext() : new AudioContext({ sampleRate: SAMPLE_RATE })
    this.context = context
    const resampler = context.sampleRate !== SAMPLE_RATE ? new Resampler(context.sampleRate, SAMPLE_RATE) : undefined
    const node = context.createScriptProcessor(resampler ? NATIVE_BLOCK : BLOCK, 1, 1)
    this.node = node
    node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)
      const block = resampler ? resampler.process(input) : input.slice()
      if (block.length === 0) return
      if (onLevel) {
        let peak = 0
        for (const v of block) peak = Math.max(peak, Math.abs(v))
        onLevel(peak > 0 ? 20 * Math.log10(peak) : -Infinity)
      }
      onBlock(block)
    }
    try {
      context.createMediaStreamSource(stream).connect(node)
      // The node only runs while connected to the output; it writes silence there.
      node.connect(context.destination)
      // WebKit may create it suspended outside a tap; recording lets it run.
      if (context.state === 'suspended') void context.resume()
    } catch (err) {
      this.stop()
      throw err
    }
  }

  stop(): void {
    this.node?.disconnect()
    this.node = undefined
    void this.context?.close()
    this.context = undefined
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
  }

  get running(): boolean {
    return this.stream !== undefined
  }
}

function deviceStream(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })
}

/** A tab's sound through the share dialog. Chrome wants video in the request; the video
 *  track is dropped right away. The tab keeps playing, so you still hear the SDR. */
async function tabStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Chrome's hints: offer tabs first, not this one, no system audio.
    ...({ preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'exclude' } as object),
  })
  for (const v of stream.getVideoTracks()) {
    v.stop()
    stream.removeTrack(v)
  }
  if (stream.getAudioTracks().length === 0) throw new NoTabAudioError()
  return stream
}
