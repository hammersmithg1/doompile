import Foundation
#if !os(macOS)
import Security
#endif
import Darwin
import CryptoKit

enum DoompileError: LocalizedError {
    case message(String)
    case authentication
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        case .authentication: return "Ключ доступа отклонён. Обнови его в настройках."
        }
    }
}

enum Connection {
    struct Origins {
        let current: String
        let previous: String?

        func networkEndpoint(_ endpoint: String) -> String {
            endpoint == previous ? current : endpoint
        }

        func scope(endpoint: String, userID: String) -> String {
            // Both names identify the same collection, including its local data and token.
            let storageEndpoint = endpoint == current ? (previous ?? endpoint) : endpoint
            return SHA256.hash(data: Data((storageEndpoint + "|" + userID).utf8)).map { String(format: "%02x", $0) }.joined()
        }
    }

    static let group = "group.app.doompile"
    static let origins = Origins(
        current: (Bundle.main.object(forInfoDictionaryKey: "DoompilePublicURL") as? String) ?? "http://localhost:3000",
        previous: Bundle.main.object(forInfoDictionaryKey: "DoompilePreviousPublicURL") as? String
    )
    #if DEBUG && os(macOS) && DOOMPILE_MAC_UI_REVIEW
    private static let reviewDirectory: URL? = {
        let environment = ProcessInfo.processInfo.environment
        guard environment["DOOMPILE_MAC_UI_TESTING"] == "1", let path = environment["DOOMPILE_MAC_UI_ROOT"], !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }()
    #endif
    static var defaults: UserDefaults {
        #if DEBUG && os(macOS) && DOOMPILE_MAC_UI_REVIEW
        if let reviewDirectory { return UserDefaults(suiteName: "app.doompile.macos.review." + scope(endpoint: reviewDirectory.path, userID: "review"))! }
        #endif
        return UserDefaults(suiteName: group) ?? .standard
    }
    static var defaultEndpoint: String { origins.current }
    static var endpoint: String {
        get { origins.networkEndpoint(defaults.string(forKey: "endpoint") ?? defaultEndpoint) }
        set { defaults.set(newValue.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")), forKey: "endpoint") }
    }
    static var account: NativeAccount? {
        guard let data = defaults.data(forKey: "account-v1"), var value = try? JSONDecoder().decode(NativeAccount.self, from:data), UUID(uuidString:value.id) != nil, validEndpoint(value.endpoint) else { return nil }
        value.endpoint = origins.networkEndpoint(value.endpoint)
        return value
    }
    static func scope(endpoint: String, userID: String) -> String {
        origins.scope(endpoint: endpoint, userID: userID)
    }
    static var scope: String { account?.scope ?? "signed-out" }
    static var signedIn: Bool { account != nil && !token.isEmpty }
    static var directory: URL {
        #if DEBUG && os(macOS) && DOOMPILE_MAC_UI_REVIEW
        if let reviewDirectory { return reviewDirectory }
        #endif
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Doompile")
    }
    #if os(macOS)
    private static var sessions: MacSessionTokenStore { MacSessionTokenStore(directory: directory.appendingPathComponent("sessions")) }
    #else
    private static func keychainQuery(scope: String) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.doompile", kSecAttrAccount as String: "account-v1:" + scope]
        if let group = Bundle.main.object(forInfoDictionaryKey: "DoompileKeychainGroup") as? String, !group.isEmpty, !group.contains("$(") { query[kSecAttrAccessGroup as String] = group }
        return query
    }
    #endif
    static var token: String {
        guard let account else { return "" }
        #if os(macOS)
        return sessions.read(account.scope)
        #else
        var query = keychainQuery(scope:account.scope)
        query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return "" }
        return String(data:data,encoding:.utf8) ?? ""
        #endif
    }
    static func install(_ account: NativeAccount, token: String) throws {
        guard UUID(uuidString:account.id) != nil, validEndpoint(account.endpoint), !token.isEmpty else { throw DoompileError.authentication }
        #if os(macOS)
        try sessions.save(token, scope: account.scope)
        #else
        let query = keychainQuery(scope:account.scope)
        SecItemDelete(query as CFDictionary)
        var values = query
        values[kSecValueData as String] = Data(token.utf8)
        values[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(values as CFDictionary,nil)
        guard status == errSecSuccess else { throw DoompileError.message("Не удалось сохранить вход в Keychain (\(status)).") }
        #endif
        defaults.set(try JSONEncoder().encode(account),forKey:"account-v1")
        endpoint = account.endpoint
    }
    static func logout() {
        #if os(macOS)
        if let account { try? sessions.remove(account.scope) }
        #else
        if let account { SecItemDelete(keychainQuery(scope:account.scope) as CFDictionary) }
        #endif
        defaults.removeObject(forKey:"account-v1")
    }
    static func validEndpoint(_ value: String) -> Bool {
        guard let url = URL(string: value), let host = url.host, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else { return false }
        return url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
    }
}

/// Per-note SQLite transactions shared by the app and extensions. The legacy JSON remains a backup.
final class Storage: @unchecked Sendable {
    private static let instancesLock = NSLock()
    private static var instances: [String:Storage] = [:]
    static var shared: Storage {
        instancesLock.lock(); defer { instancesLock.unlock() }
        let scope = Connection.scope
        if let existing = instances[scope] { return existing }
        let created = Storage(); instances[scope] = created; return created
    }
    let directory: URL
    private let lock = NSRecursiveLock()
    private let writer = UUID().uuidString
    private var database: SQLiteNotes?
    private let observes: Bool
    init(directory: URL? = nil) {
        observes = directory == nil
        let root = Connection.directory
        self.directory = directory ?? root.appendingPathComponent("accounts").appendingPathComponent(Connection.scope)
        try? FileManager.default.createDirectory(at: self.directory.appendingPathComponent("files"), withIntermediateDirectories: true)
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: self.directory.path)
    }
    private func access<T>(_ operation: (SQLiteNotes) throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        do { if database == nil { database = try SQLiteNotes(directory: directory) }; return try operation(database!) }
        catch { if observes { Telemetry.shared.failure(.storageFailed, error) }; throw error }
    }
    var decodedSnapshotNotes: Int { (try? access { $0.decodedSnapshotNotes }) ?? 0 }
    func snapshot() throws -> DiskState { try access { try $0.snapshot() } }
    func pendingNotes() throws -> [Note] { try access { db in try db.transaction {
        let notes = try db.pendingNotes()
        for note in notes {
            if note.replica == nil {
                let existing = try db.journal(note.id, limit: Int.max)
                if existing.last(where: { $0.legacy != nil })?.legacy?.note != note {
                    try db.append(note.id, NoteJournalEntry(legacy: LegacyNoteChange(id: UUID().uuidString.lowercased(), note: note, baseRevision: note.revision, origin: NoteEngine.origin)))
                    try db.put(note, dirty: true)
                }
            } else if try !db.hasJournal(note.id) {
                try db.append(note.id, NoteJournalEntry(change: NoteEngine.shared.recovery(note, server: db.syncState(note.id).server)))
            }
        }
        return notes
    } } }
    func journal(_ id: String) throws -> [NoteJournalEntry] { try access { try $0.journal(id) } }
    func cursor() throws -> Int { try access { try $0.cursor() } }
    @discardableResult func save(_ original: Note, changes: [NoteChange] = []) throws -> Note {
        let started = Date()
        var actions: [String] = []
        let result: (note: Note, operation: String?) = try access { db in try db.transaction {
            let previous = try db.note(original.id)
            var state = try db.syncState(original.id)
            let record = previous.map { NoteClientRecord(note: $0.note, dirty: $0.dirty, baseRevision: state.server?.revision ?? $0.note.revision, server: state.server, legacyBaseline: state.legacyBaseline) }
            if let previous, previous.dirty, previous.note.replica == nil, try !db.hasJournal(original.id) {
                try db.append(original.id, NoteJournalEntry(legacy: LegacyNoteChange(id: UUID().uuidString.lowercased(), note: previous.note, baseRevision: previous.note.revision, origin: NoteEngine.origin)))
            }
            let staged = try NoteEngine.shared.stage(original, current: record, changes: changes)
            if let baseline = staged.legacyBaseline { state.legacyBaseline = baseline; try db.putSyncState(original.id, state) }
            let note = staged.note
            for change in staged.changes { try db.append(note.id, NoteJournalEntry(change: change)) }
            for change in staged.legacy { try db.append(note.id, NoteJournalEntry(legacy: change)) }
            let dirty = try db.hasJournal(note.id)
            guard previous?.note != note || previous?.dirty != dirty else { return (note,nil) }
            try db.put(note,dirty:dirty,writer:writer)
            if (previous?.note.pinned ?? false) != note.pinned { actions.append("pin") }
            if (previous?.note.urgent ?? false) != note.urgent { actions.append("urgent") }
            if Set(previous?.note.tags ?? []) != Set(note.tags) { actions.append("tag") }
            return (note,note.deletedAt != nil ? "delete" : previous == nil ? "create" : "update")
        } }
        if observes, let operation = result.operation { Telemetry.shared.record(.noteSaved, ["note_id": original.id, "operation": operation, "kind": original.kind, "duration_ms": Date().timeIntervalSince(started) * 1000]) }
        if observes { for action in actions { Telemetry.shared.record(.editorAction, ["action": action]) } }
        return result.note
    }
    func accept(_ server: Note, matching local: Note, acknowledged: [String] = []) throws {
        try access { db in try db.transaction {
            guard let record = try db.note(local.id) else { return }
            let sent = try db.journal(local.id)
            try db.acknowledge(local.id, acknowledged)
            let remaining = try db.journal(local.id)
            var state = try db.syncState(local.id)
            if let last = sent.last(where: { acknowledged.contains($0.id) })?.legacy { state.legacyBaseline = last.note }
            state.server = server
            let note = remaining.contains(where: { $0.legacy != nil }) ? record.note : try NoteEngine.shared.receive(record.note.replica != nil ? record.note : nil, server: server)
            if remaining.isEmpty, let left = note.replica, let right = server.replica, try !NoteEngine.shared.same(left, right) {
                try db.append(note.id, NoteJournalEntry(change: NoteEngine.shared.recovery(note, server: server)))
            }
            try db.putSyncState(note.id, state)
            try db.put(note,dirty: db.hasJournal(note.id),writer:record.writer)
        } }
    }
    /// Checkpoint uploaded URLs before PUT so a lost response retries the same note payload.
    @discardableResult func checkpointUploads(_ uploaded: Note, matching local: Note) throws -> Note {
        try access { db in try db.transaction {
            guard let record = try db.note(local.id) else { return uploaded }
            var current = record.note
            for file in uploaded.attachments {
                guard let previous = local.attachments.first(where: { $0.id == file.id }), previous.url.hasPrefix("local:"),
                      let index = current.attachments.firstIndex(where: { $0.id == file.id }), current.attachments[index].url == previous.url else { continue }
                current.attachments[index] = file
                current.body = current.body.replacingString(previous.url, with: file.url)
            }
            // Record the upload mapping as a causal change too. Raw journal
            // inputs retain their original local: URLs for stable retry hashes.
            let state = try db.syncState(current.id)
            let staged = try NoteEngine.shared.stage(current, current: NoteClientRecord(note: record.note, dirty: record.dirty, baseRevision: state.server?.revision ?? record.note.revision, server: state.server, legacyBaseline: state.legacyBaseline))
            for change in staged.changes { try db.append(current.id, NoteJournalEntry(change: change)) }
            for change in staged.legacy { try db.append(current.id, NoteJournalEntry(legacy: change)) }
            try db.put(staged.note,dirty:true,writer:record.writer)
            return staged.note
        } }
    }
    func backfill(_ id: String) throws {
        try access { db in try db.transaction {
            guard let record = try db.note(id), record.note.replica != nil else { return }
            let journal = try db.journal(id, limit: Int.max)
            try db.acknowledge(id, journal.map(\.id))
            try db.append(id, NoteJournalEntry(change: NoteEngine.shared.recovery(record.note, server: nil)))
            for entry in journal { try db.append(id, entry) }
            try db.put(record.note, dirty: true, writer: record.writer)
        } }
    }
    func merge(_ notes: [Note], cursor: Int? = nil, reset: Bool = false) throws {
        try access { db in try db.transaction {
            if reset {
                for note in try db.allNotes() where note.replica != nil {
                    let journal = try db.journal(note.id, limit: Int.max)
                    try db.acknowledge(note.id, journal.map(\.id))
                    try db.append(note.id, NoteJournalEntry(change: NoteEngine.shared.recovery(note, server: nil)))
                    for entry in journal { try db.append(note.id, entry) }
                    try db.putSyncState(note.id, NoteSyncState())
                    try db.put(note, dirty: true)
                }
            }
            for remote in notes {
                let current = try db.note(remote.id)
                var state = try db.syncState(remote.id)
                state.server = remote
                if current?.dirty == true && current?.note.replica == nil {
                    try db.putSyncState(remote.id, state); continue
                }
                let note = try NoteEngine.shared.receive(current?.note, server: remote)
                if try !db.hasJournal(note.id), let left = note.replica, let right = remote.replica, try !NoteEngine.shared.same(left, right) {
                    try db.append(note.id, NoteJournalEntry(change: NoteEngine.shared.recovery(note, server: remote)))
                }
                try db.putSyncState(note.id, state)
                if current?.note != note { try db.put(note,dirty: db.hasJournal(note.id)) }
            }
            if let cursor { try db.putCursor(cursor) }
        } }
    }
    func addFile(_ data: Data, name: String, mimeType: String) throws -> Attachment {
        let id = UUID().uuidString.lowercased()
        let filename = id + "." + (name as NSString).pathExtension
        let url = directory.appendingPathComponent("files").appendingPathComponent(filename)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        try access { db in try db.transaction { try db.putFile(id,LocalFile(filename:filename,mimeType:mimeType)) } }
        if observes { Telemetry.shared.record(.attachmentSaved, ["bytes": data.count, "kind": TelemetryPrivacy.kind(mimeType)]) }
        return Attachment(id:id,name:name,mimeType:mimeType,url:"local:\(id)",size:data.count)
    }
    func fileURL(_ attachment: Attachment) -> URL? {
        localFile(id: attachment.id)?.url
    }
    func localFile(id: String) -> (url: URL, mimeType: String)? {
        guard let file = try? access({ try $0.file(id) }) else { return nil }
        return (directory.appendingPathComponent("files").appendingPathComponent(file.filename), file.mimeType)
    }
    // A suspended main app or share extension may outlive a network request. A durable,
    // expiring lease coordinates them without triggering iOS's 0xdead10cc file-lock kill.
    private let syncLeaseDuration: TimeInterval = 6
    func acquireSyncLock(now: Date = Date()) -> String? {
        let owner = "lease-v2:\(UUID().uuidString)"
        guard (try? access { try $0.acquireSyncLease(owner: owner, now: now, duration: syncLeaseDuration) }) == true else { return nil }
        return owner
    }
    func renewSyncLock(_ owner: String, now: Date = Date()) -> Bool {
        (try? access { try $0.renewSyncLease(owner: owner, now: now, duration: syncLeaseDuration) }) == true
    }
    func releaseSyncLock(_ owner: String) { try? access { try $0.releaseSyncLease(owner: owner) } }

}

