// Wavelog push — the pure part: URL normalization, error mapping
// and the per-log push status. The network call lives in ui/wavelog.ts. API v2:
// POST <base>/qso {import_type:"adif", station_profile_id, adif}, Bearer wl2_ token.
// Explicit, user-configured and manually triggered — never automatic.

/** Why a Wavelog call failed, mapped to a UI message. */
export type WavelogErrorKind =
  | 'badUrl' // not an https:// URL (http is blocked as mixed content)
  | 'unreachable' // network error / timeout — e.g. no signal on the summit
  | 'unauthorized' // unknown, revoked or not a wl2_ token
  | 'expired'
  | 'scope' // token lacks qso:write / station:read
  | 'rejected' // 4xx validation — server message attached
  | 'server' // anything else

export class WavelogError extends Error {
  constructor(
    readonly kind: WavelogErrorKind,
    message: string = kind,
  ) {
    super(message)
  }
}

/**
 * Accept what a user pastes — `https://log.example.org`, `…/index.php`,
 * `…/index.php/api/v2` (trailing slashes fine) — and return the v2 API base.
 * Only https (a PWA on https can't call http), except localhost for testing.
 */
export function apiBase(input: string): string {
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(input.trim())
  if (!m) throw new WavelogError('badUrl')
  const scheme = m[1]!.toLowerCase()
  const host = m[2]!.toLowerCase()
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  if (scheme !== 'https' && !local) throw new WavelogError('badUrl')
  let path = m[3]!.replace(/\/+$/, '')
  path = path.replace(/\/api\/v2$/i, '').replace(/\/api$/i, '')
  if (!path.endsWith('/index.php')) path += '/index.php'
  return `${scheme}://${host}${path}/api/v2`
}

/** Map an HTTP status + v2 error envelope to a WavelogError. */
export function errorFor(status: number, body: unknown): WavelogError {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error
  const code = err?.code
  if (code === 'token_expired') return new WavelogError('expired')
  if (status === 401 || code === 'invalid_token' || code === 'unauthorized') return new WavelogError('unauthorized')
  if (code === 'insufficient_scope') return new WavelogError('scope', err?.message)
  if (status >= 400 && status < 500) return new WavelogError('rejected', err?.message ?? `HTTP ${status}`)
  return new WavelogError('server', err?.message ?? `HTTP ${status}`)
}

/** A Wavelog station profile (location) the log is pushed into. */
export interface WavelogStation {
  readonly id: number
  readonly name: string
  readonly callsign: string
}

export function parseStations(body: unknown): WavelogStation[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data
    .filter((s): s is { id: number; name?: string; callsign?: string } => typeof (s as { id?: unknown }).id === 'number')
    .map((s) => ({ id: s.id, name: s.name ?? String(s.id), callsign: s.callsign ?? '' }))
}

/** The last push of one log, shown in the log list. */
export interface PushStatus {
  readonly at: string // ISO time of the attempt
  readonly ok: boolean
  readonly imported?: number
  readonly skipped?: number // duplicates Wavelog already had
  readonly error?: WavelogErrorKind
}

export function parseImport(body: unknown): { imported: number; skipped: number } {
  const d = (body as { data?: { imported?: unknown; skipped?: unknown } } | null)?.data
  return { imported: Number(d?.imported) || 0, skipped: Number(d?.skipped) || 0 }
}

/** Settings key holding a log's PushStatus (JSON). */
export const pushStatusKey = (logId: string): string => `wavelog:${logId}`

export function readPushStatus(json: string | null): PushStatus | null {
  if (!json) return null
  try {
    const s = JSON.parse(json) as PushStatus
    return typeof s.at === 'string' && typeof s.ok === 'boolean' ? s : null
  } catch {
    return null
  }
}

/** App-wide Wavelog settings keys (not per log). */
export const WAVELOG_SETTINGS = {
  url: 'wavelogUrl',
  token: 'wavelogToken',
  station: 'wavelogStation', // JSON WavelogStation
} as const
