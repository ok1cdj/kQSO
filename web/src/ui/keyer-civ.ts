// Any Icom through the M5-ESP32-keyer's CI-V bus (firmware 2.1.0+, PROTOCOL.md "CI-V
// tunnel"): a RigTransport over the keyer's link, so RigController drives it like the
// IC-705's own Bluetooth. Frames go out as CIVTX <hex>, come back as CIVRX <hex>; the
// keyer finds the bus rate and the radio's address itself and readdresses our frames.
// FREQ ON tells when the keyer has found the radio (FREQ <Hz>) or lost it (FREQ NONE).

import { toHex, versionAtLeast } from '../core/index'
import type { KeyerLinkState, RigTransport } from '../platform/index'

/** First firmware with the tunnel. */
export const CIV_FIRMWARE = '2.1.0'

/** What the transport needs from the keyer controller (ui/keyer.ts). */
export interface KeyerCivHost {
  readonly link: KeyerLinkState
  readonly name: string | undefined
  readonly version: string | undefined
  /** Start the keyer link for CI-V (`pick` = chooser); resolves false when there was no keyer to try. */
  civConnect(pick: boolean): Promise<boolean>
  /** CI-V no longer wanted: the link stays only when CW keying uses it. */
  civDisconnect(): Promise<void>
  forget(): Promise<void>
  /** One protocol line; resolves with the response. */
  command(line: string): Promise<string>
}

export class KeyerCivTransport implements RigTransport {
  /** A CIVTX line carries a whole frame (≤ 38 bytes); RigController never splits one. */
  readonly mtu = 64
  /** The radio's CI-V address as the keyer found it (CIV query), undefined until known. */
  addr: number | undefined
  /** The keyer is connected but its firmware has no tunnel. */
  oldFirmware = false
  state: KeyerLinkState = 'off'

  private dataCb: (bytes: Uint8Array) => void = () => {}
  private stateCb: (s: KeyerLinkState, name?: string) => void = () => {}
  private wanted = false
  private tunnel = false // CIVRX / FREQ ON accepted on this keyer connection
  private rigHz: number | undefined // last FREQ: the keyer has a radio
  private asking = false // a CIV query is on its way

  constructor(private readonly host: KeyerCivHost) {}

  async connect(pick: boolean): Promise<boolean> {
    this.wanted = true
    if (this.host.link === 'on') {
      void this.keyerUp()
      return true
    }
    return this.host.civConnect(pick)
  }

  async disconnect(): Promise<void> {
    this.wanted = false
    if (this.tunnel && this.host.link === 'on') {
      await this.host.command('CIVRX OFF').catch(() => {})
      await this.host.command('FREQ OFF').catch(() => {})
    }
    this.tunnel = false
    this.rigHz = undefined
    this.set('off')
    await this.host.civDisconnect()
  }

  async forget(): Promise<void> {
    this.wanted = false
    this.set('off')
    await this.host.forget()
  }

  write(bytes: Uint8Array): void {
    if (!this.tunnel) return
    // OK = queued; an answer (or none: the command times out in CivProtocol) comes as CIVRX.
    void this.host.command(`CIVTX ${toHex(bytes).toUpperCase()}`).catch(() => {})
  }

  onData(cb: (bytes: Uint8Array) => void): void {
    this.dataCb = cb
  }

  onState(cb: (s: KeyerLinkState, name?: string) => void): void {
    this.stateCb = cb
  }

  // --- from the keyer controller -------------------------------------------------

  /** Keyer link up (version known): open the tunnel when CI-V is wanted. */
  async keyerUp(): Promise<void> {
    if (!this.wanted || this.tunnel) return
    this.set('connecting')
    if (!versionAtLeast(this.host.version, CIV_FIRMWARE)) {
      this.oldFirmware = true
      this.stateCb('connecting', this.host.name) // the same state, but Settings now has something to say
      return
    }
    this.oldFirmware = false
    try {
      if ((await this.host.command('CIVRX ON')) !== 'OK') return
      if ((await this.host.command('FREQ ON')) !== 'OK') return
    } catch {
      return // link dropped meanwhile
    }
    this.tunnel = true
    await this.queryAddr()
    this.update()
  }

  keyerConnecting(): void {
    if (this.wanted) this.set('connecting')
  }

  keyerDown(): void {
    this.tunnel = false
    this.rigHz = undefined
    this.oldFirmware = false
    this.set('off')
  }

  onFreq(hz: number | undefined): void {
    this.rigHz = hz
    if (hz !== undefined && this.addr === undefined) void this.queryAddr().then(() => this.update())
    else this.update()
  }

  onCiv(bytes: Uint8Array): void {
    if (this.state === 'on') this.dataCb(bytes)
  }

  // ------------------------------------------------------------------------------

  /** CIV → "CIV AUTO 19200 58" / "CIV FIXED 9600 4D" / "CIV AUTO - -" / "CIV OFF". */
  private async queryAddr(): Promise<void> {
    if (this.asking) return
    this.asking = true
    try {
      const r = await this.host.command('CIV')
      const m = /^CIV \S+ \S+ ([0-9A-F]{2})$/i.exec(r)
      if (m) this.addr = parseInt(m[1]!, 16)
    } catch {
      // link dropped
    } finally {
      this.asking = false
    }
  }

  /** On once the keyer has a radio and we know its address. */
  private update(): void {
    if (!this.tunnel) return
    this.set(this.rigHz !== undefined && this.addr !== undefined ? 'on' : 'connecting')
  }

  private set(s: KeyerLinkState): void {
    if (s === this.state) return
    this.state = s
    this.stateCb(s, this.host.name)
  }
}
