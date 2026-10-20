import { describe, it, expect } from 'vitest'
import { categoryFromSection, contestForDate, ediAscii, ediBand, ediBands, ediFileName, ediSection, equipmentFor, isIaruContestDate, isSixHours, parseEdiSettings, serializeEdiSettings, writeEdi } from '../src/core/edi'
import type { EdiEquipment, EdiStation } from '../src/core/edi'
import type { ContestCategory, EdiContest, LogMeta, Qso } from '../src/core/model'
import { readLogFile, writeLogFile } from '../src/core/adif/logfile'

const meta: LogMeta = {
  name: '05092026',
  profile: 'vkv',
  myCall: 'OK1CDJ/P',
  myGrid: 'JO65FR',
  defaultSignal: { band: '2m', mode: 'SSB' },
}
const contest: EdiContest = { contest: 'Provozní aktiv', section: 'so', operators: '' }
const SO: ContestCategory = { ops: 'SO', contest: 'national', variant: 'full' }
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
    expect(writeEdi(meta, log, '2m', contest, SO, station, eq2m).split('\r\n')).toEqual([
      '[REG1TEST;1]',
      'TName=Provozni aktiv',
      'TDate=20260905;20260905',
      'PCall=OK1CDJ/P',
      'PWWLo=JO65FR',
      'PExch=',
      'PAdr1=',
      'PAdr2=',
      'PSect=SO',
      'PBand=145 MHz',
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
    const edi = writeEdi(meta, log, '70cm', contest, SO, station, eq70)
    expect(edi).toContain('PBand=435 MHz')
    // Each band carries its own equipment.
    for (const l of ['STXEq=IC-9700', 'SPowe=25', 'SRXEq=IC-9700 + LNA', 'SAnte=21 el. Yagi', 'SAntH=12;650']) {
      expect(edi).toContain(l + '\r\n')
    }
    expect(edi).toContain('[QSORecords;1]\r\n260905;1447;DL5BBF;6;59;003;59;023;;JO42LT;396;;N;;\r\n')
  })

  it('7-bit ASCII, CRLF only, every line ≤ 75 characters', () => {
    const long = { ...eq2m, antenna: 'Á'.repeat(200) }
    const edi = writeEdi(meta, log, '2m', { ...contest, operators: 'ok1abc;ok1xyz' }, SO, station, long)
    expect(/^[\r\n\x20-\x7e]*$/.test(edi)).toBe(true)
    expect(edi.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of edi.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75)
    expect(edi).toContain('MOpe1=OK1ABC;OK1XYZ')
  })
})

