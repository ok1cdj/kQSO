import { describe, it, expect } from 'vitest'
import {
  roomForBand,
  asciiOut,
  unescapeHtml,
  baseCall,
  plainText,
  parseFrame,
  loginLine,
  sdoneLine,
  msgLine,
  chatText,
  chatTarget,
  expandSked,
  matchSkedQrg,
  waitSeconds,
  KstState,
  KstSession,
  KST_MESSAGES_MAX,
  kstStations,
  isActive,
  sortStations,
  viewStations,
} from '../src/core/kst'
import type { KstEvent } from '../src/core/kst'

describe('roomForBand', () => {
  it('maps bands to rooms', () => {
    expect(roomForBand('6m')).toBe(1)
    expect(roomForBand('4m')).toBe(1)
    expect(roomForBand('2m')).toBe(2)
    expect(roomForBand('70cm')).toBe(2)
    expect(roomForBand('23cm')).toBe(3)
    expect(roomForBand('3cm')).toBe(3)
    expect(roomForBand('1.25cm')).toBe(3)
    expect(roomForBand('6mm')).toBe(3)
    expect(roomForBand('20m')).toBeUndefined()
  })
})

describe('text helpers', () => {
  it('asciiOut drops diacritics and the field separator', () => {
    expect(asciiOut('Příliš žluťoučký kůň')).toBe('Prilis zlutoucky kun')
    expect(asciiOut('a|b')).toBe('a/b')
    expect(asciiOut('73 → OK')).toBe('73 ? OK')
  })
  it('unescapeHtml', () => {
    expect(unescapeHtml('&lt;b&gt; Tom &amp; Jerry &quot;x&quot; it&#39;s')).toBe('<b> Tom & Jerry "x" it\'s')
    expect(unescapeHtml('&amp;lt;')).toBe('&lt;')
    expect(unescapeHtml('Hennie&#9889;2m &#x41;')).toBe('Hennie\u26a12m A')
    expect(unescapeHtml('&#38;lt; &#0; &bogus;')).toBe('&lt; ? &bogus;')
  })
  it('plainText: a link → its address, tags dropped', () => {
    expect(plainText('we did again!!! <a href="https://prnt.sc/XoNRDKYBUzvx" target="_blank"><b>https_link</b></a>')).toBe(
      'we did again!!! https://prnt.sc/XoNRDKYBUzvx',
    )
    expect(plainText('<b>bold</b> 1 < 2 > 0')).toBe('bold 1 < 2 > 0')
  })
  it('baseCall drops the band suffix', () => {
    expect(baseCall('dl1abc-432')).toBe('DL1ABC')
    expect(baseCall('OK1CDJ/P')).toBe('OK1CDJ/P')
    expect(baseCall('OK1CDJ')).toBe('OK1CDJ')
  })
  it('chatText turns @CALL into /CQ', () => {
    expect(chatText('@ok1kpa pse sked 432.200')).toBe('/CQ OK1KPA pse sked 432.200')
    expect(chatText('  cq contest  ')).toBe('cq contest')
    expect(chatText('@OK1KPA')).toBe('@OK1KPA')
    expect(chatText('   ')).toBeUndefined()
    expect(chatText('@ cq contest JN79')).toBe('cq contest JN79')
    expect(chatText('@')).toBeUndefined()
  })
  it('chatTarget', () => {
    expect(chatTarget('@ok1kpa pse')).toBe('OK1KPA')
    expect(chatTarget('@ cq')).toBe('')
    expect(chatTarget('OK1KPA')).toBeUndefined()
  })
  it('expandSked', () => {
    expect(expandSked('pse sked {QRG} {MODE}?', { qrgMHz: '432.2', mode: 'CW', loc: 'JN79US' })).toBe('pse sked 432.200 CW?')
    expect(expandSked('pse sked {QRG} {MODE}?', { mode: 'SSB', loc: 'JN79US' })).toBe('pse sked SSB?')
    expect(expandSked('sked? {loc}', { mode: 'SSB', loc: 'JN79US' })).toBe('sked? JN79US')
    // the band's sked QRG (G command) wins over the radio, any text
    expect(expandSked('pse sked {QRG} {MODE}?', { qrgMHz: '144.05', skedQrg: '144.290 ±5', mode: 'CW', loc: '' })).toBe('pse sked 144.290 ±5 CW?')
    expect(expandSked('pse sked {QRG} {MODE}?', { skedQrg: '432.210', mode: 'SSB', loc: '' })).toBe('pse sked 432.210 SSB?')
    expect(expandSked('pse sked {QRG} {MODE}?', { qrgMHz: '144.05', skedQrg: '', mode: 'CW', loc: '' })).toBe('pse sked 144.050 CW?')
  })
  it('matchSkedQrg: G text, G alone shows, else not the command', () => {
    expect(matchSkedQrg('g 144.300')).toBe('144.300')
    expect(matchSkedQrg('G  432.210 cw ')).toBe('432.210 cw')
    expect(matchSkedQrg('G')).toBe('')
    expect(matchSkedQrg(' g ')).toBe('')
    expect(matchSkedQrg('G -')).toBe('-')
    expect(matchSkedQrg('G4ABC')).toBeUndefined()
    expect(matchSkedQrg('OK1ABC G')).toBeUndefined()
  })
  it('waitSeconds', () => {
    expect(waitSeconds('Please wait 42 second(s) before sending')).toBe(42)
    expect(waitSeconds('hello')).toBeUndefined()
  })
})

