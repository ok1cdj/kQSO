// The ON4KST demo (call DEMO): the simulated server through the real controller and
// session — login without a password, history, stations, messages to me, an answer to
// @CALL, /SETLOC, a station joining and going away, and quiet after disconnect.
import { describe, it, expect } from 'vitest'
import { KstController } from '../../src/ui/kst'
import type { KQSOPlatform } from '../../src/platform/index'
import type { Timers } from '../../src/core/index'

class FakeTimers implements Timers {
  t = 1_800_000_000_000
  private next = 1
  private readonly due = new Map<number, { at: number; fn: () => void }>()
  set(fn: () => void, ms: number): unknown {
    const id = this.next++
    this.due.set(id, { at: this.t + ms, fn })
    return id
  }
  clear(id: unknown): void {
    this.due.delete(id as number)
  }
  get pending(): number {
    return this.due.size
  }
  advance(ms: number): void {
    const end = this.t + ms
    for (;;) {
      const first = [...this.due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!first) break
      this.due.delete(first[0])
      this.t = first[1].at
      first[1].fn()
    }
    this.t = end
  }
}

/** The platform has a real link (never touched here); the account is DEMO without a password. */
function setup() {
  const timers = new FakeTimers()
  const written: string[] = []
  const tcp = { connect: () => written.push('real'), close() {}, write() {}, onData() {}, onState() {} }
  const settings: Record<string, string> = { kstCall: 'demo', kstConsent: '1' }
  const platform = {
    tcp,
    getSetting: async (k: string) => settings[k] ?? null,
    setSetting: async (k: string, v: string) => void (settings[k] = v),
  } as unknown as KQSOPlatform
  const kst = new KstController(platform, 'kQSO test', timers, () => timers.t)
  return { kst, timers, written }
}

describe('ON4KST demo', () => {
  it('logs in without a password and fills the room, never touching the real link', async () => {
    const { kst, timers, written } = setup()
    await kst.connect()
    expect(kst.link).toBe('connecting')
    timers.advance(500)
    expect(kst.link).toBe('on')
    expect(kst.call).toBe('DEMO')
    expect(kst.chat.users.has('OK1CDJ')).toBe(true)
    expect(kst.chat.users.has('OL0M')).toBe(true)
    expect(kst.chat.users.has('DEMO')).toBe(false)
    expect(kst.chat.users.get('F6DEM')?.away).toBe(true)
    expect(kst.chat.messages.length).toBe(4)
    expect(kst.locator).toBe('JN79US')
    expect(written).toEqual([])
  })

  it('life in the room: messages to me, a station joins, one goes away', async () => {
    const { kst, timers } = setup()
    await kst.connect()
    timers.advance(500)
    timers.advance(50_000)
    expect(kst.unread).toBeGreaterThanOrEqual(1)
    expect(kst.lastForMe?.call).toBe('OL0M')
    expect(kst.chat.users.has('OK1DEM')).toBe(true)
    expect(kst.chat.users.get('OM3DEM')?.away).toBe(true)
  })

  it('@CALL text is echoed and answered; /SETLOC changes my locator', async () => {
    const { kst, timers } = setup()
    await kst.connect()
    timers.advance(500)
    expect(kst.send('@OK1RS pse sked 432.200')).toBe(true)
    timers.advance(100)
    expect(kst.chat.messages.at(-1)).toMatchObject({ call: 'DEMO', to: 'OK1RS', text: 'pse sked 432.200' })
    timers.advance(4_000)
    expect(kst.chat.messages.at(-1)).toMatchObject({ call: 'OK1RS', to: 'DEMO', forMe: true })
    expect(kst.setLocator('JO70AA')).toBe(true)
    expect(kst.locator).toBe('JO70AA')
    timers.advance(100)
    expect(kst.locator).toBe('JO70AA') // confirmed by the server's LOC frame
    expect(kst.chat.messages.at(-1)?.text).toContain('JO70AA')
  })

  it('a reconnect adds no history twice; disconnect stops everything', async () => {
    const { kst, timers } = setup()
    await kst.connect()
    timers.advance(500)
    const n = kst.chat.messages.length
    kst.disconnect()
    await kst.connect()
    timers.advance(500)
    expect(kst.link).toBe('on')
    expect(kst.chat.messages.length).toBe(n)
    kst.disconnect()
    expect(timers.pending).toBe(0)
    expect(kst.link).toBe('off')
  })
})
