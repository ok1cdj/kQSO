// Callsign database. Powers strip suggestions and locator
// prefill. NOT derived from the logs — logs are "log, export, delete", so the
// database is its own persistent entity in two layers that never merge into one
// table:
//   base — a bundled, read-only TSV set picked by the log profile (vkv/sat/awards)
//   live — written on every QSO commit, stored via the platform, exported/imported
// Pure, zero DOM: the UI loads the texts and stores the live layer.

import type { SuggestionSource } from './suggest'

/** One callsign. `last` is YYYYMMDD of the latest sighting (missing = oldest).
 *  `qrv`: the band letters it's been heard on (as in Tučňák's C_W file, e.g. 'CEG'). */
export interface Entry {
  readonly call: string
  readonly loc?: string
  readonly last?: string
  readonly count: number
  readonly qrv?: string
}

/** Tučňák's band letters (its bandchar) ↔ our band keys, and the short label the
 *  QRV chip shows: the bare number (6m keeps its m, 6 is 6cm); from 24 GHz up the GHz,
 *  nobody remembers the mm. HF has no letter. */
const BAND_LETTERS: Readonly<Record<string, readonly [band: string, short: string]>> = {
  A: ['6m', '6m'],
  B: ['4m', '4'],
  C: ['2m', '2'],
  E: ['70cm', '70'],
  G: ['23cm', '23'],
  H: ['13cm', '13'],
  I: ['9cm', '9'],
  J: ['6cm', '6'],
  K: ['3cm', '3'],
  L: ['1.25cm', '24G'],
  M: ['6mm', '47G'],
  N: ['4mm', '76G'],
  O: ['2.5mm', '122G'],
  P: ['2mm', '134G'],
  Q: ['1mm', '248G'],
}

/** The letter for a band ('23cm' → 'G'), or undefined (HF, unknown). */
export function bandLetter(band: string): string | undefined {
  return Object.keys(BAND_LETTERS).find((l) => BAND_LETTERS[l]?.[0] === band)
}

/** The bands of a QRV string ('CEG' → ['2m', '70cm', '23cm']); unknown letters are skipped. */
export function qrvBands(qrv: string | undefined): string[] {
  return [...(qrv ?? '')].flatMap((l) => BAND_LETTERS[l]?.[0] ?? [])
}

/** The QRV chip's bands with their labels ('CG' → 2m '2', 23cm '23'), without the band given. */
export function qrvLabels(qrv: string | undefined, except?: string): { band: string; label: string }[] {
  return [...(qrv ?? '')].flatMap((l) => {
    const b = BAND_LETTERS[l]
    return b && b[0] !== except ? [{ band: b[0], label: b[1] }] : []
  })
}

/** Both QRV strings' letters, sorted, once each; undefined when none. */
export function unionQrv(a: string | undefined, b: string | undefined): string | undefined {
  const u = [...new Set((a ?? '') + (b ?? ''))].sort().join('')
  return u || undefined
}

export interface ParsedDb {
  /** `k=v` pairs from the `# kQSO callsign DB | set=… | version=…` line. */
  readonly header: Readonly<Record<string, string>>
  readonly entries: readonly Entry[]
}

/** The live layer is capped; beyond this the oldest (by `last`) are dropped. */
export const LIVE_MAX = 20_000

/**
 * Parse a DB TSV (UTF-8, LF). `#` lines are the header/comments. Tolerant to 1–5
 * columns: CALL [LOC [LAST [COUNT [QRV]]]]; an empty field counts as missing.
 */
export function parseDb(text: string): ParsedDb {
  const header: Record<string, string> = {}
  const entries: Entry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('#')) {
      for (const part of line.slice(1).split('|')) {
        const eq = part.indexOf('=')
        if (eq > 0) header[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
      }
      continue
    }
    const [call, loc, last, count, qrv] = line.split('\t').map((f) => f.trim())
    if (!call) continue
    const e: { -readonly [K in keyof Entry]: Entry[K] } = { call: call.toUpperCase(), count: Number(count) || 0 }
    if (loc) e.loc = loc.toUpperCase()
    if (last && /^\d{8}$/.test(last)) e.last = last
    const q = unionQrv(qrv?.toUpperCase().replace(/[^A-Z]/g, ''), undefined)
    if (q) e.qrv = q
    entries.push(e)
  }
  return { header, entries }
}

/** Serialize with four columns (a fifth, QRV, when known), sorted by call — deterministic, so a roundtrip is identical. */
export function serializeDb(entries: Iterable<Entry>, headerLine: string): string {
  const rows = [...entries]
    .sort((a, b) => (a.call < b.call ? -1 : a.call > b.call ? 1 : 0))
    .map((e) => [e.call, e.loc ?? '', e.last ?? '', String(e.count), ...(e.qrv ? [e.qrv] : [])].join('\t'))
  return [headerLine, ...rows].join('\n') + '\n'
}

/** Missing `last` sorts as the oldest possible date. */
const newer = (a: string | undefined, b: string | undefined): boolean => (a ?? '') > (b ?? '')

/**
 * Import rule: the newer `last` wins loc/last; a tie or missing date keeps the
 * existing record. Counts add up (each side holds its own history), QRV bands join.
 */
export function mergeEntry(existing: Entry, incoming: Entry): Entry {
  const win = newer(incoming.last, existing.last) ? incoming : existing
  const e: { -readonly [K in keyof Entry]: Entry[K] } = { call: existing.call, count: existing.count + incoming.count }
  const loc = win.loc ?? (win === incoming ? existing.loc : incoming.loc)
  if (loc !== undefined) e.loc = loc
  if (win.last !== undefined) e.last = win.last
  const qrv = unionQrv(existing.qrv, incoming.qrv)
  if (qrv) e.qrv = qrv
  return e
}

