import UIKit
import WebKit

/// The page's calls (platform/ios.ts): postMessage({op, args}) with a reply, the same
/// operations as the Android bridge (KQSOBridge.kt). Runs on the main thread.
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var vc: WebViewController?
    private let storage = Storage()
    private lazy var keyer = BleLink(spec: .keyer, owner: self)
    private lazy var rig = BleLink(spec: .ic705, owner: self)

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return replyHandler(nil, "bad message")
        }
        let args = body["args"] as? [Any] ?? []
        func str(_ i: Int) -> String {
            guard i < args.count else { return "" }
            return args[i] as? String ?? "\(args[i])"
        }
        func bool(_ i: Int) -> Bool { i < args.count ? (args[i] as? Bool ?? false) : false }
        let ok: () -> Void = { replyHandler(nil, nil) }

        switch op {
        case "isPersisted": replyHandler(true, nil) // real files in the app's Documents
        case "list": replyHandler(storage.list(), nil)
        case "createHeader": storage.createHeader(str(0), str(1)); ok()
        case "append": storage.append(str(0), str(1)); ok()
        case "read": replyHandler(storage.read(str(0)), nil)
        case "rewrite": storage.rewrite(str(0), str(1)); ok()
        case "remove": storage.remove(str(0)); ok()
        case "writeJournal": storage.writeJournal(str(0), str(1)); ok()
        case "readJournal": replyHandler(storage.readJournal(str(0)), nil)
        case "clearJournal": storage.clearJournal(str(0)); ok()
        case "getSetting": replyHandler(storage.getSetting(str(0)), nil) // nil → null / undefined
        case "setSetting": storage.setSetting(str(0), str(1)); ok()
        case "readCallDb": replyHandler(storage.readCallDb(), nil)
        case "writeCallDb": storage.writeCallDb(str(0)); ok()
        case "exportLog", "shareLog":
            if let vc { Share.file(storage.read(str(0)), named: str(1), from: vc) }
            ok()
        case "exportText":
            if let vc { Share.file(str(0), named: str(1), from: vc) }
            ok()
        case "keepAwake": UIApplication.shared.isIdleTimerDisabled = bool(0); ok()
        case "setDarkBars": vc?.setDarkBars(bool(0)); ok()
        case "keyerConnect": keyer.connect(pick: bool(0)); ok()
        case "keyerDisconnect": keyer.disconnect(); ok()
        case "keyerForget": keyer.forget(); ok()
        case "keyerWrite": keyer.write(str(0)); ok()
        case "rigConnect": rig.connect(pick: bool(0)); ok()
        case "rigDisconnect": rig.disconnect(); ok()
        case "rigForget": rig.forget(); ok()
        case "rigWrite": rig.write(str(0)); ok()
        default: replyHandler(nil, "unknown op \(op)")
        }
    }

    // MARK: for BleLink

    func evalJs(_ script: String) { vc?.evalJs(script) }
    var presenter: UIViewController? { vc }
}
