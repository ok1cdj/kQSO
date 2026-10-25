// The bands an ON4KST station is QRV on, guessed from what it writes: its name (free
// text, by VHF habit "2/70/23", "6&2m", "23-13-6-3") and its messages ("qrv 1296.150",
// "pse sked 432.2", "no 23"). The result is a QRV string of Tučňák's band letters, the
// same as the callsign database's (calldb.ts), so qrvLabels shows it the same way.
// Pure; only VHF and up (an HF band in a name — 10M — is left out).

import { bandLetter } from './calldb'
import { bandForFreq } from './dictionaries'
import type { KstState } from './kst'
import { baseCall } from './kst'

/** Bare numbers in a band list ("2/70/23"). 6 and 3 are 6 m and 3 cm next to the VHF
 *  bands, but 6 cm and 3 cm in a microwave list ("23/6/3"). */
const BARE_VHF: Readonly<Record<string, string>> = {
  '50': '6m', '6': '6m', '4': '4m', '70': '70cm', '.70': '70cm', '07': '70cm', '2': '2m',
  '144': '2m', '145': '2m', '432': '70cm', '433': '70cm', '435': '70cm', '23': '23cm',
  '1296': '23cm', '1.2': '23cm', '1.3': '23cm', '13': '13cm', '2.3': '13cm', '2.4': '13cm',
  '9': '9cm', '3.4': '9cm', '5.7': '6cm', '3': '3cm', '24': '1.25cm',
}
const MICROWAVE = new Set(['23', '13', '9', '1296', '2.3', '2.4', '3.4', '5.7'])
const BARE_MICRO: Readonly<Record<string, string>> = { '6': '6cm', '3': '3cm', '1.2': '1.25cm' }
/** A number with its unit: 2m, 70cm, 6mm, 10G / 10GHz. */
const UNIT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  m: { '6': '6m', '4': '4m', '2': '2m' },
  cm: { '70': '70cm', '23': '23cm', '13': '13cm', '9': '9cm', '6': '6cm', '3': '3cm', '1.2': '1.25cm', '1.25': '1.25cm' },
  mm: { '6': '6mm', '4': '4mm' },
  g: { '1.2': '23cm', '1.3': '23cm', '2.3': '13cm', '2.4': '13cm', '3.4': '9cm', '5.7': '6cm', '10': '3cm', '24': '1.25cm', '47': '6mm', '76': '4mm' },
}

const NUM = String.raw`\.?\d+(?:[.,]\d+)?`
/** A list of two or more numbers ("2/70/23", "144 / 432", "6&2", "144 > 1.2"), maybe with
 *  a unit on the last one ("6&2m", "70/6cm"). */
const LIST = new RegExp(String.raw`(?<![\d.])(${NUM}(?:\s*[/\-&+>,]\s*${NUM})+)\s?(cm|mm|m|ghz|g)?(?![a-z]|\d)`, 'gi')
/** One number with a unit; letters may stick to it ("Markus2m11el", "2MnoCW"). */
const WITH_UNIT = new RegExp(String.raw`(?<![\d.])(${NUM})\s?(cm|mm|m|ghz|g)(?![a-mo-z])`, 'gi')
/** A frequency in MHz (1296.297, 432,2) or in kHz (144390). */
const MHZ = /(?<![\d.])(\d{2,5})[.,](\d{1,3})(?![\d])/g
const KHZ = /(?<![\d.])(\d{6,8})(?![\d.])/g
/** Calls in a name ("OK1KPA", "PA2M"): their digits are no bands. */
const CALL = /\b(?:[A-Z]{1,2}|\d[A-Z])\d{1,2}[A-Z]{1,4}\b/g
const NOT_QRV = /\b(?:not\s*qrv|qrt)\b/i
const NEGATIVE = /\b(?:no|nil|not)\s+(\S+)/gi

const num = (s: string): string => s.replace(',', '.')

function unitBand(n: string, unit: string): string | undefined {
  const u = unit.toLowerCase() === 'ghz' ? 'g' : unit.toLowerCase()
  return UNIT[u]?.[num(n)]
}

