// QRV bands from ON4KST names and messages: real names from rooms 2 and 3 (2026-10-25).
import { describe, it, expect } from 'vitest'
import { bandsInMessage, bandsInText, chatQrv } from '../src/core/kst-bands'
import { KstState, parseFrame } from '../src/core/kst'

const bands = (s: string): string[] => bandsInText(s).sort()
const sorted = (...b: string[]): string[] => b.sort()

describe('bandsInText (names)', () => {
  it.each([
    ['Wini 2/4/6', ['2m', '4m', '6m']],
    ['Matt  144 / 432', ['2m', '70cm']],
    ['Ebi 2m  2x9', ['2m']],
    ['Jacky VDS 144390', ['2m']],
    ['Bert 2/70/23', ['2m', '70cm', '23cm']],
    ['Dave 1296.297', ['23cm']],
    ['Zoli 2m SSB/CW', ['2m']],
    ['Laci 2/70 horiz', ['2m', '70cm']],
    ['Emil 8/6/4/2/.70', ['6m', '4m', '2m', '70cm']],
    ['Nik only 2MnoCW', ['2m']],
    ['Markus2m11el150W', ['2m']],
    ['OK1KPA 3cm', ['3cm']],
    ['Pasi 2 & 70', ['2m', '70cm']],
    ['Hennie⚡2m', ['2m']],
    ['Rob 2-70-23', ['2m', '70cm', '23cm']],
    ['Frits 2/70 NO CW', ['2m', '70cm']],
    ['Boris 6&2m', ['6m', '2m']],
    ['Lasse6/2m 70/6cm', ['6m', '2m', '70cm', '6cm']],
    ['Andy 2m15el500w', ['2m']],
    ['Slawek 6/2/70', ['6m', '2m', '70cm']],
    ['Lasse 432.230', ['70cm']],
    ['Jan 2-70 9/16ele', ['2m', '70cm']],
    // the microwave room: 6 and 3 are centimetres there
    ['Dune Pilat 23-13', ['23cm', '13cm']],
    ['J-Paul 23/6/3', ['23cm', '6cm', '3cm']],
    ['JLouis 23/3', ['23cm', '3cm']],
    ['Sylvain upto13cm', ['13cm']],
    ['Maurice 23-3-1.2', ['23cm', '3cm', '1.25cm']],
    ['marc 23-13-6-3', ['23cm', '13cm', '6cm', '3cm']],
    ['Phil 144 > 1.2', ['2m', '23cm']],
    ['Bert 10G', ['3cm']],
  ])('%s', (name, want) => {
    expect(bands(name)).toEqual(sorted(...want))
  })

  it.each([
    'Alex',
    'Team',
    'Esteve 9 elm 80W',
    'Jean-Louis JN15',
    'Ray 4x8el 200w',
    'Enrico S=k logW',
    'Bo PNGonVHF',
    'Konstantin 2x9',
    'Gus 4x15/KW',
    'Ondrej 150W/5el',
    'DENIS /P JN28KU',
    'Frank PA2M', // a call, not 2 m
    'Bob 10M', // HF
  ])('nothing in %s', (name) => {
    expect(bandsInText(name)).toEqual([])
  })
})

describe('bandsInMessage', () => {
  it('frequencies, units and lists; times, dates and single numbers are no bands', () => {
    expect(bandsInMessage('cq 144.300').on).toEqual(['2m'])
    expect(bandsInMessage('OUI 1296.228').on).toEqual(['23cm'])
    expect(bandsInMessage('Salut Jacky ,1296,228').on).toEqual(['23cm'])
    expect(bandsInMessage('Bonjour Bernard test 23+13 QRG ?').on.sort()).toEqual(['13cm', '23cm'])
    expect(bandsInMessage('tnx qso 70cm, 23cm 1296.180?').on.sort()).toEqual(['23cm', '70cm'])
    expect(bandsInMessage('qrv 2/70').on.sort()).toEqual(['2m', '70cm'])
    for (const t of ['.377 possible ?', 'test 23?', 'RX .280', 'at 13:40 25/10', '73 JN79US']) expect(bandsInMessage(t).on).toEqual([])
  })
  it('no / nil take a band off; not qrv / qrt all of them', () => {
    expect(bandsInMessage('sri no 23, only 2m')).toEqual({ on: ['2m'], off: ['23cm'], none: false })
    expect(bandsInMessage('nil 70 here')).toMatchObject({ off: ['70cm'] })
    expect(bandsInMessage('no CW sri')).toEqual({ on: [], off: [], none: false })
    expect(bandsInMessage('walter not qrv').none).toBe(true)
  })
})

describe('chatQrv', () => {
  it('name, then messages in order, and the bands of a sked sent to a station', () => {
    const chat = new KstState('OK1CDJ')
    for (const l of [
      'UA0|2|F6IFX|Bert 2/70/23|JN18AA|0|',
      'UA0|2|DL6SAQ|walter not qrv|JO40AA|0|',
      'UA0|2|OK1RS-2|Contest|JO70FD|0|',
      'UE|2|3|',
      'CH|2|100|F6IFX|Bert|0|sri no 23 today|0|',
      'CH|2|101|OK1CDJ|Ondra|0| pse sked 432.210?|OK1RS-2|',
      'CH|2|102|OK1RS-2|Contest|0|qrv 1296.150 too|0|',
    ])
      chat.apply(parseFrame(l)!)
    const q = chatQrv(chat)
    expect(q.get('F6IFX')).toBe('CE') // 2m 70cm, 23cm taken back
    expect(q.has('DL6SAQ')).toBe(false)
    expect(q.get('OK1RS')).toBe('EG') // 70cm from the sked to it, 23cm its own
  })
})