final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let progress: AsyncStream<Int>.Continuation?
    init(progress: AsyncStream<Int>.Continuation? = nil) { self.progress = progress }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        // The file is still being processed after the request body reaches the server.
        progress?.yield(Int(min(0.99, Double(totalBytesSent) / Double(totalBytesExpectedToSend)) * 100))
    }
}

enum AttachmentFiles {
    private static let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    static func resolve(_ attachment: Attachment) async throws -> URL {
        if let file = Storage.shared.fileURL(attachment) { return file }
        guard let base = URL(string: Connection.endpoint),
              let url = URL(string: attachment.url, relativeTo: base)?.absoluteURL,
              url.scheme == base.scheme, url.host == base.host, url.port == base.port,
              url.path.hasPrefix("/api/attachments/") else { throw DoompileError.message("Вложение находится вне подключённого хранилища.") }
        let ext = (attachment.name as NSString).pathExtension
        let safeExtension = ext.allSatisfy { $0.isLetter || $0.isNumber } ? ext : "bin"
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("doompile-\(Connection.scope)-\(attachment.id).\(safeExtension)")
        if FileManager.default.fileExists(atPath: destination.path) { return destination }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("Bearer " + Connection.token, forHTTPHeaderField: "Authorization")
        let (data, response) = try await Telemetry.network(session, request: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw DoompileError.message("Не удалось скачать вложение. Проверь подключение к хранилищу.") }
        try data.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return destination
    }
}

