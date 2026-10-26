// CW decoder: live transcript from a stream of audio. Audio collects in a pending
// buffer; each step decodes all of it (at most 30 s), shows the result as pending text
// and commits the part up to the last word gap that is safely behind the live edge, then
// drops that audio. Ported from DeepCW (github.com/e04/web-deep-cw-decoder @ f3bea57:
// src/hooks/useStreamingDecode.ts) without React, timers or the Japanese lane; pacing
// (one step per second) is the caller's. Copyright (c) 2026 e04, MIT License, see
// LICENSE-DeepCW.txt.

import type { CtcResult, FrameSpan } from './ctc'
import { SAMPLE_RATE, outputFrameCenterSample } from './dsp'

const MAX_SEGMENT_SAMPLES = 30 * SAMPLE_RATE
/** Don't commit a word gap this close to the live edge: the word may still be going on. */
const TAIL_GUARD_SAMPLES = 1.25 * SAMPLE_RATE
const MIN_PENDING_SAMPLES = 2 * SAMPLE_RATE
const MIN_CONFIRMED_SAMPLES = 2 * SAMPLE_RATE

/** Runs the model over mono 9600 Hz audio. */
export type CwInfer = (audio: Float32Array) => Promise<CtcResult>

export interface CwStep {
  /** Text that is final now (empty when nothing was committed this step). */
  committed: string
  /** The not-yet-final tail, replaces the previous pending text. */
  pending: string
}

interface SplitPoint {
  sample: number
  endFrame: number
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function splitSample(gap: FrameSpan): number {
  return Math.round(outputFrameCenterSample((gap.startFrame + gap.endFrame) / 2))
}

/** The last word gap that is far enough from both ends of the analysed audio. */
export function confirmedSplit(gaps: readonly FrameSpan[], analysisLength: number, allowNearEnd = false): SplitPoint | undefined {
  const maxSample = allowNearEnd ? analysisLength : Math.max(MIN_CONFIRMED_SAMPLES, analysisLength - TAIL_GUARD_SAMPLES)
  for (let i = gaps.length - 1; i >= 0; i--) {
    const gap = gaps[i]!
    const sample = splitSample(gap)
    if (sample >= MIN_CONFIRMED_SAMPLES && sample <= maxSample) return { sample, endFrame: gap.endFrame }
  }
  return undefined
}

function textUpTo(result: CtcResult, endFrame: number): string {
  return normalize(
    result.chars
      .filter((c) => c.endFrame <= endFrame)
      .map((c) => c.char)
      .join(''),
  )
}

export class CwStream {
  private buf = new Float32Array(MAX_SEGMENT_SAMPLES)
  private len = 0
  /** Bumped by reset(), so a step that was awaiting the model doesn't drop fresh audio. */
  private generation = 0

  /** Samples waiting to be committed. */
  get pendingSamples(): number {
    return this.len
  }

  push(chunk: Float32Array): void {
    if (this.len + chunk.length > this.buf.length) {
      const grown = new Float32Array(Math.max(this.buf.length * 2, this.len + chunk.length))
      grown.set(this.buf.subarray(0, this.len))
      this.buf = grown
    }
    this.buf.set(chunk, this.len)
    this.len += chunk.length
  }

  reset(): void {
    this.len = 0
    this.generation++
  }

  /** One decode pass. Undefined when there isn't enough audio yet (pending text: none). */
  async step(infer: CwInfer): Promise<CwStep | undefined> {
    if (this.len < MIN_PENDING_SAMPLES) return undefined
    const generation = this.generation
    const fullSegment = this.len >= MAX_SEGMENT_SAMPLES
    const analysisLength = Math.min(this.len, MAX_SEGMENT_SAMPLES)
    const result = await infer(this.buf.slice(0, analysisLength))
    if (generation !== this.generation) return undefined

    const split =
      confirmedSplit(result.wordGaps, analysisLength) ??
      (fullSegment ? confirmedSplit(result.wordGaps, analysisLength, true) : undefined)
    // A full 30 s without a usable word gap is committed whole.
    const confirmedLength = split?.sample ?? (fullSegment ? MAX_SEGMENT_SAMPLES : undefined)
    if (confirmedLength === undefined || confirmedLength < MIN_CONFIRMED_SAMPLES) {
      return { committed: '', pending: normalize(result.text) }
    }

    const committed = split ? textUpTo(result, split.endFrame) : normalize(result.text)
    this.drop(confirmedLength)
    // The pending preview is cleared so the committed words don't show twice until the
    // next step decodes the remaining tail.
    return { committed, pending: '' }
  }

  private drop(samples: number): void {
    const n = Math.min(samples, this.len)
    this.buf.copyWithin(0, n, this.len)
    this.len -= n
  }
}
