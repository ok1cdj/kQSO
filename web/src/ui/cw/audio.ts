// CW decoder audio: the rig's USB sound card (or a line input) as mono 9600 Hz blocks,
// or another browser tab's sound (a WebSDR / KiwiSDR) through screen sharing.
// The AudioContext runs at 9600 Hz, so the browser resamples; no echo cancellation,
// noise suppression or AGC, which would eat a weak CW tone. A ScriptProcessorNode is
// enough for 2048-sample blocks (~0.2 s) and needs no separate worklet module.

import { SAMPLE_RATE } from '../../core/cw/dsp'

const BLOCK = 2048

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
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    this.context = context
    const node = context.createScriptProcessor(BLOCK, 1, 1)
    this.node = node
    node.onaudioprocess = (e) => {
      const block = e.inputBuffer.getChannelData(0).slice()
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