/** The writable layer: one map keyed by call, persisted as one TSV via the platform. */
export class LiveDb {
  private readonly map = new Map<string, Entry>()

  static fromText(text: string): LiveDb {
    const db = new LiveDb()
    for (const e of parseDb(text).entries) db.put(e)
    return db
  }

  get size(): number {
    return this.map.size
  }

  get(call: string): Entry | undefined {
    return this.map.get(call.toUpperCase())
  }

  entries(): IterableIterator<Entry> {
    return this.map.values()
  }

  /** A committed QSO: count+1, latest date, its band joins QRV; the locator updates unless this sighting is older. */
  record(call: string, loc: string | undefined, date: string, band?: string): void {
    const c = call.toUpperCase()
    const prev = this.map.get(c)
    const e: { -readonly [K in keyof Entry]: Entry[K] } = { call: c, count: (prev?.count ?? 0) + 1 }
    const isNewest = !newer(prev?.last, date)
    const l = isNewest ? (loc ?? prev?.loc) : (prev?.loc ?? loc)
    if (l !== undefined) e.loc = l
    e.last = isNewest ? date : prev!.last!
    const qrv = unionQrv(prev?.qrv, band ? bandLetter(band) : undefined)
    if (qrv) e.qrv = qrv
    this.map.set(c, e)
    this.cap()
  }

  /** Merge a TSV (1–4 columns) into this layer — never replaces. Returns rows read. */
  importText(text: string): number {
    const { entries } = parseDb(text)
    for (const e of entries) this.put(e)
    this.cap()
    return entries.length
  }

  toText(headerLine: string): string {
    return serializeDb(this.map.values(), headerLine)
  }

  clear(): void {
    this.map.clear()
  }

  private put(e: Entry): void {
    const prev = this.map.get(e.call)
    this.map.set(e.call, prev ? mergeEntry(prev, e) : e)
  }

  private cap(): void {
    if (this.map.size <= LIVE_MAX) return
    const oldest = [...this.map.values()].sort((a, b) => ((a.last ?? '') < (b.last ?? '') ? -1 : 1))
    for (const e of oldest.slice(0, this.map.size - LIVE_MAX)) this.map.delete(e.call)
  }
}

/** Read-only base layer from a bundled set. */
export function baseSource(entries: readonly Entry[]): Map<string, Entry> {
  const m = new Map<string, Entry>()
  for (const e of entries) m.set(e.call, m.has(e.call) ? mergeEntry(m.get(e.call)!, e) : e)
  return m
}

/**
 * The one source the UI queries. `lookup`: live first, locator falls back to the
 * base, QRV bands from both. `search`: substring match over both, deduped by call, ordered by own count,
 * then base count, prefix before substring, then alphabetically.
 */
export function combineSources(base: ReadonlyMap<string, Entry> | null, live: LiveDb): SuggestionSource {
  return {
    lookup(call) {
      const c = call.toUpperCase()
      const l = live.get(c)
      const b = base?.get(c)
      if (!l || !b) return l ?? b
      const qrv = unionQrv(l.qrv, b.qrv)
      return { ...l, ...(l.loc === undefined && b.loc !== undefined ? { loc: b.loc } : {}), ...(qrv ? { qrv } : {}) }
    },
    search(fragment, limit) {
      const f = fragment.toUpperCase()
      if (f.length < 2) return []
      const hits = new Map<string, { e: Entry; own: number; bundled: number }>()
      const scan = (entries: Iterable<Entry>, own: boolean): void => {
        for (const e of entries) {
          if (e.call === f || !e.call.includes(f)) continue
          const h = hits.get(e.call) ?? { e, own: 0, bundled: 0 }
          if (own) {
            h.e = e
            h.own = e.count
          } else h.bundled = e.count
          hits.set(e.call, h)
        }
      }
      if (base) scan(base.values(), false)
      scan(live.entries(), true)
      return [...hits.values()]
        .sort(
          (a, b) =>
            b.own - a.own ||
            b.bundled - a.bundled ||
            Number(b.e.call.startsWith(f)) - Number(a.e.call.startsWith(f)) ||
            (a.e.call < b.e.call ? -1 : 1),
        )
        .slice(0, limit)
        .map((h) => h.e)
    },
    byLocator(loc, limit) {
      const l = loc.toUpperCase()
      // A call's locator is the live one when known (it moves), else the bundled one.
      const hits = new Map<string, { e: Entry; own: number; bundled: number }>()
      for (const e of live.entries()) hits.set(e.call, { e, own: e.count, bundled: 0 })
      if (base)
        for (const e of base.values()) {
          const h = hits.get(e.call)
          if (h) {
            h.bundled = e.count
            if (h.e.loc === undefined && e.loc !== undefined) h.e = { ...h.e, loc: e.loc }
          } else hits.set(e.call, { e, own: 0, bundled: e.count })
        }
      return [...hits.values()]
        .filter((h) => h.e.loc?.toUpperCase() === l)
        .sort((a, b) => b.own - a.own || b.bundled - a.bundled || (a.e.call < b.e.call ? -1 : 1))
        .slice(0, limit)
        .map((h) => h.e)
    },
  }
}

/** YYYYMMDD (UTC) — the `last` date stamped on a committed QSO. */
export function dbDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

/** Header line for the exported live layer. */
export function userHeader(exported: Date): string {
  return `# kQSO callsign DB | set=user | exported=${dbDate(exported)}`
}
