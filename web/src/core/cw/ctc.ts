// CW decoder: greedy CTC decoding of the DeepCW model output into text, with the frame
// spans the streaming part needs to cut on word gaps. Ported from DeepCW
// (github.com/e04/web-deep-cw-decoder @ f3bea57: src/utils/textDecoder.ts, src/const.ts),
// English only. Copyright (c) 2026 e04, MIT License, see LICENSE-DeepCW.txt.

/** The English models' classes (model.onnx.json `chars`); the last one is the CTC blank. */
export const VOCABULARY: readonly string[] = [
  ',', '.', '/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '?',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
  'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', ' ',
]
export const BLANK_INDEX = 41

export interface FrameSpan {
  startFrame: number
  endFrame: number
}

export interface CharSpan extends FrameSpan {
  char: string
}

export interface CtcResult {
  text: string
  /** Runs of the space class: where the model hears a word gap. */
  wordGaps: FrameSpan[]
  /** One per character of `text`, in output frames. */
  chars: CharSpan[]
}

/** Arg-max class per output frame of a [1, time, class] tensor. */
export function bestPath(logProbs: ArrayLike<number>, timeSteps: number, classes: number): number[] {
  const out: number[] = []
  for (let t = 0; t < timeSteps; t++) {
    const offset = t * classes
    let best = 0
    let bestValue = -Infinity
    for (let c = 0; c < classes; c++) {
      const v = logProbs[offset + c]!
      if (v > bestValue) {
        bestValue = v
        best = c
      }
    }
    out.push(best)
  }
  return out
}

/** Collapse repeats, drop blanks; keep each character's frame span and the word gaps. */
export function decodeCtc(path: readonly number[]): CtcResult {
  const spaceIndex = VOCABULARY.indexOf(' ')
  const chars: CharSpan[] = []
  const wordGaps: FrameSpan[] = []
  let previous: number | undefined
  let active: CharSpan | undefined
  let gapStart = -1

  path.forEach((index, frame) => {
    if (index === spaceIndex) {
      if (gapStart < 0) gapStart = frame
    } else if (gapStart >= 0) {
      wordGaps.push({ startFrame: gapStart, endFrame: frame - 1 })
      gapStart = -1
    }

    if (index === BLANK_INDEX) {
      previous = undefined
      active = undefined
      return
    }
    if (index === previous) {
      if (active) active.endFrame = frame
      return
    }
    previous = index
    const char = VOCABULARY[index] ?? ''
    if (!char) {
      active = undefined
      return
    }
    active = { char, startFrame: frame, endFrame: frame }
    chars.push(active)
  })
  if (gapStart >= 0) wordGaps.push({ startFrame: gapStart, endFrame: path.length - 1 })

  return { text: chars.map((c) => c.char).join(''), wordGaps, chars }
}
