import XCTest

/// App Store screenshots: drives the app like a user and attaches a screenshot at each
/// step (the CI exports them from the result bundle). The Simulator is prepared by
/// .github/workflows/ios-screenshots.yml: two demo logs in Documents/logs (written by
/// web/scripts/demo-logs.ts), "what's new" already seen, a clean status bar.
final class Screenshots: XCTestCase {
    private var app: XCUIApplication!
    private var web: XCUIElement { app.webViews.firstMatch }

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        // iPad in landscape: the wide layout, recent QSOs beside the keyboard.
        if UIDevice.current.userInterfaceIdiom == .pad { XCUIDevice.shared.orientation = .landscapeLeft }
    }

    func testScreenshots() {
        app.launch()

        // 1. The log list.
        let vhf = button(beginningWith: "IARU R1 VHF 2024")
        if !vhf.waitForExistence(timeout: 30) {
            // What the test sees, for the CI log and the result bundle.
            shot("0-failed-start")
            print(app.debugDescription)
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "0-tree"
            tree.lifetime = .keepAlways
            add(tree)
            XCTFail("log list not shown")
            return
        }
        shot("1-logs")

        // 2. VHF contest: a whole QSO on one line, before Enter — the parse preview with
        //    report, serial, locator and QRB.
        vhf.tap()
        XCTAssert(key("Enter").waitForExistence(timeout: 10), "logging screen not shown")
        type("OM8A 59515 JN87WV")
        shot("2-vhf-logging")

        // Save it, then the QSO list with points and the map.
        key("Enter").tap()
        key("Enter").tap()
        button(beginningWith: "QSO 61").tap()
        sleep(1)
        shot("3-vhf-qso-list")
        button(beginningWith: "Map").tap()
        sleep(5) // the coastlines take a moment to draw
        shot("4-vhf-map")

        // 3. SOTA activation: callsign suggestions while typing.
        app.terminate()
        app.launch()
        let sota = button(beginningWith: "OE/SB-257")
        XCTAssert(sota.waitForExistence(timeout: 30))
        sota.tap()
        XCTAssert(key("Enter").waitForExistence(timeout: 10))
        type("EA2D")
        sleep(1)
        shot("5-sota-suggestions")
    }

    // MARK: helpers

    /// A button of the page whose label starts with `prefix`.
    private func button(beginningWith prefix: String) -> XCUIElement {
        web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    /// A key of the app's own keyboard (letters, digits, /, and Space / Enter / Backspace).
    private func key(_ label: String) -> XCUIElement {
        web.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Type on the app's keyboard, a tap per key.
    private func type(_ text: String) {
        for ch in text {
            key(ch == " " ? "Space" : String(ch)).tap()
        }
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
