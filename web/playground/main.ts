// Throwaway debug harness. Wires the pure core AND the
// storage platform to a plain text input. NOT the real logging screen — no
// on-screen keyboard, no theming. Demonstrates: parser preview, two-phase Enter,
// OPFS persistence, crash-journal recovery, export.

import {
  tokenize,
  classifyLine,
  reduce,
  initialState,
  writeQso,
  readLogFile,
  PROFILES,
} from '../src/core/index'
import type {
  ClassifiedToken,
  CoreState,
  LogMeta,
  PartialQso,
  ProfileId,
  TokenClass,
} from '../src/core/index'
import { getPlatform, platformKind } from '../src/platform/index'
import type { KQSOPlatform } from '../src/platform/index'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const lineEl = $<HTMLInputElement>('line')
const previewEl = $('preview')
const stickyEl = $('sticky')
const mineEl = $('mine')
const countEl = $('count')
const pkindEl = $('pkind')
const partialEl = $('partial')
const logEl = $<HTMLUListElement>('log')
const profileEl = $<HTMLSelectElement>('profile')
const logsEl = $<HTMLSelectElement>('logs')
const journalEl = $('journal')
const journalTextEl = $('journal-text')

const platform: KQSOPlatform = getPlatform()
let meta: LogMeta = makeMeta('aktivace')
let state: CoreState = initialState(meta)
let currentLogId = ''

function makeMeta(profile: ProfileId): LogMeta {
  const base: LogMeta = {
    name: `Playground ${profile}`,
    profile,
    myCall: 'OK1CDJ',
    myGrid: 'JN79US',
    defaultSignal: { band: '40m', mode: 'SSB' },
  }
  return profile === 'aktivace' ? { ...base, myRef: { kind: 'SOTA', value: 'OK/ZC-001' } } : base
}

function tokenLabel(cls: TokenClass): { text: string; kind: string } {
  if (cls.type === 'unknown') return { text: cls.raw, kind: 'unknown' }
  if (cls.type === 'reference') return { text: `${cls.value.kind} ${cls.value.value}`, kind: 'reference' }
  return { text: cls.value, kind: cls.type }
}

function renderPreview(tokens: ClassifiedToken[]): void {
  previewEl.replaceChildren(
    ...tokens.map(({ raw, cls }) => {
      const { text, kind } = tokenLabel(cls)
      const el = document.createElement('span')
      el.className = `tok t-${kind}${kind === 'unknown' ? ' unknown' : ''}`
      el.innerHTML = `${escapeHtml(text)}<small>${kind}</small>`
      el.title = raw
      return el
    }),
  )
}

function renderLivePreview(): void {
  const callSeen = state.partial.call !== undefined
  renderPreview(classifyLine(tokenize(lineEl.value), PROFILES[meta.profile], callSeen))
}

function renderState(): void {
  const s = state.sticky
  stickyEl.textContent = `${s.band} ${s.mode}${s.bandRx ? ` /RX ${s.bandRx}` : ''}`
  mineEl.textContent = `${meta.myCall} ${meta.myGrid}${meta.myRef ? ` (${meta.myRef.value})` : ''}`
  partialEl.textContent = JSON.stringify(
    state.partial,
    (_k, v) => (v instanceof Date ? v.toISOString() : v),
    2,
  )
}

function renderQsoList(records: string[]): void {
  logEl.replaceChildren(
    ...records.map((r) => {
      const li = document.createElement('li')
      li.textContent = r
      return li
    }),
  )
}

async function refreshLogList(): Promise<void> {
  const logs = await platform.listLogs()
  logsEl.replaceChildren(
    ...logs.map((l) => {
      const o = document.createElement('option')
      o.value = l.id
      o.textContent = `${l.name} (${l.qsoCount})`
      o.selected = l.id === currentLogId
      return o
    }),
  )
}

async function loadLog(id: string): Promise<void> {
  currentLogId = id
  const { meta: loaded, qsos } = readLogFile(await platform.readLog(id))
  meta = loaded
  profileEl.value = meta.profile
  state = initialState(meta)
  countEl.textContent = String(qsos.length)
  renderQsoList(qsos.slice(-8).reverse().map(writeQso))
  renderState()
  renderLivePreview()
  await offerJournalRecovery()
}

async function newLog(): Promise<void> {
  const id = await platform.createLog(makeMeta(profileEl.value as ProfileId))
  await refreshLogList()
  await loadLog(id)
}

async function offerJournalRecovery(): Promise<void> {
  const text = await platform.readJournal(currentLogId)
  if (!text.trim()) {
    journalEl.hidden = true
    return
  }
  journalTextEl.textContent = text
  journalEl.hidden = false
}

function reviveDates(p: PartialQso): PartialQso {
  return p.timeOn ? { ...p, timeOn: new Date(p.timeOn as unknown as string) } : p
}

// --- events ------------------------------------------------------------------

lineEl.addEventListener('input', () => {
  if (!state.partial.timeOn && lineEl.value.length > 0) {
    state = reduce(state, { type: 'firstKeystroke', at: new Date() }, meta).state
  }
  renderLivePreview()
})

lineEl.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return
  ev.preventDefault()
  void handleEnter()
})

async function handleEnter(): Promise<void> {
  const r = reduce(state, { type: 'enter', line: lineEl.value }, meta)
  state = r.state
  if (r.clearInput) lineEl.value = ''

  if (r.committed) {
    const record = writeQso(r.committed)
    await platform.appendQso(currentLogId, record)
    await platform.clearJournal(currentLogId)
    journalEl.hidden = true
    logEl.prepend(Object.assign(document.createElement('li'), { textContent: record }))
    countEl.textContent = String(Number(countEl.textContent) + 1)
    await refreshLogList()
  } else if (state.hasStarted && state.partial.call) {
    // Mirror the in-progress QSO to the crash journal after each phase-1 Enter.
    await platform.writeJournal(
      currentLogId,
      JSON.stringify(state.partial, (_k, v) => (v instanceof Date ? v.toISOString() : v)),
    )
  }

  renderState()
  renderLivePreview()
}

profileEl.addEventListener('change', () => void newLog())
$('newlog').addEventListener('click', () => void newLog())
logsEl.addEventListener('change', () => void loadLog(logsEl.value))
$('export').addEventListener('click', () => {
  void platform.exportLog(currentLogId, `${currentLogId}.adi`)
})

$('recover').addEventListener('click', () => {
  const parsed = reviveDates(JSON.parse(journalTextEl.textContent || '{}') as PartialQso)
  state = { ...state, partial: parsed, hasStarted: true }
  journalEl.hidden = true
  renderState()
})
$('discard').addEventListener('click', () => {
  void platform.clearJournal(currentLogId)
  journalEl.hidden = true
})

// --- init --------------------------------------------------------------------

async function init(): Promise<void> {
  pkindEl.textContent = platformKind()
  const logs = await platform.listLogs()
  if (logs.length > 0) await loadLog(logs[0]!.id)
  else await newLog()
  await refreshLogList()
  lineEl.focus()
}

void init()

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}
