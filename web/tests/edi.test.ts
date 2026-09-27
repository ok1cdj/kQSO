import { describe, it, expect } from 'vitest'
import { ediAscii, ediBand, ediBands, equipmentFor, parseEdiSettings, serializeEdiSettings, writeEdi } from '../src/core/edi'
import type { EdiEquipment, EdiStation } from '../src/core/edi'
import type { EdiContest, LogMeta, Qso } from '../src/core/model'
import { readLogFile, writeLogFile } from '../src/core/adif/logfile'

const meta: LogMeta = {
  name: '05092026',
  profile: 'vkv',
  myCall: 'OK1CDJ/P',
  myGrid: 'JO65FR',
  defaultSignal: { band: '2m', mode: 'SSB' },
}
const contest: EdiContest = { contest: 'Provozní aktiv', section: 'so', operators: '' }
const station: EdiStation = { name: 'Ondřej Koloničný', email: 'ok1cdj@example.org' }
const eq2m: EdiEquipment = { power: '50 W', antenna: '9 el. Yagi', antennaHeight: '', tx: '', rx: '' }
const eq70: EdiEquipment = { power: '25', antenna: '21 el. Yagi', antennaHeight: '12;650', tx: 'IC-9700', rx: 'IC-9700 + LNA' }

let n = 0
function q(call: string, band: string, mode: string, grid: string, sentSerial: string, serial: string, rst = '59'): Qso {
  return {
    call,
    timeOn: new Date(Date.UTC(2026, 8, 5, 14, 45 + n++)),
    signal: { band, mode },
    report: { sent: rst, rcvd: rst },
    stationCall: meta.myCall,
    myGrid: meta.myGrid,
    grid,
    sentSerial,
    serial,
  }
}

const log: Qso[] = [
  q('OZ9SIG', '2m', 'SSB', 'JO65ER', '001', '6'),
  q('OY9JD', '2m', 'CW', 'IP62OA', '002', '011', '599'),
  q('DL5BBF', '70cm', 'FM', 'JO42LT', '003', '023'),
  q('OZ9SIG', '2m', 'CW', 'JO65ER', '004', '7', '599'),
]

describe('writeEdi', () => {
  it('golden file for the 2m band', () => {
    expect(writeEdi(meta, log, '2m', contest, station, eq2m).split('\r\n')).toEqual([
      '[REG1TEST;1]',
      'TName=Provozni aktiv',
      'TDate=20260905;20260905',
      'PCall=OK1CDJ/P',
      'PWWLo=JO65FR',
      'PExch=',
      'PAdr1=',
      'PAdr2=',
      'PSect=SO',
      'PBand=144 MHz',
      'PClub=',
      'RName=Ondrej Kolonicny',
      'RCall=OK1CDJ',
      'RAdr1=',
      'RAdr2=',
      'RPoCo=',
      'RCity=',
      'RCoun=',
      'RPhon=',
      'RHBBS=ok1cdj@example.org',
      'MOpe1=',
      'MOpe2=',
      'STXEq=',
      'SPowe=50',
      'SRXEq=',
      'SAnte=9 el. Yagi',
      'SAntH=',
      'CQSOs=2;1',
      'CQSOP=1308',
      'CWWLs=2;0;1',
      'CWWLB=0',
      'CExcs=0;0;1',
      'CExcB=0',
      'CDXCs=0;0;1',
      'CDXCB=0',
      'CToSc=1308',
      'CODXC=OY9JD;IP62OA;1302',
      '[Remarks]',
      '[QSORecords;3]',
      '260905;1445;OZ9SIG;1;59;001;59;006;;JO65ER;6;;N;;',
      '260905;1446;OY9JD;2;599;002;599;011;;IP62OA;1302;;N;;',
      '260905;1448;OZ9SIG;2;599;004;599;007;;JO65ER;0;;;;D',
      '',
    ])
  })

  it('one file per band: 70cm has its own records, mode code FM = 6', () => {
    const edi = writeEdi(meta, log, '70cm', contest, station, eq70)
    expect(edi).toContain('PBand=432 MHz')
    // Each band carries its own equipment.
    for (const l of ['STXEq=IC-9700', 'SPowe=25', 'SRXEq=IC-9700 + LNA', 'SAnte=21 el. Yagi', 'SAntH=12;650']) {
      expect(edi).toContain(l + '\r\n')
    }
    expect(edi).toContain('[QSORecords;1]\r\n260905;1447;DL5BBF;6;59;003;59;023;;JO42LT;396;;N;;\r\n')
  })

  it('7-bit ASCII, CRLF only, every line ≤ 75 characters', () => {
    const long = { ...eq2m, antenna: 'Á'.repeat(200) }
    const edi = writeEdi(meta, log, '2m', { ...contest, operators: 'ok1abc;ok1xyz' }, station, long)
    expect(/^[\r\n\x20-\x7e]*$/.test(edi)).toBe(true)
    expect(edi.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of edi.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75)
    expect(edi).toContain('MOpe1=OK1ABC;OK1XYZ')
  })
})

