import CoreBluetooth
import UIKit

/// What tells one BLE device kind from another; everything else in BleLink is shared.
/// The iOS twin of BleSpec in the Android BleLink.kt.
struct BleSpec {
    let service: CBUUID
    let write: CBUUID
    let notify: CBUUID // may equal write (IC-705: one characteristic both ways)
    let battery: Bool // read + watch the Battery Service level
    let withResponse: Bool // write type
    let binary: Bool // bytes as hex strings to/from JS; else UTF-8 text
    let namePrefix: String // chooser: also list devices that only advertise their name
    let prefKey: String // remembered peripheral identifier (iOS has no MAC)
    let jsObject: String // window.<jsObject>.{state,data,battery,done}
    let mtuKey: String // window.KQSOIos.<mtuKey>, read synchronously by the page
    let searching: () -> String
    let choose: () -> String
    let none: () -> String
    let notDevice: () -> String

    private static let nus = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    private static let icom = CBUUID(string: "14CF8001-1EC2-D408-1B04-2EB270F14203")
    private static let icomData = CBUUID(string: "14CF8002-1EC2-D408-1B04-2EB270F14203")

    /// M5-ESP32-keyer: Nordic UART, lines written to RX, notifications from TX.
    static let keyer = BleSpec(
        service: nus,
        write: CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"),
        notify: CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"),
        battery: true,
        withResponse: true,
        binary: false,
        namePrefix: "keyer-",
        prefKey: "keyerPeripheral",
        jsObject: "__kqsoKeyer",
        mtuKey: "keyerMtu",
        searching: { L.cs ? "Hledám klíčovač…" : "Searching for the keyer…" },
        choose: { L.cs ? "Vyber klíčovač" : "Choose the keyer" },
        none: { L.cs ? "Klíčovač nenalezen — je zapnutý?" : "No keyer found — is it on?" },
        notDevice: { L.cs ? "Zařízení není klíčovač (chybí UART služba)" : "The device is not a keyer (no UART service)" }
    )

    /// Icom IC-705: CI-V over Icom's BLE serial, one characteristic both ways. Writes
    /// without response — with response the radio drops the link after the handshake.
    static let ic705 = BleSpec(
        service: icom,
        write: icomData,
        notify: icomData,
        battery: false,
        withResponse: false,
        binary: true,
        namePrefix: "ICOM BT",
        prefKey: "rigPeripheral",
        jsObject: "__kqsoRig",
        mtuKey: "rigMtu",
        searching: { L.cs ? "Hledám IC-705… (na rádiu Bluetooth Set → Pairing Reception)" : "Searching for the IC-705… (radio: Bluetooth Set → Pairing Reception)" },
        choose: { L.cs ? "Vyber IC-705" : "Choose the IC-705" },
        none: { L.cs ? "IC-705 nenalezen — má zapnutý Bluetooth a Pairing Reception?" : "No IC-705 found — is its Bluetooth on and Pairing Reception open?" },
        notDevice: { L.cs ? "Zařízení není IC-705 (chybí sériová služba Icom)" : "The device is not an IC-705 (no Icom serial service)" }
    )
}

private let batteryService = CBUUID(string: "180F")
private let batteryLevel = CBUUID(string: "2A19")

