// Demo logs for the App Store screenshots (ios/screenshots, the iOS UI test): two real
// logs of OK1CDJ written by kQSO's own ADIF writer, so they open in the app as if logged
// there. The UI test then logs a few more QSOs on top.
//
//   npx vite-node scripts/demo-logs.ts -- <out dir>
// writes <out>/<id>.adi; the CI copies them into the Simulator's Documents/logs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeLogFile } from '../src/core/index'
import type { LogMeta, Qso } from '../src/core/index'

const out = process.argv[process.argv.length - 1]!
const src = join(import.meta.dirname, '../../ios/screenshots')
mkdirSync(out, { recursive: true })

const at = (date: string, hhmm: string): Date => new Date(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`)

// IARU R1 VHF contest 2024 as OL0M: QSOs 001–060 (the test logs 061 on, like the GIF).
const vkvMeta: LogMeta = {
  name: 'IARU R1 VHF 2024',
  profile: 'vkv',
  myCall: 'OL0M',
  myGrid: 'JN89ER',
  defaultSignal: { band: '2m', mode: 'SSB' },
}
const vkv: Qso[] = readFileSync(join(src, 'ol0m.edi'), 'utf8')
  .trim()
  .split('\n')
  .map((row) => row.split(';'))
  .map((f) => ({
    call: f[2]!,
    timeOn: at('2024-09-08', f[1]!),
    signal: { band: '2m', mode: f[3] === '2' ? 'CW' : 'SSB' },
    report: { sent: f[4]!, rcvd: f[6]! },
    stationCall: vkvMeta.myCall,
    myGrid: vkvMeta.myGrid,
    grid: f[9]!,
    serial: f[7]!,
    sentSerial: f[5]!,
  }))
writeFileSync(join(out, 'iaru-r1-vhf-2024-demo01.adi'), writeLogFile(vkvMeta, vkv))

// SOTA / GMA activation of OE/SB-257, 2021-06-17.
const myRef = { kind: 'SOTA' as const, value: 'OE/SB-257' }
const sotaMeta: LogMeta = {
  name: 'OE/SB-257',
  profile: 'aktivace',
  myCall: 'OE/OK1CDJ/P',
  myGrid: 'JN67QR',
  myRef,
  defaultSignal: { band: '20m', mode: 'SSB' },
}
const sota: Qso[] = readFileSync(join(src, 'oe-sb-257.txt'), 'utf8')
  .trim()
  .split('\n')
  .filter((row) => !row.startsWith('#'))
  .map((row) => row.split(';'))
  .map((f) => ({
    call: f[1]!,
    timeOn: at('2021-06-17', f[0]!),
    signal: { band: f[2]!, mode: f[3]! },
    report: { sent: f[4]!, rcvd: f[5]! },
    stationCall: sotaMeta.myCall,
    myGrid: sotaMeta.myGrid,
    myRef,
  }))
writeFileSync(join(out, 'oe-sb-257-demo02.adi'), writeLogFile(sotaMeta, sota))

console.log(`demo logs: ${vkv.length} + ${sota.length} QSOs → ${out}`)
