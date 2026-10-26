// The slice of Web Serial (Chrome / Edge on the desktop) the radio transport uses.
// TypeScript's DOM lib does not ship these types, and @types/w3c-web-serial would be a
// dependency for a dozen lines.

interface SerialPortInfo {
  readonly usbVendorId?: number
  readonly usbProductId?: number
}

interface SerialOptions {
  baudRate: number
}

interface SerialOutputSignals {
  dataTerminalReady?: boolean
  requestToSend?: boolean
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  setSignals(signals: SerialOutputSignals): Promise<void>
  getInfo(): SerialPortInfo
  forget?(): Promise<void>
}

interface Serial extends EventTarget {
  getPorts(): Promise<SerialPort[]>
  requestPort(): Promise<SerialPort>
}

interface Navigator {
  readonly serial?: Serial
}