describe('EDI helpers', () => {
  it('band labels as the ČRK rules name them; HF has none', () => {
    expect(ediBand('2m')).toBe('145 MHz')
    expect(ediBand('70cm')).toBe('435 MHz')
    expect(ediBand('23cm')).toBe('1.3 GHz')
    expect(ediBand('13cm')).toBe('2.4 GHz')
    expect(ediBand('1.25cm')).toBe('24 GHz')
    expect(ediBand('4mm')).toBe('76 GHz')
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

describe('category → PSect and the ČRK file name', () => {
  const cat = (ops: ContestCategory['ops'], iaru: boolean, variant: ContestCategory['variant']): ContestCategory => ({ ops, contest: iaru ? 'iaru' : 'national', variant })

  it('national contest: SO / MO / CHECK only, LP left to SPowe', () => {
    expect(ediSection(cat('SO', false, 'full'), '2m')).toBe('SO')
    expect(ediSection(cat('MO', false, 'lp'), '70cm')).toBe('MO')
    expect(ediSection(cat('CHECK', false, 'full'), '23cm')).toBe('CHECK')
  })
  it('IARU: LP and 6H on 145 / 435 MHz, 6H plain on 50 / 70 MHz, higher bands SO / MO', () => {
    expect(ediSection(cat('SO', true, 'lp'), '2m')).toBe('SO-LP')
    expect(ediSection(cat('MO', true, 'lp'), '70cm')).toBe('MO-LP')
    expect(ediSection(cat('SO', true, '6h'), '2m')).toBe('6H SO')
    expect(ediSection(cat('MO', true, '6h'), '70cm')).toBe('6H MO')
    expect(ediSection(cat('SO', true, '6h'), '6m')).toBe('6H')
    expect(ediSection(cat('SO', true, 'lp'), '6m')).toBe('SO')
    expect(ediSection(cat('MO', true, '6h'), '23cm')).toBe('MO')
    expect(ediSection(cat('CHECK', true, '6h'), '2m')).toBe('CHECK')
  })
  it('6 hours applies only where the section is a 6H one', () => {
    expect(isSixHours(cat('SO', true, '6h'), '2m')).toBe(true)
    expect(isSixHours(cat('SO', true, '6h'), '23cm')).toBe(false)
    expect(isSixHours(cat('SO', false, '6h'), '2m')).toBe(false)
    expect(isSixHours(undefined, '2m')).toBe(false)
  })
  it('file name: number for category + band, the call without /P', () => {
    expect(ediFileName(cat('SO', false, 'full'), '2m', 'OK1CDJ/P')).toBe('01OK1CDJ.edi')
    expect(ediFileName(cat('MO', true, 'lp'), '70cm', 'OK1KHL')).toBe('04OK1KHL.edi')
    expect(ediFileName(cat('MO', false, 'full'), '9cm', 'OK1KHL/P')).toBe('10OK1KHL.edi')
    expect(ediFileName(cat('SO', true, '6h'), '2m', 'OK1CDJ')).toBe('61OK1CDJ.edi')
    expect(ediFileName(cat('MO', true, '6h'), '70cm', 'OK1CDJ')).toBe('64OK1CDJ.edi')
    expect(ediFileName(cat('SO', true, '6h'), '23cm', 'OK1CDJ')).toBe('05OK1CDJ.edi')
    expect(ediFileName(cat('MO', false, 'full'), '6m', 'OK1CDJ')).toBe('51OK1CDJ.edi')
  })
  it('no number in the table: call and band', () => {
    expect(ediFileName(cat('SO', false, 'full'), '4m', 'OK1CDJ/P')).toBe('OK1CDJ-4m.edi')
    expect(ediFileName(cat('SO', true, '6h'), '6m', 'OK1CDJ')).toBe('OK1CDJ-6m.edi')
    expect(ediFileName(cat('CHECK', false, 'full'), '2m', 'OK1CDJ')).toBe('OK1CDJ-2m-CHECK.edi')
  })
  it('PSect in the file follows the category per band', () => {
    const six = cat('SO', true, '6h')
    expect(writeEdi(meta, log, '2m', contest, six, station, eq2m)).toContain('PSect=6H SO\r\n')
    expect(writeEdi(meta, log, '70cm', contest, cat('MO', true, 'lp'), station, eq70)).toContain('PSect=MO-LP\r\n')
  })
  it('older logs: the category from the stored PSect', () => {
    expect(categoryFromSection('SO')).toEqual(cat('SO', false, 'full'))
    expect(categoryFromSection('mo-lp')).toEqual(cat('MO', true, 'lp'))
    expect(categoryFromSection('6H')).toEqual(cat('SO', true, '6h'))
    expect(categoryFromSection('')).toEqual(cat('SO', false, 'full'))
  })
})

describe('IARU R1 contest dates (ČRK rules point 2)', () => {
  const d = (y: number, m: number, day: number): Date => new Date(Date.UTC(y, m - 1, day, 15))
  it('first full weekend of September and October', () => {
    expect(isIaruContestDate(d(2026, 9, 5))).toBe(true) // Saturday
    expect(isIaruContestDate(d(2026, 9, 6))).toBe(true) // Sunday
    expect(isIaruContestDate(d(2026, 10, 3))).toBe(true)
    expect(isIaruContestDate(d(2026, 10, 4))).toBe(true)
    expect(isIaruContestDate(d(2026, 9, 12))).toBe(false)
    expect(isIaruContestDate(d(2026, 9, 4))).toBe(false) // Friday
  })
  it('Sunday the 1st belongs to the previous month\'s weekend, not this one', () => {
    expect(isIaruContestDate(d(2024, 9, 1))).toBe(false) // Sunday 1 Sept 2024
    expect(isIaruContestDate(d(2024, 9, 7))).toBe(true)
  })
  it('50 MHz: third Saturday in June', () => {
    expect(isIaruContestDate(d(2026, 6, 20))).toBe(true)
    expect(isIaruContestDate(d(2026, 6, 21))).toBe(true)
    expect(isIaruContestDate(d(2026, 6, 13))).toBe(false)
    expect(isIaruContestDate(d(2026, 7, 4))).toBe(false) // Polní den: national
  })
})

describe('which contest a date is', () => {
  const d = (y: number, m: number, day: number): Date => new Date(Date.UTC(y, m - 1, day, 9))
  it('Provozní aktiv: third Sunday', () => {
    expect(contestForDate(d(2026, 10, 18))).toBe('pa')
    expect(contestForDate(d(2026, 11, 15))).toBe('pa')
    expect(contestForDate(d(2026, 10, 11))).toBe('national')
  })
  it('FM pohár: second Saturday', () => {
    expect(contestForDate(d(2026, 11, 14))).toBe('fm')
    expect(contestForDate(d(2026, 12, 12))).toBe('fm')
    expect(contestForDate(d(2026, 11, 7))).toBe('national')
  })
  it('IARU weekends; a June Sunday that is both is Provozní aktiv', () => {
    expect(contestForDate(d(2026, 9, 5))).toBe('iaru')
    expect(contestForDate(d(2026, 6, 20))).toBe('iaru') // 50 MHz Saturday
    expect(contestForDate(d(2026, 6, 21))).toBe('pa') // 3rd Sunday
  })
})

describe('Provozní aktiv in the EDI', () => {
  it('ring points per QSO, CToSc = points × squares incl. the own one', () => {
    const pa: ContestCategory = { ops: 'SO', contest: 'pa', variant: 'full' }
    const edi = writeEdi(meta, log, '2m', contest, pa, station, eq2m)
    // JO65FR: OZ9SIG JO65 own 2; OY9JD IP62 ten squares west → 12; OZ9SIG dupe 0.
    expect(edi).toContain(';JO65ER;2;;N;;\r\n')
    expect(edi).toContain(';IP62OA;12;;N;;\r\n')
    expect(edi).toContain('CWWLs=2;0;1\r\n')
    expect(edi).toContain('CQSOP=14\r\n')
    expect(edi).toContain('CToSc=28\r\n')
    expect(edi).toContain('PSect=SO\r\n')
  })
})

describe('contest fields in the log header', () => {
  it('the category round-trips; IARU-only variants are dropped nationally', () => {
    for (const category of [
      { ops: 'SO', contest: 'national', variant: 'full' },
      { ops: 'MO', contest: 'iaru', variant: '6h' },
      { ops: 'SO', contest: 'iaru', variant: 'lp' },
      { ops: 'CHECK', contest: 'iaru', variant: 'full' },
      { ops: 'SO', contest: 'pa', variant: 'full' },
      { ops: 'MO', contest: 'fm', variant: 'full' },
    ] as const) {
      expect(readLogFile(writeLogFile({ ...meta, category }, log)).meta.category).toEqual(category)
    }
    expect(readLogFile(writeLogFile(meta, log)).meta.category).toBeUndefined()
  })
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