/// One BLE device for the web side (platform/native.ts NativeLink): connect, write,
/// hand back what arrives. Only bytes move here — the protocols are in the web core.
///
/// Results go back to JS as window.<jsObject>.{state,data,battery,done}(…), exactly as
/// from the Android BleLink.kt:
///  - state('off' | 'connecting' | 'on', name)
///  - data(text) — UTF-8 text, or lowercase hex for a binary spec
///  - done(tried, error) answers each connect(): tried = false when there was no device
///    to try (nothing remembered / Bluetooth off for a quiet reconnect),
///    error = null | 'cancelled' (chooser closed) | a message.
/// Everything runs on the main queue.
final class BleLink: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private let spec: BleSpec
    private weak var owner: Bridge?
    private var central: CBCentralManager?
    private var whenPoweredOn: [() -> Void] = []

    private var peripheral: CBPeripheral?
    private var rx: CBCharacteristic?
    private var name: String?
    private var connectPending = false

    private var queue: [Data] = [] // writes waiting for the previous one
    private var writing = false

    private var picker: DevicePicker?
    private var found: [CBPeripheral] = []
    private var scanTimer: Timer?

    init(spec: BleSpec, owner: Bridge) {
        self.spec = spec
        self.owner = owner
    }

    // MARK: bridge

    func connect(pick: Bool) {
        if peripheral != nil { return done(true, nil) } // already connecting / connected
        withCentral { [self] state in
            switch state {
            case .poweredOn:
                if pick { choose() } else { quietConnect() }
            case .unauthorized:
                done(pick, L.cs ? "Oprávnění pro Bluetooth nepovoleno" : "Bluetooth permission not granted")
            case .unsupported:
                done(pick, L.cs ? "Zařízení nemá Bluetooth" : "This device has no Bluetooth")
            default:
                done(pick, L.cs ? "Bluetooth je vypnutý" : "Bluetooth is off")
            }
        }
    }

    func disconnect() {
        guard let p = peripheral else { return state("off") }
        if connectPending { done(true, "cancelled") }
        central?.cancelPeripheralConnection(p)
        dropped(nil) // don't wait for the callback
    }

    func forget() {
        UserDefaults.standard.removeObject(forKey: spec.prefKey)
        disconnect()
    }

    func write(_ chunk: String) {
        let data = spec.binary ? Self.fromHex(chunk) : Data(chunk.utf8)
        queue.append(data)
        pump()
    }

    // MARK: central

    /// The manager is created on first use (that is when iOS asks for Bluetooth), and
    /// its state is only known after the first update.
    private func withCentral(_ then: @escaping (CBManagerState) -> Void) {
        if let c = central, c.state != .unknown, c.state != .resetting { return then(c.state) }
        whenPoweredOn.append { [weak self] in then(self?.central?.state ?? .unknown) }
        if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        let waiting = whenPoweredOn
        whenPoweredOn = []
        waiting.forEach { $0() }
        if c.state != .poweredOn, peripheral != nil { dropped(nil) }
    }

    private func quietConnect() {
        guard let id = UserDefaults.standard.string(forKey: spec.prefKey).flatMap(UUID.init(uuidString:)),
              let p = central?.retrievePeripherals(withIdentifiers: [id]).first
        else { return done(false, nil) }
        open(p)
    }

    private func open(_ p: CBPeripheral) {
        name = p.name ?? name
        connectPending = true
        peripheral = p
        p.delegate = self
        state("connecting")
        central?.connect(p)
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        guard p == peripheral else { return }
        p.discoverServices(spec.battery ? [spec.service, batteryService] : [spec.service])
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        guard p == peripheral else { return }
        dropped(error?.localizedDescription)
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        guard p == peripheral else { return }
        dropped(nil)
    }

    // MARK: peripheral

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard p == peripheral else { return }
        guard let svc = p.services?.first(where: { $0.uuid == spec.service }) else {
            central?.cancelPeripheralConnection(p)
            return dropped(spec.notDevice())
        }
        p.discoverCharacteristics([spec.write, spec.notify], for: svc)
        if let bat = p.services?.first(where: { $0.uuid == batteryService }) {
            p.discoverCharacteristics([batteryLevel], for: bat)
        }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor svc: CBService, error: Error?) {
        guard p == peripheral else { return }
        if svc.uuid == batteryService, let level = svc.characteristics?.first(where: { $0.uuid == batteryLevel }) {
            p.setNotifyValue(true, for: level)
            p.readValue(for: level)
            return
        }
        guard svc.uuid == spec.service,
              let w = svc.characteristics?.first(where: { $0.uuid == spec.write }),
              let n = svc.characteristics?.first(where: { $0.uuid == spec.notify })
        else {
            central?.cancelPeripheralConnection(p)
            return dropped(spec.notDevice())
        }
        rx = w
        p.setNotifyValue(true, for: n)
    }

    /// Notifications on: the link is up. The page reads the MTU synchronously.
    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor c: CBCharacteristic, error: Error?) {
        guard p == peripheral, c.uuid == spec.notify, connectPending else { return }
        if let error { central?.cancelPeripheralConnection(p); return dropped(error.localizedDescription) }
        let mtu = p.maximumWriteValueLength(for: spec.withResponse ? .withResponse : .withoutResponse)
        js("window.KQSOIos && (window.KQSOIos.\(spec.mtuKey) = \(max(20, mtu)))")
        connectPending = false
        state("on")
        done(true, nil)
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard p == peripheral, let v = c.value, !v.isEmpty else { return }
        if c.uuid == spec.notify {
            let text = spec.binary ? Self.toHex(v) : String(decoding: v, as: UTF8.self)
            call("data", WebViewController.jsString(text))
        } else if c.uuid == batteryLevel {
            call("battery", String(v[v.startIndex]))
        }
    }

    // MARK: writes, in order

    private func pump() {
        guard let p = peripheral, let c = rx, !writing, !queue.isEmpty else { return }
        if spec.withResponse {
            writing = true
            p.writeValue(queue.removeFirst(), for: c, type: .withResponse)
        } else {
            while !queue.isEmpty, p.canSendWriteWithoutResponse {
                p.writeValue(queue.removeFirst(), for: c, type: .withoutResponse)
            }
        }
    }

    func peripheral(_ p: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        writing = false
        pump()
    }

    func peripheralIsReady(toSendWriteWithoutResponse p: CBPeripheral) {
        pump()
    }

    /// Link down (or never came up): report, answer a pending connect.
    private func dropped(_ error: String?) {
        peripheral?.delegate = nil
        peripheral = nil
        rx = nil
        queue.removeAll()
        writing = false
        state("off")
        if connectPending { done(true, error ?? (L.cs ? "spojení ztraceno" : "connection lost")) }
    }

    // MARK: chooser

    /// Scan for matching devices and list them live; a tap connects. Stops after 10 s.
    private func choose() {
        guard let presenter = owner?.presenter, let c = central else { return done(true, nil) }
        found = []
        let p = DevicePicker(title: spec.searching()) { [weak self] index in
            self?.pickerClosed(index)
        }
        picker = p
        presenter.present(UINavigationController(rootViewController: p), animated: true)
        c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        scanTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.central?.stopScan()
            self.picker?.showTitle(self.found.isEmpty ? self.spec.none() : self.spec.choose())
        }
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        guard picker != nil, !found.contains(p) else { return }
        let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? p.name ?? ""
        guard services.contains(spec.service) || localName.hasPrefix(spec.namePrefix) else { return }
        found.append(p)
        picker?.add(localName.isEmpty ? p.identifier.uuidString : localName)
    }

    /// index = the tapped row, nil = cancelled.
    private func pickerClosed(_ index: Int?) {
        scanTimer?.invalidate()
        central?.stopScan()
        picker = nil
        guard let i = index, i < found.count else { return done(true, "cancelled") }
        let p = found[i]
        UserDefaults.standard.set(p.identifier.uuidString, forKey: spec.prefKey)
        name = p.name
        open(p)
    }

    // MARK: to JS

    private func state(_ s: String) {
        call("state", WebViewController.jsString(s), WebViewController.jsString(name ?? ""))
    }

    private func done(_ tried: Bool, _ error: String?) {
        connectPending = false
        call("done", tried ? "true" : "false", error.map(WebViewController.jsString) ?? "null")
    }

    private func call(_ fn: String, _ args: String...) {
        js("window.\(spec.jsObject) && window.\(spec.jsObject).\(fn)(\(args.joined(separator: ",")))")
    }

    private func js(_ script: String) { owner?.evalJs(script) }

    static func toHex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

    static func fromHex(_ s: String) -> Data {
        var out = Data()
        var i = s.startIndex
        while let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex), i != s.endIndex {
            if let b = UInt8(s[i ..< j], radix: 16) { out.append(b) }
            i = j
        }
        return out
    }
}
