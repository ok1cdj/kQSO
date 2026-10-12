import UIKit
import WebKit

/// The whole app: one WKWebView with the bundled web app (kqso://app/), inside the safe
/// area. The page reaches Swift through the `kqso` message handler (Bridge); Swift calls
/// back with evalJs (BLE events), like the Android shell (MainActivity.kt).
final class WebViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    private var webView: WKWebView!
    private let bridge = Bridge()
    private var dark = false

    override var preferredStatusBarStyle: UIStatusBarStyle { dark ? .lightContent : .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        bridge.vc = self

        let content = WKUserContentController()
        content.addScriptMessageHandler(bridge, contentWorld: .page, name: "kqso")
        // What the page reads synchronously (platform/ios.ts): set before any script runs.
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let info = "window.KQSOIos = { appVersion: \(Self.jsString(version)), displayMode: 'standard' };"
        content.addUserScript(WKUserScript(source: info, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(), forURLScheme: SchemeHandler.scheme)
        config.userContentController = content

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: safe.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
        ])
        webView.load(URLRequest(url: SchemeHandler.start))
    }

    // MARK: called by Bridge / BleLink

    func evalJs(_ script: String) {
        DispatchQueue.main.async { self.webView.evaluateJavaScript(script, completionHandler: nil) }
    }

    /// Dark page theme: the safe-area margins and the status bar follow it.
    func setDarkBars(_ on: Bool) {
        dark = on
        view.backgroundColor = on ? UIColor(red: 0x13 / 255, green: 0x13 / 255, blue: 0x13 / 255, alpha: 1) : .white
        setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: links out of the app open in Safari

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.allow) }
        if scheme == SchemeHandler.scheme || scheme == "about" || scheme == "blob" || scheme == "data" {
            return decisionHandler(.allow)
        }
        if ["http", "https", "mailto"].contains(scheme) { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }

    /// target=_blank / window.open: Safari, never a second web view.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    /// The web content process can be killed in the background; start over.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: alert / confirm / prompt (delete confirmations, the EDI export questions)

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: L.cancel, style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: L.cancel, style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }

    /// A Swift string as a JS string literal.
    static func jsString(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]), let json = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return String(json.dropFirst().dropLast()) // ["…"] → "…"
    }
}

/// The few native strings: Czech when the system is Czech, else English (as the web UI).
enum L {
    static let cs = Locale.preferredLanguages.first?.hasPrefix("cs") ?? false
    static var cancel: String { cs ? "Zrušit" : "Cancel" }
}
