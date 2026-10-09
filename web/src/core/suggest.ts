// Callsign suggestion source. The strip and the locator prefill query this one
// interface, never the storage directly, so another source (e.g. a new bundled
// set) is one more implementation, not a UI change. See calldb.ts.

import type { Entry } from './calldb'

export interface SuggestionSource {
  /** Exact match — for prefill. */
  lookup(call: string): Entry | undefined
  /** Calls containing `fragment` (≥2 chars), best first — for the strip. */
  search(fragment: string, limit: number): Entry[]
  /** Calls known at this locator, best first — a VHF contest locator heard before the call. */
  byLocator(loc: string, limit: number): Entry[]
}

export const emptySuggestions: SuggestionSource = {
  lookup: () => undefined,
  search: () => [],
  byLocator: () => [],
}
