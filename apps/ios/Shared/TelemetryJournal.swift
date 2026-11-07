import Foundation
import SQLite3

/// A separate bounded database: note persistence never depends on diagnostics being writable.
/// WAL and transactions also coordinate Share/Action and the containing app.
final class TelemetryJournal: @unchecked Sendable {
    private var db: OpaquePointer?
    private let lock = NSLock()
    private let limit: Int
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(directory: URL, limit: Int = TelemetryContract.localEvents) throws {
        self.limit = limit
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent("diagnostics.sqlite").path
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { if let db { sqlite3_close(db) }; db = nil; throw Self.failure }
        do {
            sqlite3_busy_timeout(db, 150)
            try execute("PRAGMA journal_mode=WAL; PRAGMA auto_vacuum=INCREMENTAL; CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY,timestamp TEXT NOT NULL,payload TEXT NOT NULL,pending INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS event_time ON events(timestamp); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT OR IGNORE INTO meta VALUES ('dropped',0)")
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        } catch { sqlite3_close(db); db = nil; throw error }
    }
    deinit { sqlite3_close(db) }
    private static var failure: Error { NSError(domain: "DoompileDiagnostics", code: 1) }
    private func execute(_ sql: String) throws { guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw Self.failure } }
    private func query(_ sql: String, _ values: [String] = []) throws -> [[String]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw Self.failure }
        defer { sqlite3_finalize(statement) }
        for (index, value) in values.enumerated() { guard sqlite3_bind_text(statement, Int32(index + 1), value, -1, transient) == SQLITE_OK else { throw Self.failure } }
        var rows: [[String]] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return rows }
            guard result == SQLITE_ROW else { throw Self.failure }
            rows.append((0..<sqlite3_column_count(statement)).map { sqlite3_column_text(statement, $0).map { String(cString: $0) } ?? "" })
        }
    }
    func append(_ event: [String: Any], pending: Bool) throws {
        lock.lock(); defer { lock.unlock() }
        let payload = String(decoding: try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]), as: UTF8.self)
        guard let id = event["id"] as? String, let timestamp = event["timestamp"] as? String else { throw Self.failure }
        try execute("BEGIN IMMEDIATE")
        do {
            _ = try query("INSERT OR IGNORE INTO events VALUES (?,?,?,?)", [id, timestamp, payload, pending ? "1" : "0"])
            let cutoff = Telemetry.timestamp(Date().addingTimeInterval(-Double(TelemetryContract.localDays) * 86400))
            let excess = max(0, (Int(try query("SELECT count(*) FROM events")[0][0]) ?? 0) - limit)
            let expired = try query("SELECT id,pending FROM events WHERE timestamp<? UNION SELECT id,pending FROM (SELECT id,pending FROM events ORDER BY timestamp,id LIMIT ?)", [cutoff, String(excess)])
            let dropped = expired.filter { $0[1] == "1" }.count
            for row in expired { _ = try query("DELETE FROM events WHERE id=?", [row[0]]) }
            _ = try query("UPDATE meta SET value=value+? WHERE key='dropped'", [String(dropped)])
            try execute("COMMIT")
        } catch { try? execute("ROLLBACK"); throw error }
    }
    func events(pendingOnly: Bool = false, limit: Int = TelemetryContract.localEvents) throws -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return try query("SELECT payload FROM events WHERE timestamp>=?" + (pendingOnly ? " AND pending=1" : "") + " ORDER BY timestamp,id LIMIT ?", [Telemetry.timestamp(Date().addingTimeInterval(-Double(TelemetryContract.localDays) * 86400)), String(limit)]).compactMap { try JSONSerialization.jsonObject(with: Data($0[0].utf8)) as? [String: Any] }
    }
    func acknowledge(_ ids: [String]) throws {
        lock.lock(); defer { lock.unlock() }
        try execute("BEGIN IMMEDIATE")
        do { for id in ids { _ = try query("UPDATE events SET pending=0 WHERE id=?", [id]) }; try execute("COMMIT") }
        catch { try? execute("ROLLBACK"); throw error }
    }
    func clearPending() throws { lock.lock(); defer { lock.unlock() }; try execute("UPDATE events SET pending=0") }
    func stats() throws -> [String: Int] {
        lock.lock(); defer { lock.unlock() }
        let row = try query("SELECT count(*),COALESCE(sum(pending),0),(SELECT value FROM meta WHERE key='dropped') FROM events")[0]
        return ["count": Int(row[0]) ?? 0, "pending": Int(row[1]) ?? 0, "dropped": Int(row[2]) ?? 0]
    }
}
