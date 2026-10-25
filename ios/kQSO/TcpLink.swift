import Foundation
import Network

/// Plain TCP text link for the ON4KST chat (web/src/platform/native.ts NativeTcp) — the
/// iOS twin of the Android TcpLink.kt. Only text moves here; the protocol is in the web
/// core (core/kst.ts). One connection at a time: connect closes the previous one. Only
/// the ON4KST port may be opened.
///
/// Results go back to JS as window.__kqsoTcp.{state,data}(…):
///  - state('connecting' | 'on' | 'off', reason) — off only when it dropped by itself:
///    close() stays quiet (a late 'off' would land on the page's next connection)
///  - data(text) — UTF-8 text as it arrives
///
/// Everything runs on the main queue; callbacks of a replaced connection are ignored.
final class TcpLink {
    private weak var owner: Bridge?
    private var conn: NWConnection?
    private var pending = Data() // the start of a UTF-8 character split between reads

    // Mirrors KST_HOST / KST_PORT in web/src/core/kst.ts.
    private static let host = "www.on4kst.org"
    private static let port: UInt16 = 23001

    init(owner: Bridge) {
        self.owner = owner
    }

    func connect(host: String, port: Int) {
        drop()
        state("connecting", nil)
        guard host == Self.host, port == Int(Self.port), let p = NWEndpoint.Port(rawValue: Self.port) else {
            return state("off", "not allowed")
        }
        let tcp = NWProtocolTCP.Options()
        tcp.connectionTimeout = 15
        let c = NWConnection(host: NWEndpoint.Host(host), port: p, using: NWParameters(tls: nil, tcp: tcp))
        conn = c
        pending = Data()
        c.stateUpdateHandler = { [weak self] s in
            guard let self, self.conn === c else { return }
            switch s {
            case .ready:
                self.state("on", nil)
                self.receive(c)
            case let .waiting(error), let .failed(error):
                // .waiting would retry by itself; the page has its own reconnect.
                self.ended(c, error.localizedDescription)
            default:
                break
            }
        }
        c.start(queue: .main)
    }

    func close() {
        drop()
    }

    func write(_ text: String) {
        guard let c = conn else { return }
        c.send(content: Data(text.utf8), completion: .contentProcessed { _ in
            // A failed send shows up as a failed connection.
        })
    }

    private func receive(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self, self.conn === c else { return }
            if let data, !data.isEmpty { self.decode(data) }
            if let error { return self.ended(c, error.localizedDescription) }
            if isComplete { return self.ended(c, "closed") }
            self.receive(c)
        }
    }

    /// Hands on whole UTF-8 characters; an incomplete one at the end waits for the next read.
    private func decode(_ data: Data) {
        var buf = pending + data
        let keep = Self.incompleteTail(buf)
        pending = buf.suffix(keep)
        buf.removeLast(keep)
        if !buf.isEmpty { call("data", WebViewController.jsString(String(decoding: buf, as: UTF8.self))) }
    }

    /// How many bytes at the end start a UTF-8 character that isn't complete yet.
    static func incompleteTail(_ d: Data) -> Int {
        let bytes = [UInt8](d.suffix(3))
        guard !bytes.isEmpty else { return 0 }
        for back in 1 ... bytes.count {
            let b = bytes[bytes.count - back]
            if b & 0xC0 == 0x80 { continue } // continuation byte: look further back
            let need = b & 0xE0 == 0xC0 ? 2 : b & 0xF0 == 0xE0 ? 3 : b & 0xF8 == 0xF0 ? 4 : 1
            return need > back ? back : 0
        }
        return 0
    }

    /// The connection `c` ended by itself: off with the reason, unless it was replaced.
    private func ended(_ c: NWConnection, _ reason: String) {
        guard conn === c else { return }
        drop()
        state("off", reason)
    }

    private func drop() {
        conn?.stateUpdateHandler = nil
        conn?.cancel()
        conn = nil
        pending = Data()
    }

    private func state(_ s: String, _ reason: String?) {
        call("state", WebViewController.jsString(s), reason.map(WebViewController.jsString) ?? "undefined")
    }

    private func call(_ fn: String, _ args: String...) {
        owner?.evalJs("window.__kqsoTcp && window.__kqsoTcp.\(fn)(\(args.joined(separator: ",")))")
    }
}
