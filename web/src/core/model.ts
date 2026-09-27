// Domain model for kQSO core. Pure data, zero DOM. See ZADANI-kQSO.md ch. 7, 9, 11, 19.1.

/**
 * A single RF signal specification (ch. 19.1 forward-compat).
 * TX side (`band`/`mode`) is always present; the RX variant is optional and
 * stays undefined in phase 1 — it exists so future satellite QSO support
 * (ADIF BAND_RX / cross-mode) does not force a parser/writer/UI rewrite.
 * Everything downstream references `Signal`, never bare band/mode strings.
 */
export interface Signal {
  readonly band: string // canonical dictionary key, e.g. "40m" (ch. 9 #1)
  readonly bandRx?: string // future SAT → ADIF BAND_RX; undefined in phase 1
  readonly mode: string // canonical dictionary key: "CW" | "SSB" | "FM" (ch. 9 #2)
  readonly modeRx?: string // future SAT; undefined in phase 1
}

/** RST report. Stored as the raw digit string so 59 vs 599 (CW, ch. 8) is preserved verbatim. */
export interface Report {
  readonly sent: string // ADIF RST_SENT
  readonly rcvd: string // ADIF RST_RCVD
}

export type ReferenceKind = 'SOTA' | 'POTA' | 'WWFF'

/** One award reference, already normalized (last slash → dash, ch. 9.1). */
export interface AwardReference {
  readonly kind: ReferenceKind
  readonly value: string // e.g. "OK/ZC-001", "OK-0001", "OKFF-0001"
}

/** One committed contact. `call` is the only mandatory field (ch. 7). */
export interface Qso {
  readonly call: string // ADIF CALL
  readonly timeOn: Date // UTC instant → QSO_DATE + TIME_ON (ch. 11)
  readonly signal: Signal
  readonly report: Report
  readonly stationCall: string // ADIF STATION_CALLSIGN (from LogMeta)
  readonly myGrid: string // ADIF MY_GRIDSQUARE (from LogMeta)
  readonly grid?: string // ADIF GRIDSQUARE — worked station's locator (ch. 9 #8)
  readonly theirRef?: AwardReference // S2S reference of worked station — Aktivace (ch. 9.4)
  readonly myRef?: AwardReference // my activated reference — Aktivace (from LogMeta)
  readonly name?: string // ADIF NAME — Obecný (ch. 9 #9)
  readonly serial?: string // received serial (ADIF SRX_STRING) — VKV závod
  readonly sentSerial?: string // sent serial (ADIF STX_STRING) — VKV závod, auto-incremented
  readonly satName?: string // ADIF SAT_NAME (+ implied PROP_MODE=SAT) — Satellite
  readonly satMode?: string // ADIF SAT_MODE, e.g. "V/U" — Satellite
}

export type ProfileId = 'vkv' | 'aktivace' | 'obecny' | 'sat'

/**
 * Capability flags for a log profile (ch. 7). The parser reads only these
 * booleans, never branches on the id — so adding a profile is one data entry
 * with no parser change.
 */
/** Bundled callsign sets (web/src/db/*.tsv). */
export type BundledDbId = 'vkv' | 'sat' | 'awards'

export interface LogProfile {
  readonly id: ProfileId
  readonly serialAfterCall: boolean // ch. 9 #7: a number after the call is a serial (vkv) vs received report (others)
  readonly parsesName: boolean // ch. 9 #9: name only in Obecný
  readonly usesReferences: boolean // Aktivace only (ch. 7, 14)
  readonly fixedBand: boolean // Satellite: band comes from the bird, ignore typed band tokens
  readonly requiresGrid: boolean // VKV contest: own + worked locator are mandatory (QRB scoring)
  readonly bundledDb: BundledDbId | null // base callsign set for suggestions (calldb.ts); null = live layer only
  readonly wavelogPush: boolean // offer the manual Wavelog push (ch. 19.2); activations go elsewhere
  readonly contest: boolean // VHF contest: dupe = call + band (any mode), QRB points, EDI export
  readonly map: boolean // QSO map of worked locators (VKV, Satellite)
}

