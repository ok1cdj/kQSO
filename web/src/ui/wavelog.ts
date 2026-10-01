// Wavelog API v2 client — network code that only ever runs on an explicit tap
// (the others: anonymous stats, ui/stats.ts; the map radar, ui/radar.ts). CORS is handled by Wavelog v2 itself
// (Access-Control-Allow-Origin: *), for the PWA and the APK WebView alike.

import { WavelogError, errorFor, parseImport, parseStations } from '../core/index'
import type { WavelogStation } from '../core/index'

const TIMEOUT_MS = 20_000

async function call(base: string, token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${base}/${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  } catch {
    throw new WavelogError('unreachable') // offline, DNS, TLS, timeout, CORS
  } finally {
    clearTimeout(timer)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON body — status alone decides */
  }
  if (!res.ok) throw errorFor(res.status, body)
  return body
}

/** Check the token (and its scopes) and list the station profiles to push into. */
export async function connect(base: string, token: string): Promise<{ owner: string; stations: WavelogStation[] }> {
  const info = (await call(base, token, 'token')) as { data?: { owner?: string; scopes?: string[] } }
  const scopes = info.data?.scopes ?? []
  const missing = ['qso:write', 'station:read'].filter((s) => !scopes.includes(s))
  if (missing.length > 0) throw new WavelogError('scope', missing.join(', '))
  const stations = parseStations(await call(base, token, 'station'))
  return { owner: info.data?.owner ?? '', stations }
}

/** Push a whole log (its .adi text). Safe to repeat: Wavelog skips duplicates. */
export async function pushAdif(
  base: string,
  token: string,
  stationId: number,
  adif: string,
): Promise<{ imported: number; skipped: number }> {
  const body = await call(base, token, 'qso', {
    method: 'POST',
    body: JSON.stringify({ import_type: 'adif', station_profile_id: stationId, adif }),
  })
  return parseImport(body)
}
