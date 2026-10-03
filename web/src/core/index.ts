// Public API surface of the kQSO core. Pure logic, zero DOM.

export type {
  Signal,
  Report,
  ReferenceKind,
  AwardReference,
  Qso,
  ProfileId,
  LogProfile,
  BundledDbId,
  LogMeta,
  EdiContest,
  StickyState,
  TokenClass,
  ClassifiedToken,
  PartialQso,
  CoreState,
} from './model'
export { PROFILES, defaultReport } from './model'

export { BANDS, MODES, matchBand, matchMode } from './dictionaries'
export { SATELLITES, satelliteByLabel, satelliteSignal, fillSatFrequencies } from './satellites'
export type { Satellite } from './satellites'
export { matchReference, parseReferenceInput } from './reference'
export { tokenize } from './tokenize'
export { classifyToken, classifyLine, isFullLocator } from './classify'
export type { TokenContext } from './classify'
export { initialSticky, applyBand, applyMode, applySatellite } from './sticky'
export { parseLine } from './parse'
export { matchCommand, matchKeyerCommand, hasContent } from './command'
export type { LineCommand, KeyerCommand } from './command'
export {
  LineAssembler,
  chunk,
  KeyerProtocol,
  asyncEvent,
  sanitize,
  expandMacro,
  greeting,
  macroFor,
  withMacro,
  resetMacros,
  parseMacros,
  clampWpm,
  DEFAULT_MACROS,
  MACRO_SLOTS,
  SEND_MAX,
  WPM_MIN,
  WPM_MAX,
  WPM_DEFAULT,
} from './keyer'
export type { KeyerEvent, MacroSlot, RunMode, MacroSet, MacroContext, SavedMacros } from './keyer'
export type { ParseResult } from './parse'
export { buildQso, missingParts } from './qso'
export { initialState, reduce } from './reducer'
export type { CoreEvent, ReduceResult } from './reducer'

export { writeField, writeQso, writeHeader, writeAdif } from './adif/writer'
export { readAdif } from './adif/reader'
export type { ReadResult } from './adif/reader'
export { writeLogFile, writeLogHeader, readLogFile } from './adif/logfile'
export type { ParsedLogFile } from './adif/logfile'
export { emptySuggestions } from './suggest'
export type { SuggestionSource } from './suggest'
export { isDupe } from './dupe'
export { bearingDeg, gridCenter, latLonToGrid, qrbKm, qsoPoints } from './locator'
export { fitView, project, unproject, zoomView, panView } from './mercator'
export type { MapView, LatLon } from './mercator'
export {
  RADAR_META_URL,
  latestFrame,
  tileUrl,
  tileZoom,
  visibleTiles,
  tileBox,
  rainLevel,
  pixelDbz,
  recolor,
  EINK_PALETTE,
  COLOR_PALETTE,
} from './radar'
export type { RadarFrame, RadarPalette, TileRef } from './radar'
export { contestStats, scoreLog } from './contest'
export type { BandScore, ContestStats, ScoredQso } from './contest'
export { writeEdi, ediBand, ediBands, ediAscii, parseEdiSettings, serializeEdiSettings, equipmentFor, EMPTY_EQUIPMENT } from './edi'
export type { EdiStation, EdiEquipment, EdiSettings } from './edi'
export { announceUpdate, compareVersions, parseVersion } from './version'
export { WHATS_NEW, notesSince, seenBaseline } from './whatsnew'
export type { WhatsNewEntry } from './whatsnew'
export { LiveDb, LIVE_MAX, baseSource, combineSources, dbDate, mergeEntry, parseDb, serializeDb, userHeader } from './calldb'
export type { Entry, ParsedDb } from './calldb'
export {
  WAVELOG_SETTINGS,
  WavelogError,
  apiBase,
  errorFor,
  parseImport,
  parseStations,
  pushStatusKey,
  readPushStatus,
} from './wavelog'
export type { PushStatus, WavelogErrorKind, WavelogStation } from './wavelog'
