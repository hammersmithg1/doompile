import Foundation

/// Opening a link selects content; it never changes credentials or the connected server.
enum NoteLinks {
    static func validID(_ value: String) -> String? {
        guard value.count == 36, let uuid = UUID(uuidString: value) else { return nil }
        return uuid.uuidString.lowercased()
    }
    static func origin(_ value: String) -> URL? {
        guard let parts = URLComponents(string: value), let host = parts.host?.lowercased(),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.scheme == "https" || (parts.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)) else { return nil }
        return parts.url
    }
    static var configuredOrigin: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "DoompilePublicURL") as? String else { return nil }
        return origin(value)
    }
    static var acceptedOrigins: [URL] { [configuredOrigin, origin(Connection.endpoint)].compactMap { $0 } }
    static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        func port(_ url: URL) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }
        return lhs.scheme?.lowercased() == rhs.scheme?.lowercased() && lhs.host?.lowercased() == rhs.host?.lowercased() && port(lhs) == port(rhs)
    }
    static func noteID(in url: URL, allowedOrigins: [URL]) -> String? {
        guard url.user == nil, url.password == nil, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let path = parts.percentEncodedPath.hasSuffix("/") ? String(parts.percentEncodedPath.dropLast()) : parts.percentEncodedPath
        if url.scheme == "doompile" {
            guard url.host == "note", url.port == nil, path.hasPrefix("/"), !path.dropFirst().contains("/") else { return nil }
            return validID(String(path.dropFirst()))
        }
        guard ["http", "https"].contains(url.scheme ?? ""), allowedOrigins.contains(where: { sameOrigin(url, $0) }) else { return nil }
        if path.hasPrefix("/notes/") { return validID(String(path.dropFirst(7))) }
        if path.isEmpty, let id = parts.queryItems?.first(where: { $0.name == "note" })?.value { return validID(id) }
        return nil
    }
    static func webURL(id: String, origin value: String) -> URL? {
        guard let id = validID(id), let base = origin(value) else { return nil }
        return base.appendingPathComponent("notes", isDirectory: true).appendingPathComponent(id)
    }
    static func appURL(id: String) -> URL? {
        guard let id = validID(id) else { return nil }
        return URL(string: "doompile://note/" + id)
    }
    static func shareURL(id: String) -> URL? {
        webURL(id: id, origin: configuredOrigin?.absoluteString ?? Connection.endpoint) ?? appURL(id: id)
    }
}


/// Keep currently edited notes intact before another note is opened by the OS.
@MainActor enum NoteLinkEditors {
    private static var editors: [UUID: () async -> Bool] = [:]
    private static var preparing: Task<Bool, Never>?
    static func register(_ id: UUID, save: @escaping () async -> Bool) { editors[id] = save }
    static func unregister(_ id: UUID) { editors.removeValue(forKey: id) }
    static func prepare() async -> Bool {
        if let preparing { return await preparing.value }
        let saves = Array(editors.values)
        let task = Task { @MainActor in
            for save in saves { if !(await save()) { return false } }
            return true
        }
        preparing = task
        let result = await task.value
        preparing = nil
        return result
    }
}
