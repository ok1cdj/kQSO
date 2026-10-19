import { describe, it, expect } from 'vitest'
import { writeLogFile, writeLogHeader, readLogFile, writeRefExport, refExportName } from '../src/core/adif/logfile'
import { readAdif } from '../src/core/adif/reader'
import { writeQso } from '../src/core/adif/writer'
import type { LogMeta, Qso } from '../src/core/model'

const meta: LogMeta = {
  name: 'SOTA OK/ZC-001',
  profile: 'aktivace',
  myCall: 'OK1CDJ',
  myGrid: 'JN79US',
  myRefs: [{ kind: 'SOTA', value: 'OK/ZC-001' }],
  defaultSignal: { band: '40m', mode: 'SSB' },
}

const qso: Qso = {
  call: 'OK2XYZ',
  timeOn: new Date('2026-09-22T14:32:07Z'),
  signal: { band: '40m', mode: 'SSB' },
  report: { sent: '59', rcvd: '59' },
  stationCall: 'OK1CDJ',
  myGrid: 'JN79US',
  theirRef: { kind: 'SOTA', value: 'OK/ZC-014' },
  myRefs: [{ kind: 'SOTA', value: 'OK/ZC-001' }],
}

describe('log-file codec (meta in ADIF header)', () => {
  it('roundtrips meta + QSOs', () => {
    const parsed = readLogFile(writeLogFile(meta, [qso]))
    expect(parsed.meta).toEqual(meta)
    expect(parsed.qsos).toEqual([qso])
    expect(parsed.count).toBe(1)
  })

  it('an empty log (header only) roundtrips meta with zero QSOs', () => {
    const parsed = readLogFile(writeLogHeader(meta))
    expect(parsed.meta).toEqual(meta)
    expect(parsed.count).toBe(0)
  })

  it('appending a record line to the header yields a readable log', () => {
    // Simulates platform.appendQso: header + '\n' + one record line.
    const file = writeLogHeader(meta) + writeQso(qso) + '\n'
    const parsed = readLogFile(file)
    expect(parsed.count).toBe(1)
    expect(parsed.qsos[0]!.call).toBe('OK2XYZ')
  })

  it('roundtrips the Obecný profile without a reference', () => {
    const m: LogMeta = {
      name: 'Denní log',
      profile: 'obecny',
      myCall: 'OK1CDJ',
      myGrid: 'JN79US',
      defaultSignal: { band: '20m', mode: 'CW' },
    }
    const parsed = readLogFile(writeLogFile(m, []))
    expect(parsed.meta).toEqual(m)
    expect(parsed.meta.myRefs).toBeUndefined()
  })

  it('several references in the header, ; separated', () => {
    const m: LogMeta = {
      ...meta,
      myRefs: [
        { kind: 'SOTA', value: 'OK/JC-001' },
        { kind: 'POTA', value: 'CZ-0123' },
        { kind: 'POTA', value: 'CZ-0124' },
      ],
    }
    const text = writeLogHeader(m)
    expect(text).toContain('<APP_KQSO_MYREF:40>SOTA OK/JC-001;POTA CZ-0123;POTA CZ-0124')
    expect(readLogFile(text).meta).toEqual(m)
  })

  it('a log from before several references reads its one reference', () => {
    const text = '<APP_KQSO_PROFILE:8>aktivace <APP_KQSO_MYREF:14>SOTA OK/ZC-001 <EOH>\n'
    expect(readLogFile(text).meta.myRefs).toEqual([{ kind: 'SOTA', value: 'OK/ZC-001' }])
  })

  it('a per-reference export carries only that reference, without the kQSO header', () => {
    const both: Qso = { ...qso, myRefs: [{ kind: 'SOTA', value: 'OK/ZC-001' }, { kind: 'POTA', value: 'CZ-0123' }] }
    const park = { kind: 'POTA', value: 'CZ-0123' } as const
    const text = writeRefExport([both, both], park)
    expect(text).not.toContain('APP_KQSO')
    expect(text).not.toContain('MY_SOTA_REF')
    expect(readAdif(text).qsos.map((q) => q.myRefs)).toEqual([[park], [park]])
    expect(refExportName('20261019', { kind: 'SOTA', value: 'OK/ZC-001' })).toBe('20261019-OK-ZC-001.adi')
  })
})
