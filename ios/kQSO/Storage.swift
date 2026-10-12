import Foundation

/// Logs as real .adi files in Documents/logs (visible in the Files app), the crash
/// journal next to them, the callsign database outside the logs folder — the same
/// layout as the Android bridge (KQSOBridge.kt). Settings live in UserDefaults.
final class Storage {
    private let fm = FileManager.default
    private let docs: URL
    private let logs: URL
    private let callDb: URL
    private let defaults = UserDefaults.standard

    init() {
        docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        logs = docs.appendingPathComponent("logs", isDirectory: true)
        callDb = docs.appendingPathComponent("calldb.tsv")
        try? fm.createDirectory(at: logs, withIntermediateDirectories: true)
    }

    private func adi(_ id: String) -> URL { logs.appendingPathComponent("\(safe(id)).adi") }
    private func journal(_ id: String) -> URL { logs.appendingPathComponent("\(safe(id)).journal") }

    /// Log ids come from the web side; keep them to one path component.
    private func safe(_ id: String) -> String {
        id.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "..", with: "_")
    }

    private func readText(_ url: URL) -> String {
        (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    private func writeText(_ url: URL, _ text: String) {
        try? text.write(to: url, atomically: true, encoding: .utf8)
    }

    func list() -> String {
        let ids = ((try? fm.contentsOfDirectory(atPath: logs.path)) ?? [])
            .filter { $0.hasSuffix(".adi") }
            .map { String($0.dropLast(4)) }
        let data = (try? JSONSerialization.data(withJSONObject: ids)) ?? Data("[]".utf8)
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    func createHeader(_ id: String, _ content: String) { writeText(adi(id), content) }

    /// Append one record — never rewrite the file for a new QSO.
    func append(_ id: String, _ text: String) {
        let url = adi(id)
        guard let handle = try? FileHandle(forWritingTo: url) else { return writeText(url, text) }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data(text.utf8))
    }

    func read(_ id: String) -> String { readText(adi(id)) }
    func rewrite(_ id: String, _ content: String) { writeText(adi(id), content) }

    func remove(_ id: String) {
        try? fm.removeItem(at: adi(id))
        try? fm.removeItem(at: journal(id))
    }

    func writeJournal(_ id: String, _ text: String) { writeText(journal(id), text) }
    func readJournal(_ id: String) -> String { readText(journal(id)) }
    func clearJournal(_ id: String) { writeText(journal(id), "") }

    func getSetting(_ key: String) -> String? { defaults.string(forKey: key) }
    func setSetting(_ key: String, _ value: String) { defaults.set(value, forKey: key) }

    func readCallDb() -> String { readText(callDb) }
    func writeCallDb(_ text: String) { writeText(callDb, text) }
}
