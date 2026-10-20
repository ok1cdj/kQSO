// The VHF contest category picker, shared by New log and the EDI export: which contest
// (IARU R1, VKV Provozní aktiv, FM pohár), in an IARU one whether it is a 6-hour entry,
// and at the export who operates (SO / MO / CHECK). New log asks only what changes the
// logging (scoring, the 6-hour clock); the rest belongs to the export. LP / QRP is never
// chosen — it follows the power per band (core/edi.ts). FM pohár has no SO / MO — its
// categories are QRP / QRO by the power.

import type { ContestCategory, ContestKind } from '../core/index'
import { el, tilePicker } from './dom'
import { t } from './i18n'

export interface CategoryPicker {
  readonly rows: readonly HTMLElement[]
  value(): ContestCategory
}

/** `withOps`: show SO / MO / CHECK (the export); otherwise `initial.ops` is kept as is. */
export function categoryPicker(initial: ContestCategory, withOps: boolean, onChange?: (c: ContestCategory) => void): CategoryPicker {
  const changed = (): void => {
    sync()
    onChange?.(value())
  }
  const kind = tilePicker(
    t('cat.contest'),
    [
      { value: 'iaru', title: 'IARU R1', sub: t('cat.iaruSub') },
      { value: 'pa', title: t('cat.pa'), sub: t('cat.paSub') },
      { value: 'fm', title: t('cat.fm'), sub: t('cat.fmSub') },
    ],
    initial.contest,
    changed,
  )
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
  const variant = tilePicker(
    t('cat.variant'),
    [
      { value: 'full', title: t('cat.full') },
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
  const HINT = { iaru: 'cat.hintIaru', pa: 'cat.hintPa', fm: 'cat.hintFm' } as const
  const sync = (): void => {
    const c = value()
    ops.row.hidden = !withOps || c.contest === 'fm'
    variant.row.hidden = c.contest !== 'iaru' || c.ops === 'CHECK'
    hint.textContent = c.ops === 'CHECK' ? '' : t(HINT[c.contest])
  }
  sync()
  return { rows: [kind.row, variant.row, ops.row, hint], value }
}
