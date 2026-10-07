import UIKit

/// Export and share: the text becomes a file in tmp and goes to the share sheet, which
/// offers Save to Files, Mail, AirDrop… — iOS has no separate "save as" dialog here.
enum Share {
    static func file(_ content: String, named filename: String, from vc: UIViewController) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(filename.replacingOccurrences(of: "/", with: "-"))
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            return
        }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        // iPad: the sheet is a popover and needs an anchor.
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = vc.view
            pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        vc.present(sheet, animated: true)
    }
}
