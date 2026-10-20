// Band filter buttons of a multi-band log, shared by the QSO list and the map:
// All | 2m | 70cm … — which band is shown comes from band-choice.ts.

import type { Qso } from '../core/index'
import { ALL_BANDS, chooseBand, logBands, shownBand } from './band-choice'
import { button, el } from './dom'
import { t } from './i18n'

export { ALL_BANDS, shownBand } from './band-choice'

/** The All | 2m | 70cm … buttons (nothing for a one-band log); a tap remembers the band. */
export function bandFilter(logId: string, qsos: readonly Qso[], onChange: (band: string) => void): HTMLElement | undefined {
  const bands = logBands(qsos)
  if (bands.length < 2) return undefined
  const row = el('div', 'segmented segmented--wrap band-filter')
  const paint = (): void => {
    const current = shownBand(logId, qsos)
    for (const b of Array.from(row.querySelectorAll<HTMLButtonElement>('button'))) {
      b.setAttribute('aria-pressed', String(b.dataset.band === current))
    }
  }
  for (const band of [ALL_BANDS, ...bands]) {
    const b = button(band === ALL_BANDS ? t('band.all') : band, () => {
      chooseBand(logId, band)
      paint()
      onChange(band)
    }, 'btn btn--small')
    b.dataset.band = band
    row.append(b)
  }
  paint()
  return row
}