describe('EDI helpers', () => {
  it('band labels from the REG1TEST table; HF has none', () => {
    expect(ediBand('2m')).toBe('144 MHz')
    expect(ediBand('23cm')).toBe('1,3 GHz')
    expect(ediBand('40m')).toBeUndefined()
  })
  it('ediBands lists only EDI bands present in the log', () => {
    const hf = { ...log[0]!, signal: { band: '40m', mode: 'SSB' } }
    expect(ediBands([...log, hf], meta.myGrid).map((b) => b.band)).toEqual(['2m', '70cm'])
  })
  it('ediAscii drops diacritics and replaces the rest', () => {
    expect(ediAscii(' Žluťoučký kůň ')).toBe('Zlutoucky kun')
    expect(ediAscii('a€b')).toBe('a?b')
  })
})

describe('contest fields in the log header', () => {
  it('round-trip through the ADIF header', () => {
    const withEdi: LogMeta = { ...meta, edi: { contest: 'Polní den', section: 'MO', operators: 'OK1ABC' } }
    expect(readLogFile(writeLogFile(withEdi, log)).meta.edi).toEqual(withEdi.edi)
    expect(readLogFile(writeLogFile(meta, log)).meta.edi).toBeUndefined()
  })
})

describe('remembered EDI settings', () => {
  it('per-band equipment round-trips; each band prefills its own', () => {
    const saved = { station, bands: { '2m': eq2m, '70cm': eq70 } }
    const back = parseEdiSettings(serializeEdiSettings(saved))
    expect(back).toEqual(saved)
    expect(equipmentFor(back, '2m')).toEqual(eq2m)
    expect(equipmentFor(back, '70cm')).toEqual(eq70)
    expect(equipmentFor(back, '23cm')).toEqual({ power: '', antenna: '', antennaHeight: '', tx: '', rx: '' })
  })

  it('the old single set (kQSO ≤ 1.3) prefills every band until the band has its own', () => {
    const old = JSON.stringify({ name: 'Petr', email: 'p@example.org', power: '50', antenna: 'Yagi', tx: 'FT-817' })
    const s = parseEdiSettings(old)
    expect(s.station).toEqual({ name: 'Petr', email: 'p@example.org' })
    expect(equipmentFor(s, '70cm')).toEqual({ power: '50', antenna: 'Yagi', antennaHeight: '', tx: 'FT-817', rx: '' })
    const edited = parseEdiSettings(serializeEdiSettings({ ...s, bands: { '2m': eq2m } }))
    expect(equipmentFor(edited, '2m')).toEqual(eq2m)
    expect(equipmentFor(edited, '70cm').antenna).toBe('Yagi')
  })

  it('missing or broken JSON gives empty values', () => {
    for (const text of [null, '', 'not json', '[]', '{"bands": 5}']) {
      const s = parseEdiSettings(text)
      expect(s.station).toEqual({ name: '', email: '' })
      expect(s.bands).toEqual({})
    }
  })
})
