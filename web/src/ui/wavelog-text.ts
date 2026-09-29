// User-facing text for Wavelog push errors and status.

import { WavelogError } from '../core/index'
import type { PushStatus, WavelogErrorKind } from '../core/index'
import { t } from './i18n'

const KEY = {
  badUrl: 'wl.err.badUrl',
  unreachable: 'wl.err.unreachable',
  unauthorized: 'wl.err.unauthorized',
  expired: 'wl.err.expired',
  scope: 'wl.err.scope',
  rejected: 'wl.err.rejected',
  server: 'wl.err.server',
} as const satisfies Record<WavelogErrorKind, string>

// Short reasons for the one-line status in the log list.
const WHY = {
  badUrl: 'wl.why.badUrl',
  unreachable: 'wl.why.unreachable',
  unauthorized: 'wl.why.token',
  expired: 'wl.why.token',
  scope: 'wl.why.token',
  rejected: 'wl.why.rejected',
  server: 'wl.why.server',
} as const satisfies Record<WavelogErrorKind, string>

export function wavelogErrorText(e: unknown): string {
  if (!(e instanceof WavelogError)) return t(KEY.server, { msg: String(e) })
  return t(KEY[e.kind], { msg: e.message })
}

const stamp = (iso: string): string => {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** One line under the log name, e.g. "Wavelog: 12 new, 3 dupes · 24.09. 14:05". */
export function pushStatusText(s: PushStatus): string {
  const body = s.ok
    ? t('wl.pushed', { imported: s.imported ?? 0, skipped: s.skipped ?? 0 })
    : t('wl.failed', { why: t(WHY[s.error ?? 'server']) })
  return `${body} · ${stamp(s.at)}`
}
