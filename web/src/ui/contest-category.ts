// The VHF contest category picker, shared by New log and the EDI export: who operates
// (SO / MO / CHECK), IARU R1 contest or national, and in an IARU one the variant (full
// power, LP, 6 hours). PSect and the file name per band follow from it (core/edi.ts).

import type { ContestCategory } from '../core/index'
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
    ],
    initial.iaru ? 'iaru' : 'national',
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
    const iaru = kind.value() === 'iaru'
    const o = ops.value() as ContestCategory['ops']
    return { ops: o, iaru, variant: iaru && o !== 'CHECK' ? (variant.value() as ContestCategory['variant']) : 'full' }
  }
  const sync = (): void => {
    const c = value()
    variant.row.hidden = !c.iaru || c.ops === 'CHECK'
    hint.textContent = c.ops === 'CHECK' ? '' : c.iaru ? t('cat.hintIaru') : t('cat.hintNational')
  }
  sync()
  return { rows: [ops.row, kind.row, variant.row, hint], value }
}