export const PROFILES: Readonly<Record<ProfileId, LogProfile>> = Object.freeze({
  vkv: Object.freeze({ id: 'vkv', serialAfterCall: true, parsesName: false, usesReferences: false, fixedBand: false, requiresGrid: true, bundledDb: 'vkv', wavelogPush: true, contest: true, map: true }),
  aktivace: Object.freeze({ id: 'aktivace', serialAfterCall: false, parsesName: false, usesReferences: true, fixedBand: false, requiresGrid: false, bundledDb: 'awards', wavelogPush: false, contest: false, map: false }),
  obecny: Object.freeze({ id: 'obecny', serialAfterCall: false, parsesName: true, usesReferences: false, fixedBand: false, requiresGrid: false, bundledDb: null, wavelogPush: true, contest: false, map: false }),
  sat: Object.freeze({ id: 'sat', serialAfterCall: false, parsesName: false, usesReferences: false, fixedBand: true, requiresGrid: false, bundledDb: 'sat', wavelogPush: true, contest: false, map: true }),
})

/** Log-creation payload (ch. 8 header + ch. 9.3 sticky "my-*" source). Storage-agnostic. */
export interface LogMeta {
  readonly name: string // "Název"
  readonly profile: ProfileId // "Profil" — immutable after creation (ch. 7)
  readonly myCall: string // "Moje volačka" — always required
  readonly myGrid: string // "Můj locator"
  readonly myRef?: AwardReference // "Moje reference" — Aktivace only
  readonly defaultSignal: Signal // "Pásmo / mód" — sticky seed (ch. 8)
  readonly satLabel?: string // Satellite: chosen bird (DB label, e.g. "AO-7 A") — one log per pass
  readonly edi?: EdiContest // VHF contest: filled at the first EDI export, kept for the next one
}

/** Per-contest EDI header fields (REG1TEST TName / PSect / MOpe1), stored in the log. */
export interface EdiContest {
  readonly contest: string // TName
  readonly section: string // PSect, e.g. SO, MO, SO-LP
  readonly operators: string // MOpe1 — other operators of a multi-op entry, ; separated
}

/** Default RST for a mode (ch. 8): 599 on CW, 59 otherwise. Not configurable. */
export function defaultReport(mode: string): string {
  return mode === 'CW' ? '599' : '59'
}

/** Sticky state carried across input lines until an explicit change (ch. 9.3). */
export interface StickyState {
  readonly band: string
  readonly mode: string
  readonly bandRx?: string // ch. 19.1 forward-compat
  readonly modeRx?: string
  readonly satName?: string // Satellite: ADIF SAT_NAME
  readonly satMode?: string // Satellite: ADIF SAT_MODE
}

/** One token's classification. Union order documents ch. 9 priority. */
export type TokenClass =
  | { readonly type: 'band'; readonly value: string } // ch. 9 #1
  | { readonly type: 'mode'; readonly value: string } // ch. 9 #2
  | { readonly type: 'time'; readonly value: string } // ch. 9 #3 (HHMM)
  | { readonly type: 'reference'; readonly value: AwardReference } // ch. 9 #4 / 9.1
  | { readonly type: 'call'; readonly value: string } // ch. 9 #5
  | { readonly type: 'reportSent'; readonly value: string } // ch. 9 #6 T## (TX report)
  | { readonly type: 'number'; readonly value: string } // ch. 9 #7 (after call) — RX report / serial
  | { readonly type: 'locator'; readonly value: string } // ch. 9 #8
  | { readonly type: 'name'; readonly value: string } // ch. 9 #9
  | { readonly type: 'unknown'; readonly raw: string } // ch. 10: rendered struck-through

/** A raw token plus its classification, for the parse-preview strip (ch. 10). */
export interface ClassifiedToken {
  readonly raw: string
  readonly cls: TokenClass
}

/** Fields collected so far across one or more phase-1 Enters (ch. 11). Not yet committable. */
export interface PartialQso {
  readonly call?: string
  readonly timeOn?: Date // stamped at FIRST keystroke after prior commit (ch. 11)
  readonly reportSent?: string
  readonly reportRcvd?: string
  readonly grid?: string
  readonly theirRef?: AwardReference
  readonly name?: string
  readonly serial?: string
  readonly timeOverride?: string // ch. 11: \d{4} first-token manual time (HHMM)
}

/** The reducer's full state: sticky + accumulator (ch. 11). Purely functional. */
export interface CoreState {
  readonly sticky: StickyState
  readonly partial: PartialQso
  readonly hasStarted: boolean // a QSO is in progress → ch. 11 rule 3 (empty commit ignored otherwise)
}