describe('parseFrame', () => {
  it('LOGSTAT ok and failed', () => {
    expect(parseFrame('LOGSTAT|100|Welcome|x|x|x|x|x|jo70ab|')).toEqual({ type: 'logstat', code: 100, text: 'Welcome', locator: 'JO70AB' })
    expect(parseFrame('LOGSTAT|114|Wrong password|')).toEqual({ type: 'logstat', code: 114, text: 'Wrong password', locator: undefined })
  })
  it('chat message, public and addressed', () => {
    expect(parseFrame('CH|2|1729000000|DL1ABC-432|Hans 2/70|0|cq 144.300|0|')).toEqual({
      type: 'message',
      history: false,
      msg: { room: 2, ts: 1729000000, call: 'DL1ABC-432', name: 'Hans 2/70', text: 'cq 144.300', to: undefined },
    })
    const f = parseFrame('CR|2|1729000001|OK1KPA|Petr|0|(OK1CDJ) pse sked 432.2 &amp; 1296|OK1CDJ|')
    expect(f).toMatchObject({ type: 'message', history: true, msg: { to: 'OK1CDJ', text: '(OK1CDJ) pse sked 432.2 & 1296' } })
  })
  it('users', () => {
    expect(parseFrame('UA0|2|OK1KPA|Petr|jo60lj|0|')).toEqual({ type: 'user', change: 'list', room: 2, call: 'OK1KPA', name: 'Petr', loc: 'JO60LJ', away: false })
    expect(parseFrame('UA5|2|DL1ABC|Hans|JO62AA|1|')).toMatchObject({ change: 'joined', away: true })
    expect(parseFrame('UM3|2|DL1ABC|Hans|JO62AB|0|')).toMatchObject({ change: 'changed', loc: 'JO62AB' })
    expect(parseFrame('US4|2|DL1ABC|1|')).toEqual({ type: 'userState', room: 2, call: 'DL1ABC', away: true })
    expect(parseFrame('UR6|2|DL1ABC|')).toEqual({ type: 'userLeft', room: 2, call: 'DL1ABC' })
    expect(parseFrame('UE|2|25527|')).toEqual({ type: 'listEnd', room: 2 })
    expect(parseFrame('LOC|1729000000|DL1ABC|jo62ac|')).toEqual({ type: 'loc', call: 'DL1ABC', loc: 'JO62AC' })
  })
  it('ping, history end, junk', () => {
    expect(parseFrame('CK|')).toEqual({ type: 'ping' })
    expect(parseFrame('CE|2|')).toEqual({ type: 'historyEnd' })
    expect(parseFrame('MA|0|1792917050|ha9al|IV3BHD|JN97PM|JN65QQ|')).toBeUndefined()
    expect(parseFrame('XYZ|1|')).toBeUndefined()
    expect(parseFrame('CH|2|nope|DL1ABC|x|0|y|0|')).toBeUndefined()
    expect(parseFrame('UA0|2||x|y|0|')).toBeUndefined()
  })
})

describe('outgoing lines', () => {
  it('login, SDONE, MSG', () => {
    expect(loginLine('ok1cdj', 'secret', 2, 'kQSO 1.14')).toBe('LOGINC|OK1CDJ|secret|2|kQSO 1.14|25|0|1|0|0|')
    expect(loginLine('OK1CDJ', 's', 3, 'kQSO 1.14', 1729000000)).toBe('LOGINC|OK1CDJ|s|3|kQSO 1.14|25|0|1|1729000000|0|')
    expect(sdoneLine(2)).toBe('SDONE|2|')
    expect(msgLine(2, 'čau | 73')).toBe('MSG|2|0|cau / 73|0|')
  })
})

