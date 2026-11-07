#if os(macOS)
import Foundation

/// The Mac session belongs to the app's private storage, independent of its code signature.
/// Never read the legacy login Keychain, including during migration or sign-out.
struct MacSessionTokenStore {
    let directory: URL
    private func url(_ scope: String) -> URL { directory.appendingPathComponent(scope + ".token") }
    func read(_ scope: String) -> String {
        guard let data = try? Data(contentsOf: url(scope)) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    func save(_ token: String, scope: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try Data(token.utf8).write(to: url(scope), options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url(scope).path)
        var excluded = URLResourceValues(); excluded.isExcludedFromBackup = true
        var folder = directory; try folder.setResourceValues(excluded)
    }
    func remove(_ scope: String) throws {
        let file = url(scope)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}
#endif
