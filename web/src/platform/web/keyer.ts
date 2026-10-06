// Web Bluetooth transport for the M5-ESP32-keyer (Chrome / Edge; Linux needs
// chrome://flags/#enable-web-bluetooth). Nordic UART: write lines to RX, notifications
// from TX; Battery Service for the level. Only bytes move here — the line protocol is
// core/keyer.ts. Needs a secure context: https or http://localhost.

import type { KeyerLinkState, KeyerTransport } from '../types'

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e' // client → keyer (write)
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e' // keyer → client (notify)
const BATTERY = 'battery_service'
const BATTERY_LEVEL = 'battery_level'
const REMEMBERED = 'kqso.keyerDevice' // id of the chosen keyer, for a quiet reconnect

/** Web Bluetooth exists here (Chrome / Edge in a secure context). */
export function webBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && navigator.bluetooth !== undefined && window.isSecureContext
}

export class WebBluetoothKeyer implements KeyerTransport {
  /** Web Bluetooth does not tell the negotiated MTU; 20 bytes always fits. */
  readonly mtu = 20
  private device: BluetoothDevice | undefined
  private rx: BluetoothRemoteGATTCharacteristic | undefined
  private writes: Promise<void> = Promise.resolve()
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private dataCb: (text: string) => void = () => {}
  private stateCb: (s: KeyerLinkState, name?: string) => void = () => {}
  private batteryCb: (pct: number) => void = () => {}

  onData(cb: (text: string) => void): void {
    this.dataCb = cb
  }

  onState(cb: (s: KeyerLinkState, name?: string) => void): void {
    this.stateCb = cb
  }

  onBattery(cb: (pct: number) => void): void {
    this.batteryCb = cb
  }

  async connect(pick: boolean): Promise<boolean> {
    const bt = navigator.bluetooth
    if (!bt) return false
    let dev = this.device
    if (pick) {
      // Either filter matches: the service UUID or the keyer-XXXX name (scan response).
      dev = await bt.requestDevice({
        filters: [{ services: [NUS] }, { namePrefix: 'keyer-' }],
        optionalServices: [NUS, BATTERY],
      })
    } else if (!dev) {
      dev = await this.remembered()
    }
    if (!dev) return false
    this.attach(dev)
    this.stateCb('connecting', dev.name)
    try {
      const server = await dev.gatt!.connect()
      const svc = await server.getPrimaryService(NUS)
      const tx = await svc.getCharacteristic(TX)
      this.rx = await svc.getCharacteristic(RX)
      tx.addEventListener('characteristicvaluechanged', this.onTx)
      await tx.startNotifications()
      await this.watchBattery(server)
      safeSet(REMEMBERED, dev.id)
      this.stateCb('on', dev.name)
      return true
    } catch (e) {
      this.rx = undefined
      if (dev.gatt?.connected) dev.gatt.disconnect()
      this.stateCb('off', dev.name)
      throw e
    }
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect()
    else this.stateCb('off', this.device?.name)
  }

  async forget(): Promise<void> {
    await this.disconnect()
    try {
      await this.device?.forget?.()
    } catch {
      // Older Chrome without forget(): the permission just stays.
    }
    this.device = undefined
    safeRemove(REMEMBERED)
  }

  write(chunk: string): void {
    const rx = this.rx
    if (!rx) return
    // One GATT write at a time, in order (with response, so order is kept end to end).
    this.writes = this.writes.then(() => rx.writeValueWithResponse(this.encoder.encode(chunk))).catch(() => {})
  }

  /** The keyer picked last time, if Chrome lets the page see it again (getDevices). */
  private async remembered(): Promise<BluetoothDevice | undefined> {
    const id = safeGet(REMEMBERED)
    if (!id || !navigator.bluetooth?.getDevices) return undefined
    try {
      return (await navigator.bluetooth.getDevices()).find((d) => d.id === id)
    } catch {
      return undefined
    }
  }

  private attach(dev: BluetoothDevice): void {
    if (this.device === dev) return
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected)
    this.device = dev
    dev.addEventListener('gattserverdisconnected', this.onDisconnected)
  }

  private async watchBattery(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const level = await (await server.getPrimaryService(BATTERY)).getCharacteristic(BATTERY_LEVEL)
      level.addEventListener('characteristicvaluechanged', () => {
        if (level.value) this.batteryCb(level.value.getUint8(0))
      })
      await level.startNotifications()
      this.batteryCb((await level.readValue()).getUint8(0))
    } catch {
      // No battery service (or not permitted): the status just shows no percentage.
    }
  }

  private readonly onTx = (e: Event): void => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value
    if (v) this.dataCb(this.decoder.decode(v))
  }

  private readonly onDisconnected = (): void => {
    this.rx = undefined
    this.writes = Promise.resolve()
    this.stateCb('off', this.device?.name)
  }
}

// localStorage can throw (private window, blocked site data): the keyer then just
// is not remembered across reloads.
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* not remembered */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to forget */
  }
}