describe('KstState', () => {
  const ch = (ts: number, call: string, text: string, to = '0') => parseFrame(`CH|2|${ts}|${call}|n|0|${text}|${to}|`)!

  it('keeps the station list, skips me, marks stations that join later', () => {
    const s = new KstState('OK1CDJ')
    s.apply(parseFrame('UA0|2|OK1KPA|Petr|JO60LJ|0|')!)
    s.apply(parseFrame('UA0|2|OK1CDJ-2|me|JO70AB|0|')!)
    s.apply(parseFrame('UA5|2|OK2XX|early|JN89AA|0|')!)
    s.apply(parseFrame('UE|2|25527|')!)
    s.apply(parseFrame('UA5|2|DL1ABC|Hans|JO62AA|0|')!)
    expect([...s.users.keys()]).toEqual(['OK1KPA', 'OK2XX', 'DL1ABC'])
    expect(s.users.get('OK2XX')!.isNew).toBe(false)
    expect(s.users.get('DL1ABC')!.isNew).toBe(true)
    s.apply(parseFrame('UM3|2|DL1ABC|Hans 2/70|JO62AA|0|')!)
    expect(s.users.get('DL1ABC')).toMatchObject({ name: 'Hans 2/70', isNew: true })
    s.apply(parseFrame('US4|2|OK1KPA|1|')!)
    expect(s.users.get('OK1KPA')!.away).toBe(true)
    s.apply(parseFrame('LOC|1|OK1KPA|JO60LK|')!)
    expect(s.users.get('OK1KPA')!.loc).toBe('JO60LK')
    s.apply(parseFrame('UR6|2|OK2XX|')!)
    expect(s.users.has('OK2XX')).toBe(false)
    s.resetUsers()
    expect(s.users.size).toBe(0)
    expect(s.listDone).toBe(false)
  })

  it('messages: for me, mentions, duplicates, lastTs, ring', () => {
    const s = new KstState('OK1CDJ')
    expect(s.apply(ch(10, 'OK1KPA', 'pse sked', 'OK1CDJ-432'))).toMatchObject({ forMe: true, mentionsMe: false })
    expect(s.apply(ch(11, 'DL1ABC', 'ok1cdj is qrv 432.2'))).toMatchObject({ forMe: false, mentionsMe: true })
    expect(s.apply(ch(12, 'DL1ABC', 'OK1CDJX here'))).toMatchObject({ mentionsMe: false })
    expect(s.apply(ch(13, 'OK1CDJ', 'cq OK1CDJ'))).toMatchObject({ mentionsMe: false })
    expect(s.apply(ch(10, 'OK1KPA', 'pse sked', 'OK1CDJ'))).toBeUndefined() // repeated history
    expect(s.lastTs).toBe(13)
    for (let i = 0; i < KST_MESSAGES_MAX + 5; i++) s.apply(ch(100 + i, 'X', `m${i}`))
    expect(s.messages.length).toBe(KST_MESSAGES_MAX)
    expect(s.messages[0]!.text).toBe('m5')
  })

  it('keeps messages oldest first although the history comes newest first', () => {
    const s = new KstState('OK1CDJ')
    s.apply(ch(30, 'A', 'live'))
    s.apply(ch(20, 'B', 'h2'))
    s.apply(ch(10, 'C', 'h1'))
    s.apply(ch(20, 'D', 'same time'))
    expect(s.messages.map((m) => m.text)).toEqual(['h1', 'h2', 'same time', 'live'])
  })
})