function listBands(list: string, unit: string | undefined): string[] {
  const nums = list.split(/\s*[/\-&+>,]\s*/).map(num)
  const micro = nums.some((n) => MICROWAVE.has(n)) && !nums.some((n) => ['2', '70', '4', '144', '432', '.70'].includes(n))
  const has23 = nums.includes('23')
  return nums.flatMap((n, i) => {
    if (i === nums.length - 1 && unit) return unitBand(n, unit) ?? []
    if (n === '1.2' && has23) return '1.25cm'
    return (micro ? BARE_MICRO[n] : undefined) ?? BARE_VHF[n] ?? []
  })
}

/** The bands in a piece of free text (a name or a message), in no order, each once. */
export function bandsInText(text: string): string[] {
  const out = new Set<string>()
  // Frequencies first, then out of the way: "144.300, 432.200" is two frequencies, not a band list.
  const s = text.replace(CALL, ' ').replace(MHZ, (f, int: string, frac: string) => {
    const b = bandForFreq(Number(`${int}.${frac}`) * 1e6)
    if (!b || !bandLetter(b)) return f
    out.add(b)
    return ' '.repeat(f.length)
  })
  const taken: [number, number][] = []
  for (const m of s.matchAll(LIST)) {
    for (const b of listBands(m[1]!, m[2])) out.add(b)
    taken.push([m.index!, m.index! + m[0].length])
  }
  const free = (i: number): boolean => !taken.some(([a, b]) => i >= a && i < b)
  for (const m of s.matchAll(WITH_UNIT)) {
    const b = free(m.index!) ? unitBand(m[1]!, m[2]!) : undefined
    if (b) out.add(b)
  }
  for (const m of s.matchAll(KHZ)) {
    const b = bandForFreq(Number(m[1]) * 1e3)
    if (b && bandLetter(b)) out.add(b)
  }
  return [...out]
}

/** What a message says about its writer: bands it is on, and bands it isn't ("no 23",
 *  "nil 70"); "not qrv" / "qrt" = none at all. */
export function bandsInMessage(text: string): { on: string[]; off: string[]; none: boolean } {
  if (NOT_QRV.test(text)) return { on: [], off: [], none: true }
  const off = new Set<string>()
  let rest = text
  for (const m of text.matchAll(NEGATIVE)) {
    // After no / nil a bare number is a band too ("no 23"); elsewhere "23" alone is not.
    const word = num(m[1]!.replace(/[^\da-z]+$/i, ''))
    const bare = BARE_VHF[word]
    const bands = bandsInText(m[1]!).concat(bare ? [bare] : [])
    if (bands.length === 0) continue
    for (const b of bands) off.add(b)
    rest = rest.replace(m[0], ' ')
  }
  return { on: bandsInText(rest).filter((b) => !off.has(b)), off: [...off], none: false }
}

/** Band letters, sorted, once each ('CEG'); '' for none. */
function letters(bands: Iterable<string>): string {
  return [...new Set([...bands].flatMap((b) => bandLetter(b) ?? []))].sort().join('')
}

/** QRV letters per station (base call) from the chat: its name, then its messages oldest
 *  first (a later "no 23" drops 23 again), and the bands of skeds sent to it. */
export function chatQrv(chat: KstState): Map<string, string> {
  const bands = new Map<string, Set<string>>()
  const of = (call: string): Set<string> => {
    const c = baseCall(call)
    let s = bands.get(c)
    if (!s) bands.set(c, (s = new Set()))
    return s
  }
  for (const u of chat.users.values()) {
    if (NOT_QRV.test(u.name)) continue
    for (const b of bandsInText(u.name)) of(u.call).add(b)
  }
  for (const m of chat.messages) {
    const said = bandsInMessage(m.text)
    const mine = of(m.call)
    if (said.none) mine.clear()
    for (const b of said.off) mine.delete(b)
    for (const b of said.on) mine.add(b)
    // A sked on 432.2 sent to a station: it is on 70 cm too.
    if (m.to) for (const b of said.on) of(m.to).add(b)
  }
  const out = new Map<string, string>()
  for (const [c, s] of bands) {
    const l = letters(s)
    if (l) out.set(c, l)
  }
  return out
}
