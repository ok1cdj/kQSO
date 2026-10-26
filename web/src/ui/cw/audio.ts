// CW decoder audio: the rig's USB sound card (or a line input) as mono 9600 Hz blocks.
// The AudioContext runs at 9600 Hz, so the browser resamples; no echo cancellation,
// noise suppression or AGC, which would eat a weak CW tone. A ScriptProcessorNode is
// enough for 2048-sample blocks (~0.2 s) and needs no separate worklet module.

import { SAMPLE_RATE } from '../../core/cw/dsp'

const BLOCK = 2048

export interface AudioInput {
  deviceId: string
  label: string
}

/** Recording devices; labels only show once the permission was given. */
export async function audioInputs(): Promise<AudioInput[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }))
}

export class CwCapture {
  private stream: MediaStream | undefined
  private context: AudioContext | undefined
  private node: ScriptProcessorNode | undefined

  /** Starts recording from `deviceId` ('' = the default input). `onBlock` gets each block
   *  (its own buffer, free to transfer), `onLevel` the block's peak in dBFS. */
  async start(deviceId: string, onBlock: (samples: Float32Array) => void, onLevel?: (dbfs: number) => void): Promise<void> {
    this.stop()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    const node = context.createScriptProcessor(BLOCK, 1, 1)
    node.onaudioprocess = (e) => {
      const block = e.inputBuffer.getChannelData(0).slice()
      if (onLevel) {
        let peak = 0
        for (const v of block) peak = Math.max(peak, Math.abs(v))
        onLevel(peak > 0 ? 20 * Math.log10(peak) : -Infinity)
      }
      onBlock(block)
    }
    context.createMediaStreamSource(stream).connect(node)
    // The node only runs while connected to the output; it writes silence there.
    node.connect(context.destination)
    this.stream = stream
    this.context = context
    this.node = node
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
