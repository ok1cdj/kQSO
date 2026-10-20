// The VHF contest category picker, shared by New log and the EDI export: who operates
// (SO / MO / CHECK), which contest (national, IARU R1, VKV Provozní aktiv, FM pohár) and
// in an IARU one the variant (full power, LP, 6 hours). The scoring, PSect and the file
// name per band follow from it (core/contest.ts, core/edi.ts). FM pohár has no SO / MO —
// its categories are QRP / QRO by the power.

import type { ContestCategory, ContestKind } from '../core/index'
import { el, tilePicker } from './dom'
import { t } from './i18n'

export interface CategoryPicker {
  readonly rows: readonly HTMLElement[]
  value(): ContestCategory
}

export function categoryPicker(initial: ContestCategory, onChange?: (c: ContestCategory) => void): CategoryPicker {
  const changed = (): void => {
    sync()
    onChange?.(value())
  }
  const ops = tilePicker(
    t('cat.ops'),
    [
      { value: 'SO', title: 'SO', sub: t('cat.so') },
      { value: 'MO', title: 'MO', sub: t('cat.mo') },
      { value: 'CHECK', title: 'CHECK', sub: t('cat.check') },
    ],
    initial.ops,
    changed,
  )
  const kind = tilePicker(
    t('cat.contest'),
    [
      { value: 'national', title: t('cat.national') },
      { value: 'iaru', title: 'IARU R1' },
      { value: 'pa', title: t('cat.pa'), sub: t('cat.paSub') },
      { value: 'fm', title: t('cat.fm'), sub: t('cat.fmSub') },
    ],
    initial.contest,
    changed,
  )
  const variant = tilePicker(
    t('cat.variant'),
    [
      { value: 'full', title: t('cat.full') },
      { value: 'lp', title: 'LP', sub: '≤ 100 W' },
      { value: '6h', title: t('cat.sixH') },
    ],
    initial.variant,
    changed,
  )
  const hint = el('p', 'about')

  const value = (): ContestCategory => {
    const contest = kind.value() as ContestKind
    const o = contest === 'fm' ? 'SO' : (ops.value() as ContestCategory['ops'])
    return { ops: o, contest, variant: contest === 'iaru' && o !== 'CHECK' ? (variant.value() as ContestCategory['variant']) : 'full' }
  }
  const HINT = { national: 'cat.hintNational', iaru: 'cat.hintIaru', pa: 'cat.hintPa', fm: 'cat.hintFm' } as const
  const sync = (): void => {
    const c = value()
    ops.row.hidden = c.contest === 'fm'
    variant.row.hidden = c.contest !== 'iaru' || c.ops === 'CHECK'
    hint.textContent = c.ops === 'CHECK' ? '' : t(HINT[c.contest])
  }
  sync()
  return { rows: [kind.row, ops.row, variant.row, hint], value }
}
