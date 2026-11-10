import Foundation
import CoreFoundation

struct TelemetryTrace: Sendable {
    let traceID: String
    let spanID: String
    var parentSpanID: String?
    init(parent: TelemetryTrace? = nil) {
        traceID = parent?.traceID ?? UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        spanID = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
        parentSpanID = parent?.spanID
    }
    init?(header: String?) {
        guard let header, header.range(of: #"^00-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-[0-9a-f]{2}$"#, options: .regularExpression) != nil else { return nil }
        let parts = header.split(separator: "-")
        traceID = String(parts[1]); spanID = String(parts[2]); parentSpanID = nil
    }
    var header: String { "00-\(traceID)-\(spanID)-01" }
}

enum TelemetryPrivacy {
    static func frames(_ value: String) -> String {
        let pattern = #"(?:^|[/\s(@])([a-zA-Z0-9_.-]{1,100}\.(?:[cm]?js|tsx?|swift)):(\d{1,7})(?::(\d{1,7}))?(?:[)\s]|$)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return "" }
        return value.components(separatedBy: .newlines).compactMap { line -> String? in
            if line.range(of: #"^native:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{1,16}$"#, options: .regularExpression) != nil { return line }
            let text = line.trimmingCharacters(in: .whitespacesAndNewlines) as NSString
            guard let match = regex.firstMatch(in: text as String, range: NSRange(location: 0, length: text.length)) else { return nil }
            return text.substring(with: match.range(at: 1)) + ":" + text.substring(with: match.range(at: 2)) + ":" + (match.range(at: 3).location == NSNotFound ? "0" : text.substring(with: match.range(at: 3)))
        }.prefix(12).joined(separator: "\n")
    }
    static func properties(_ name: TelemetryEventName, _ input: [String: Any]) -> [String: Any] {
        let definitions = TelemetryContract.catalog["properties"] as! [String: Any]
        let events = TelemetryContract.catalog["events"] as! [String: [String: Any]]
        var output: [String: Any] = [:]
        for key in events[name.rawValue]?["properties"] as? [String] ?? [] {
            guard let value = input[key] else { continue }
            if let allowed = definitions[key] as? [String], let string = value as? String, allowed.contains(string) { output[key] = string }
            else if let rule = definitions[key] as? String {
                switch rule {
                case "uuid": if let string = value as? String, UUID(uuidString: string) != nil { output[key] = string.lowercased() }
                case "number": if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue <= 1e12 { output[key] = (number.doubleValue * 100).rounded() / 100 }
                case "boolean": if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() { output[key] = number.boolValue }
                case "frames": if let string = value as? String { let safe = frames(string); if !safe.isEmpty { output[key] = safe } }
                case "identifier": if let string = value as? String, string.range(of: #"^[a-zA-Z0-9._-]{1,80}$"#, options: .regularExpression) != nil { output[key] = string }
                default: break
                }
            }
        }
        return output
    }
    static func error(_ error: Error) -> [String: Any] {
        let value = error as NSError
        let code: String
        if value.domain == NSURLErrorDomain {
            switch value.code { case NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost: code = "offline"; case NSURLErrorTimedOut: code = "timeout"; case NSURLErrorCancelled: code = "cancelled"; default: code = "http" }
        } else if value.domain == NSCocoaErrorDomain {
            code = value.code == NSFileWriteOutOfSpaceError ? "quota" : "storage"
        } else if error is DecodingError || error is EncodingError { code = "invalid_data" }
        else if let error = error as? DoompileError, case .authentication = error { code = "authentication" }
        else { code = "unknown" }
        // NSError descriptions and userInfo commonly contain source URLs and note contents.
        return ["error_type": value.domain == NSURLErrorDomain ? "URLError" : "Other", "error_code": code]
    }
    static func route(_ path: String) -> String {
        if path.hasPrefix("/api/notes/") { return "note" }
        if path.hasPrefix("/api/attachments/") { return "attachment" }
        if path.hasPrefix("/api/auth/") { return "auth" }
        if path.hasPrefix("/api/admin/") { return "admin" }
        let name = path.replacingOccurrences(of: "/api/", with: "").replacingOccurrences(of: "-", with: "_")
        let allowed = (TelemetryContract.catalog["properties"] as! [String: Any])["route"] as! [String]
        return allowed.contains(name) ? name : "other"
    }
    static func kind(_ mime: String) -> String { let value = String(mime.split(separator: "/").first ?? ""); return ["image", "audio", "video"].contains(value) ? value : "file" }
}

final class Telemetry: @unchecked Sendable {
    private static let instancesLock = NSLock()
    private static var instances: [String: Telemetry] = [:]
    static var shared: Telemetry {
        instancesLock.lock(); defer { instancesLock.unlock() }
        let scope = Connection.scope
        if let value = instances[scope] { return value }
        let value = Telemetry(directory: Storage.shared.directory, scope: scope)
        instances[scope] = value
        return value
    }
    private let scope: String
    private let journal: TelemetryJournal?
    private let sessionID = UUID().uuidString.lowercased()
    private let deviceID: String
    private let lock = NSLock()
    private var flushing = false
    private var storageFailures = 0
    private var recent: [[String: Any]] = []
    private var retryAt = Date.distantPast
    private var backoff: TimeInterval = 1
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    static func timestamp(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
    static var platform: String {
        let id = Bundle.main.bundleIdentifier ?? ""
        #if os(macOS)
        return id.hasSuffix(".safari") ? "macos_safari" : "macos"
        #else
        if id.hasSuffix(".share") { return "ios_share" }
        if id.hasSuffix(".action") { return "ios_action" }
        if id.hasSuffix(".safari") { return "ios_safari" }
        return "ios"
        #endif
    }
    init(directory: URL, scope: String) {
        self.scope = scope
        journal = try? TelemetryJournal(directory: directory)
        let key = "diagnostics-device-id"
        if let existing = Connection.defaults.string(forKey: key), UUID(uuidString: existing) != nil { deviceID = existing }
        else { deviceID = UUID().uuidString.lowercased(); Connection.defaults.set(deviceID, forKey: key) }
        if journal == nil { storageFailures = 1 }
        if !enabled { try? journal?.clearPending() }
        record(.appStarted)
    }
    var enabled: Bool { Connection.defaults.object(forKey: "diagnostics-enabled:" + scope) as? Bool ?? true }
    func setEnabled(_ enabled: Bool) {
        Connection.defaults.set(enabled, forKey: "diagnostics-enabled:" + scope)
        if !enabled { try? journal?.clearPending() }
    }
    func record(_ name: TelemetryEventName, _ properties: [String: Any] = [:], trace: TelemetryTrace = TelemetryTrace()) {
        let definition = (TelemetryContract.catalog["events"] as! [String: [String: Any]])[name.rawValue]!
        #if DEBUG
        let environment = "development"
        #else
        let environment = "production"
        #endif
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0") + "." + (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") + "." + (Bundle.main.object(forInfoDictionaryKey: "DoompileBuildCommit") as? String ?? "development")
        var event: [String: Any] = ["schema_version": TelemetryContract.version, "id": UUID().uuidString.lowercased(), "timestamp": Self.timestamp(), "name": name.rawValue, "category": definition["category"]!, "level": definition["level"]!, "platform": Self.platform, "release": version, "environment": environment, "device_id": deviceID, "session_id": sessionID, "trace_id": trace.traceID, "span_id": trace.spanID, "properties": TelemetryPrivacy.properties(name, properties)]
        if let parent = trace.parentSpanID { event["parent_span_id"] = parent }
        lock.lock(); recent.append(event); if recent.count > TelemetryContract.localEvents { recent.removeFirst() }; lock.unlock()
        do { try journal?.append(event, pending: enabled) }
        catch { lock.lock(); storageFailures += 1; lock.unlock() }
    }
    func failure(_ name: TelemetryEventName, _ error: Error, _ properties: [String: Any] = [:], trace: TelemetryTrace = TelemetryTrace(), file: StaticString = #fileID, line: UInt = #line) {
        var values = TelemetryPrivacy.error(error).merging(properties) { _, explicit in explicit }
        if values["stack"] == nil { values["stack"] = "\(file):\(line):0" }
        record(name, values, trace: trace)
    }
    static func network(_ session: URLSession, request original: URLRequest, parent: TelemetryTrace? = nil, upload: Data? = nil, delegate: URLSessionTaskDelegate? = nil) async throws -> (Data, URLResponse) {
        func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
            if let upload { return try await session.upload(for: request, from: upload, delegate: delegate) }
            return try await session.data(for: request)
        }
        guard original.url?.path.hasPrefix("/api/") == true, original.url?.path != "/api/telemetry" else { return try await perform(original) }
        let telemetry = Self.shared, trace = TelemetryTrace(parent: parent), started = Date()
        var request = original; request.setValue(trace.header, forHTTPHeaderField: "traceparent")
        let properties: [String: Any] = ["method": request.httpMethod ?? "GET", "route": TelemetryPrivacy.route(request.url?.path ?? "")]
        do {
            let result = try await perform(request)
            let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
            telemetry.record(status >= 500 ? .httpFailed : .httpCompleted, properties.merging(["status": status, "duration_ms": Date().timeIntervalSince(started) * 1000]) { _, value in value }, trace: trace)
            return result
        } catch { telemetry.failure(.httpFailed, error, properties.merging(["duration_ms": Date().timeIntervalSince(started) * 1000]) { _, value in value }, trace: trace); throw error }
    }
    private func beginFlush() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !flushing, enabled, Date() >= retryAt else { return false }
        flushing = true; return true
    }
    private func endFlush(success: Bool) {
        lock.lock(); defer { lock.unlock() }
        flushing = false
        if success { retryAt = .distantPast; backoff = 1 }
        else { retryAt = Date().addingTimeInterval(backoff); backoff = min(backoff * 2, 300) }
    }
    func flush() async {
        guard let account = Connection.account, account.scope == scope, Connection.signedIn, beginFlush() else { return }
        var success = false
        defer { endFlush(success: success) }
        do {
            guard let events = try journal?.events(pendingOnly: true, limit: TelemetryContract.batchEvents), !events.isEmpty else { success = true; return }
            guard let url = URL(string: account.endpoint + "/api/telemetry") else { return }
            var request = URLRequest(url: url, timeoutInterval: 8)
            request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: ["events": events])
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer " + Connection.token, forHTTPHeaderField: "Authorization")
            request.setValue(account.id, forHTTPHeaderField: "X-Doompile-User-ID")
            let (_, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            try journal?.acknowledge(events.compactMap { $0["id"] as? String }); success = true
        } catch { /* Offline telemetry stays local; diagnostics must not interrupt note sync. */ }
    }
    func export() throws -> URL {
        record(.diagnosticsExported)
        lock.lock(); let failures = storageFailures, fallback = recent; lock.unlock()
        let health = ((try? journal?.stats()) ?? [:]).merging(["storage_failures": failures]) { _, value in value }
        let dump: [String: Any] = ["format": "doompile-diagnostics", "schema_version": TelemetryContract.version, "catalog_version": TelemetryContract.version, "exported_at": Self.timestamp(), "health": health, "events": (try? journal?.events()) ?? fallback]
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("doompile-diagnostics-" + sessionID + ".json")
        try JSONSerialization.data(withJSONObject: dump, options: [.sortedKeys, .prettyPrinted]).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return url
    }
}
