// The slice of Web Bluetooth (Chrome / Edge) the keyer transport uses. TypeScript's
// DOM lib does not ship these types, and @types/web-bluetooth would be a dependency
// for a dozen lines.

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly value?: DataView
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  readValue(): Promise<DataView>
  writeValueWithResponse(value: BufferSource): Promise<void>
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string | number): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(uuid: string | number): Promise<BluetoothRemoteGATTService>
}

interface BluetoothDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: BluetoothRemoteGATTServer
  forget?(): Promise<void>
}

interface BluetoothRequestDeviceOptions {
  filters: ReadonlyArray<{ services?: Array<string | number>; namePrefix?: string }>
  optionalServices?: Array<string | number>
}

interface Bluetooth {
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>
  getDevices?(): Promise<BluetoothDevice[]>
}

interface Navigator {
  readonly bluetooth?: Bluetooth
}