describe('KstSession', () => {
  const setup = (state = new KstState('OK1CDJ')) => {
    const out: string[] = []
    const events: KstEvent[] = []
    const s = new KstSession({ call: 'OK1CDJ', pass: 'pw', room: 2, client: 'kQSO 1.14' }, state, (t) => out.push(t), (e) => events.push(e))
    return { s, out, events, state }
  }

  it('logs in: prompt without a line end, LOGSTAT, SDONE', () => {
    const { s, out, events } = setup()
    s.receive('Welcome to ON4KST\r\nlog')
    expect(out).toEqual([])
    s.receive('in: ')
    expect(out).toEqual(['LOGINC|OK1CDJ|pw|2|kQSO 1.14|25|0|1|0|0|\r'])
    expect(s.state).toBe('logstat')
    s.receive('LOGSTAT|100|ok|a|b|c|d|e|JO70AB|\r\n')
    expect(out[1]).toBe('SDONE|2|\r')
    expect(s.state).toBe('on')
    expect(s.locator).toBe('JO70AB')
    expect(events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state)).toEqual(['logstat', 'on'])
  })

  it('logs in with the real server lines', () => {
    const { s, out, events } = setup()
    s.receive('Java login 20040703a\r\n')
    expect(out[0]).toMatch(/^LOGINC\|/)
    s.receive('LOGSTAT|100|2|20040703a|HASH|0|OK1KPA 3cm|x|JN79US|mail|\r\nCH|2|1792916803|SERVER|Message|0|Use the cluster.|0|\r\n')
    s.receive('CR|2|1792916416|IZ6RCR|Nik only 2MnoCW|0|hello zoli try?|HA4XN|\r\nCE|2|\r\n')
    s.receive('UA0|2|DJ7R|Team|JN59UK|0|\r\nUA0|2|OK1CDJ|OK1KPA 3cm|JN79US|2|\r\nUE|2|25528|\r\nCK|\r\n')
    s.receive('CH|2|1792916988|SV0SYH|Ondrej 150W/5el|0|hi|OK1CDJ|\r\nUA5|2|SV0SYH|Ondrej 150W/5el|KN10LO|2|\r\nUE|2|25528|\r\n')
    expect(s.locator).toBe('JN79US')
    expect([...s.chat.users.keys()]).toEqual(['DJ7R', 'SV0SYH'])
    expect(s.chat.users.get('SV0SYH')!.isNew).toBe(true)
    expect(s.chat.messages.map((m) => m.call)).toEqual(['IZ6RCR', 'SERVER', 'SV0SYH'])
    expect(s.chat.messages[2]).toMatchObject({ forMe: true, text: 'hi' })
    expect(events.filter((e) => e.type === 'message').length).toBe(3)
  })

  it('wrong password fails', () => {
    const { s, out, events } = setup()
    s.receive('login:\nLOGSTAT|114|Wrong password|\n')
    expect(s.state).toBe('failed')
    expect(events).toContainEqual({ type: 'failed', code: 114, text: 'Wrong password' })
    expect(out.length).toBe(1)
    s.send('hello')
    expect(out.length).toBe(1)
  })

  it('answers CK, reports messages, users once after the list, wait', () => {
    const { s, out, events } = setup()
    s.receive('login:\nLOGSTAT|100|ok|||||| JO70AB|\n')
    out.length = 0
    events.length = 0
    s.receive('UA0|2|OK1KPA|Petr|JO60LJ|0|\nUA0|2|DL1ABC|Hans|JO62AA|0|\n')
    expect(events).toEqual([])
    s.receive('UE|2|25527|\nCR|2|5|OK1KPA|Petr|0|old|0|\nCE|\nCK|\n')
    expect(events.map((e) => e.type)).toEqual(['users', 'message'])
    expect(events[1]).toMatchObject({ history: true })
    expect(out).toEqual(['\r\n'])
    events.length = 0
    s.receive('CH|2|6|SERVER|Server|0|Please wait 30 second(s)|OK1CDJ|\r\n')
    expect(events.map((e) => e.type)).toEqual(['wait', 'message'])
    expect(events[0]).toEqual({ type: 'wait', seconds: 30 })
  })

  it('a split line is joined', () => {
    const { s, events } = setup()
    s.receive('login:\nLOGSTAT|100|ok|\nUE|2|1|\nCH|2|7|OK1KPA|Pe')
    expect(events.some((e) => e.type === 'message')).toBe(false)
    s.receive('tr|0|ahoj|0|\n')
    expect(events.find((e) => e.type === 'message')).toMatchObject({ entry: { name: 'Petr', text: 'ahoj' } })
  })

  it('sends typed text', () => {
    const { s, out } = setup()
    s.receive('login:\nLOGSTAT|100|ok|\n')
    out.length = 0
    expect(s.send('@ok1kpa pse sked 432.200 CW')).toBe(true)
    expect(s.send('  ')).toBe(false)
    expect(out).toEqual(['MSG|2|0|/CQ OK1KPA pse sked 432.200 CW|0|\r'])
  })

  it('reconnect over the same state asks from lastTs - 1 and drops repeated history', () => {
    const state = new KstState('OK1CDJ')
    const a = setup(state)
    a.s.receive('login:\nLOGSTAT|100|ok|\nUA0|2|OK1KPA|Petr|JO60LJ|0|\nUE|2|1|\nCH|2|50|OK1KPA|Petr|0|hi|0|\n')
    const b = setup(state)
    expect(state.users.size).toBe(0)
    b.s.receive('login:')
    expect(b.out[0]).toBe('LOGINC|OK1CDJ|pw|2|kQSO 1.14|25|0|1|49|0|\r')
    b.s.receive('LOGSTAT|100|ok|\nCR|2|50|OK1KPA|Petr|0|hi|0|\nCE|\n')
    expect(b.events.some((e) => e.type === 'message')).toBe(false)
    expect(state.messages.length).toBe(1)
  })
})