actor SyncService {
    static let shared = SyncService()
    private var running = false
    private var syncConnection: (account: NativeAccount, token: String)?
    private var syncTrace: TelemetryTrace?
    private var syncLease: (storage: Storage, owner: String)?
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    private struct List: Decodable { let notes: [Note]; let cursor: Int; let more: Bool; let reset: Bool? }
    private struct One: Codable { let note: Note }
    private struct Batch: Encodable { var changes: [NoteChange]?; var legacy: [LegacyNoteChange]? }
    private struct Acknowledgement: Decodable { let note: Note; let acknowledged: [String] }
    private struct Upload: Decodable { let attachment: Attachment }

    private func request(_ path: String, method: String = "GET", body: Data? = nil, contentType: String = "application/json") throws -> URLRequest {
        guard let connection = syncConnection, Connection.scope == connection.account.scope else { throw DoompileError.authentication }
        let endpoint = connection.account.endpoint
        guard Connection.validEndpoint(endpoint), let url = URL(string: endpoint + path) else { throw DoompileError.message("Укажи корректный HTTPS-адрес хранилища в настройках.") }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(String(Contracts.apiVersion), forHTTPHeaderField: "X-Doompile-API-Version")
        request.setValue("Bearer " + connection.token, forHTTPHeaderField: "Authorization")
        request.setValue(connection.account.id, forHTTPHeaderField: "X-Doompile-User-ID")
        return request
    }
    private func response(_ request: URLRequest, upload: Data? = nil, delegate: URLSessionTaskDelegate? = nil) async throws -> (Data, Int) {
        guard let lease = syncLease, lease.storage.renewSyncLock(lease.owner) else { throw URLError(.cancelled) }
        let (data, response) = try await Telemetry.network(session, request: request, parent: syncTrace, upload: upload, delegate: delegate)
        // After suspension another process may own the queue. Do not apply a stale response.
        guard lease.storage.renewSyncLock(lease.owner) else { throw URLError(.cancelled) }
        guard let response = response as? HTTPURLResponse else { throw DoompileError.message("Некорректный ответ хранилища.") }
        if response.statusCode == 401 { throw DoompileError.authentication }
        return (data, response.statusCode)
    }
    typealias UploadObserver = @Sendable (String, AttachmentUploadState?) async -> Void

    private func upload(_ attachment: Attachment, file: URL, onUpload: UploadObserver?) async throws -> Attachment {
        let boundary = UUID().uuidString
        let safeName = attachment.name.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        var payload = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(attachment.mimeType)\r\n\r\n".utf8)
        payload.append(try Data(contentsOf: file))
        payload.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = try self.request("/api/attachments", method: "POST", contentType: "multipart/form-data; boundary=\(boundary)")
        request.timeoutInterval = 120
        request.setValue(attachment.id, forHTTPHeaderField: "X-Doompile-Upload-ID")

        let (stream, progress) = AsyncStream.makeStream(of: Int.self, bufferingPolicy: .bufferingNewest(1))
        let observer = Task {
            var previous = -1
            for await percent in stream where percent > previous {
                previous = percent
                await onUpload?(attachment.id, .uploading(Double(percent) / 100))
            }
        }
        let data: Data, status: Int
        do { (data, status) = try await response(request, upload: payload, delegate: NoRedirects(progress: progress)) }
        catch { progress.finish(); await observer.value; throw error }
        progress.finish()
        await observer.value
        guard status == 200 || status == 201 else { throw DoompileError.message("Не удалось отправить вложение (\(status)). Файл сохранён на устройстве.") }
        var uploaded = try JSONDecoder().decode(Upload.self, from: data).attachment
        uploaded.id = attachment.id
        return uploaded
    }

    func sync(pull: Bool = true, onProgress: (@Sendable () async -> Void)? = nil, onUpload: UploadObserver? = nil) async throws {
        guard !running else { return }
        guard let account = Connection.account, Connection.signedIn else { return }
        let storage = Storage.shared
        guard let syncLock = storage.acquireSyncLock() else { return }
        syncConnection = (account, Connection.token)
        syncLease = (storage, syncLock)
        running = true
        // Renew only while this process is executing. A stopped or suspended owner cannot
        // strand the app/extension outbox for minutes, and no file lock spans an await.
        let heartbeat = Task {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard storage.renewSyncLock(syncLock) else { return }
            }
        }
        let started = Date(), telemetry = Telemetry.shared
        let trace = TelemetryTrace()
        syncTrace = trace
        var succeeded = false
        telemetry.record(.syncStarted, ["pull": pull, "pending": (try? storage.pendingNotes().count) ?? 0], trace: trace)
        defer {
            telemetry.record(succeeded ? .syncCompleted : .syncFailed, ["pull": pull, "pending": (try? storage.pendingNotes().count) ?? 0, "duration_ms": Date().timeIntervalSince(started) * 1000], trace: trace)
            syncTrace = nil
            Task { await telemetry.flush() }
        }
        defer { heartbeat.cancel(); running = false; syncConnection = nil; syncLease = nil; storage.releaseSyncLock(syncLock) }
        // Deliver lightweight edits before potentially slow file transfers.
        let pending = try storage.pendingNotes().sorted {
            let left = $0.attachments.contains { $0.url.hasPrefix("local:") }
            let right = $1.attachments.contains { $0.url.hasPrefix("local:") }
            if left != right { return !left }
            return $0.updatedAt < $1.updatedAt
        }
        var noteErrors: [String] = []
        for originalNote in pending {
            var note = originalNote
            let local = note
            do {
                note = try storage.checkpointUploads(note, matching: local)
                while let index = note.attachments.firstIndex(where: { $0.url.hasPrefix("local:") }) {
                    let before = note, original = before.attachments[index]
                    do {
                        guard let file = storage.fileURL(original) else { throw DoompileError.message("Ожидающее отправки вложение не найдено на устройстве.") }
                        await onUpload?(original.id, .uploading(nil))
                        let uploaded = try await upload(original, file: file, onUpload: onUpload)
                        guard !uploaded.url.hasPrefix("local:") else { throw DoompileError.message("Хранилище вернуло некорректный адрес вложения.") }
                        note.attachments[index] = uploaded
                        note.body = note.body.replacingString(original.url, with: uploaded.url)
                        // Refresh each successful upload before the next file or note request.
                        note = try storage.checkpointUploads(note, matching: before)
                        await onProgress?()
                        await onUpload?(original.id, nil)
                    } catch {
                        let code = (error as? URLError)?.code
                        await onUpload?(original.id, code == .notConnectedToInternet || code == .cancelled ? .queued : .failed)
                        throw error
                    }
                }
                var recovered = false
                for _ in 0..<100 {
                    let journal = try storage.journal(note.id)
                    if journal.isEmpty { break }
                    let legacy = journal.prefix { $0.legacy != nil }.compactMap(\.legacy)
                    let changes = journal.prefix { $0.change != nil }.compactMap(\.change)
                    let batch = legacy.isEmpty ? Batch(changes: changes) : Batch(legacy: Array(legacy.prefix(32)))
                    let (data, status) = try await response(request("/api/notes/\(note.id)/sync", method: "POST", body: JSONEncoder().encode(batch)))
                    if status == 409 && !recovered { recovered = true; try storage.backfill(note.id); continue }
                    guard status == 200 else { throw DoompileError.message("Не удалось синхронизировать заметку (\(status)). Изменения сохранены на устройстве.") }
                    let saved = try JSONDecoder().decode(Acknowledgement.self, from: data)
                    try storage.accept(saved.note, matching: note, acknowledged: saved.acknowledged)
                    await onProgress?()
                }
                await onProgress?()
            } catch DoompileError.authentication {
                throw DoompileError.authentication
            } catch let error as URLError {
                if error.code == .cancelled { throw error }
                // One slow upload must not starve text notes or the server pull.
                noteErrors.append(error.localizedDescription)
            } catch {
                // A malformed or rejected note stays pending without blocking other notes.
                noteErrors.append("\(String(local.displayTitle.prefix(80))): \(error.localizedDescription)")
            }
        }
        if pull {
            for _ in 0..<100 {
                let cursor = try storage.cursor()
                let (data, status) = try await response(request("/api/notes?cursor=\(cursor)"))
                guard status == 200 else { throw DoompileError.message("Не удалось получить заметки (\(status)).") }
                let page = try JSONDecoder().decode(List.self, from: data)
                try storage.merge(page.notes, cursor: page.cursor, reset: page.reset == true)
                await onProgress?()
                if !page.more { break }
            }
        }
        if !noteErrors.isEmpty {
            throw DoompileError.message("Не удалось синхронизировать \(noteErrors.count) заметок. Они сохранены на устройстве. " + noteErrors.prefix(3).joined(separator: "\n"))
        }
        succeeded = true
    }
}
