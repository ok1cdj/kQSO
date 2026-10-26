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
  ContestCategory,
  ContestKind,
  EdiContest,
  StickyState,
  TokenClass,
  ClassifiedToken,
  PartialQso,
  CoreState,
} from './model'
export { PROFILES, defaultReport } from './model'

export { BANDS, MODES, matchBand, matchMode, bandForFreq, bandSpot } from './dictionaries'
export { SATELLITES, satelliteByLabel, satelliteSignal, fillSatFrequencies } from './satellites'
export type { Satellite } from './satellites'
export { matchReference, oncePerLog, parseMyRefsInput, parseReferenceInput } from './reference'
export type { MyRefsResult } from './reference'
export { tokenize } from './tokenize'
export { classifyToken, classifyLine, isFullLocator } from './classify'
export type { TokenContext } from './classify'
export { initialSticky, applyBand, applyMode, applySatellite, applyRadio } from './sticky'
export { parseLine } from './parse'
export { matchCommand, matchKeyerCommand, matchTuneCommand, hasContent } from './command'
export type { LineCommand, KeyerCommand } from './command'
export {
  LineAssembler,
  chunk,
  KeyerProtocol,
  asyncEvent,
  versionAtLeast,
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
  ESM_ONLY_SLOTS,
  esmMessage,
  infoLabel,
  cqLabel,
  SEND_MAX,
  WPM_MIN,
  WPM_MAX,
  WPM_DEFAULT,
} from './keyer'
export type { CwOutput, KeyerEvent, MacroSlot, RunMode, MacroSet, MacroContext, SavedMacros, EsmBefore, EsmAfter } from './keyer'
export type { ParseResult } from './parse'
export {
  CivProtocol,
  CivCwOutput,
  RIG_ADDR,
  CTRL_ADDR,
  FrameAssembler,
  civCommand,
  toHex,
  fromHex,
  CIV_MODE,
  civModeFor,
  modeFromCiv,
  freqMHz,
  readFreq,
  readMode,
  setFreq,
  setMode,
  playVoice,
  readTx,
  readBandStack,
  parseBandStack,
} from './civ'
export type { RigEvent, Timers } from './civ'
export { KST_ACTIVE_S, KST_HOST, KST_PORT, KST_VIEW_DEFAULT, KstSession, KstState, SKED_DEFAULT, baseCall, chatTarget, chatText, expandSked, isActive, kstStations, locatorToSet, matchSkedQrg, roomForBand, sortStations, viewStations } from './kst'
export type { KstEntry, KstEvent, KstLogin, KstRoom, KstSessionState, KstSort, KstStation, KstUser, KstView } from './kst'
export { parseMHz, parseXverts, toIf, toRf, ifBand } from './xvert'
export { RIG_MODELS, IC705, genericModel, modelById, modelForAddr, knowsBands, modelBands, rigHasBand, rigTunes, xvertBands } from './rigmodel'
export type { RigModel } from './rigmodel'
export type { Xvert } from './xvert'
export { buildQso, missingParts, padSerial } from './qso'
export { initialState, reduce } from './reducer'
export type { CoreEvent, ReduceResult } from './reducer'

export { writeField, writeQso, writeHeader, writeAdif } from './adif/writer'
export { readAdif } from './adif/reader'
export type { ReadResult } from './adif/reader'
export { writeLogFile, writeLogHeader, readLogFile, writeRefExport, refExportName } from './adif/logfile'
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
export { contestStats, scoreLog, scoringFor, contestPoints, ringPoints, KM_SCORING, sixHourWindow, sixHourPart, sixHourStatus, hourlyStats, qsoRate, squareStats } from './contest'
export type { BandScore, ContestStats, Scoring, ScoredQso, SixHourWindow, SixHourPhase, HourStats, SquareStats } from './contest'
export {
  writeEdi,
  ediBand,
  ediBands,
  ediAscii,
  ediSection,
  ediFileName,
  isSixHours,
  categoryFromSection,
  contestForDate,
  LP_6H_BANDS,
  LP_MAX_W,
  powerWatts,
  parseEdiSettings,
  serializeEdiSettings,
  equipmentFor,
  EMPTY_EQUIPMENT,
} from './edi'
export type { EdiStation, EdiEquipment, EdiSettings } from './edi'
export { announceUpdate, checksGitHub, compareVersions, parseVersion } from './version'
export { WHATS_NEW, notesSince, seenBaseline } from './whatsnew'
export type { WhatsNewEntry } from './whatsnew'
export {
  LiveDb,
  LIVE_MAX,
  bandLetter,
  baseSource,
  combineSources,
  dbDate,
  mergeEntry,
  parseDb,
  qrvBands,
  qrvLabels,
  unionQrv,
  serializeDb,
  userHeader,
} from './calldb'
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
export { bandsInMessage, bandsInText, chatQrv } from './kst-bands'