describe('station list', () => {
  const chat = new KstState('OK1CDJ')
  for (const l of [
    'UA0|2|OK1KPA|Petr|JO60LJ|0|',
    'UA0|2|DL1ABC-432|Hans|JO62AA|0|',
    'UA0|2|SP3TYF|Slawek|JO82EH|1|',
    'UA0|2|XX1XX|nobody||0|',
    'UE|2|1|',
    'CH|2|1000|OK1KPA|Petr|0|cq|0|',
    'CH|2|1900|DL1ABC-432|Hans|0|sked?|OK1CDJ|',
    'CH|2|1950|SP3TYF|Slawek|0|qrv|0|',
  ])
    chat.apply(parseFrame(l)!)
  const list = kstStations(chat, 'JN79US', (c) => c === 'DL1ABC')

  it('adds distance, bearing, worked (without the band suffix) and the last message', () => {
    const dl = list.find((s) => s.call === 'DL1ABC-432')!
    expect(dl.worked).toBe(true)
    expect(dl.lastTs).toBe(1900)
    expect(Number.isInteger(dl.km)).toBe(true)
    expect(dl.km).toBeGreaterThan(200)
    expect(list.find((s) => s.call === 'XX1XX')).toMatchObject({ km: undefined, az: undefined, lastTs: undefined })
  })
  it('active = wrote in the window, away or not', () => {
    expect(list.filter((s) => isActive(s, 3500)).map((s) => s.call)).toEqual(['DL1ABC-432', 'SP3TYF'])
    expect(list.filter((s) => isActive(s, 2000, 1000)).map((s) => s.call)).toEqual(['OK1KPA', 'DL1ABC-432', 'SP3TYF'])
  })
  it('sorts by call, km, az; unknown last', () => {
    expect(sortStations(list, 'call').map((s) => s.call)).toEqual(['DL1ABC-432', 'OK1KPA', 'SP3TYF', 'XX1XX'])
    const km = sortStations(list, 'km')
    expect(km.at(-1)!.call).toBe('XX1XX')
    expect(km.map((s) => s.km).slice(0, 3)).toEqual([...km.map((s) => s.km).slice(0, 3)].sort((a, b) => a! - b!))
  })
  it('sorts descending too; unknown still last', () => {
    expect(sortStations(list, 'call', true).map((s) => s.call)).toEqual(['XX1XX', 'SP3TYF', 'OK1KPA', 'DL1ABC-432'])
    const km = sortStations(list, 'km', true)
    expect(km.at(-1)!.call).toBe('XX1XX')
    expect(km.map((s) => s.km).slice(0, 3)).toEqual([...km.map((s) => s.km).slice(0, 3)].sort((a, b) => b! - a!))
    const az = sortStations(list, 'az', true)
    expect(az.at(-1)!.call).toBe('XX1XX')
  })
  it('the view filters worked and away, then sorts', () => {
    const v = { sort: 'call', desc: false, hideWorked: true, hideAway: true } as const
    expect(viewStations(list, v).map((s) => s.call)).toEqual(['OK1KPA', 'XX1XX'])
    expect(viewStations(list, { ...v, hideAway: false }).map((s) => s.call)).toEqual(['OK1KPA', 'SP3TYF', 'XX1XX'])
    expect(viewStations(list, { ...v, hideWorked: false, hideAway: false, desc: true }).map((s) => s.call)).toEqual(['XX1XX', 'SP3TYF', 'OK1KPA', 'DL1ABC-432'])
  })
})
