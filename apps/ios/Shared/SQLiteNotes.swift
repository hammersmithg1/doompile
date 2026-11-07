import Foundation
import SQLite3
import Darwin

/// One connection per Storage instance; its caller serializes access. SQLite coordinates processes.
final class SQLiteNotes {
    private var handle: OpaquePointer?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var cached = DiskState()
    private var cachedVersion: Int64 = 0
    private(set) var decodedSnapshotNotes = 0
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(directory: URL) throws {
        let path = directory.appendingPathComponent("notes.sqlite").path
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let failed = handle; handle = nil
            if let failed { sqlite3_close(failed) }
            throw DoompileError.message("Не удалось открыть локальную базу заметок.")
        }
        do {
            sqlite3_busy_timeout(handle, 5000)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
            try execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT OR IGNORE INTO metadata VALUES ('version',0); CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY,payload TEXT NOT NULL,dirty INTEGER NOT NULL,version INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS note_changes ON notes(version); CREATE INDEX IF NOT EXISTS pending_notes ON notes(dirty); CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS file_changes ON files(version); CREATE TABLE IF NOT EXISTS sync_lease (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);")
            // Serialize legacy import with older app/share processes as well as new SQLite connections.
            let fd = open(directory.appendingPathComponent("store.lock").path, O_CREAT | O_RDWR, 0o600)
            guard fd >= 0 else { throw DoompileError.message("Не удалось заблокировать перенос заметок.") }
            defer { flock(fd, LOCK_UN); close(fd) }
            guard flock(fd, LOCK_EX) == 0 else { throw DoompileError.message("Не удалось заблокировать перенос заметок.") }
            try transaction {
                if try rows("SELECT value FROM metadata WHERE key='legacy-imported'").isEmpty {
                    let legacy = directory.appendingPathComponent("notes.json")
                    if FileManager.default.fileExists(atPath: legacy.path) {
                        let state = try decoder.decode(DiskState.self, from: Data(contentsOf: legacy))
                        for note in state.notes.values { try put(note, dirty: state.dirty.contains(note.id)) }
                        for (id, file) in state.files { try putFile(id, file) }
                    }
                    try execute("INSERT INTO metadata VALUES ('legacy-imported',1)")
                }
            }
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        } catch {
            sqlite3_close(handle); handle = nil
            throw error
        }
    }
    deinit { sqlite3_close(handle) }
    private func error() -> Error { DoompileError.message("Ошибка локальной базы заметок: " + String(cString: sqlite3_errmsg(handle))) }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw error() }
    }
    private func statement(_ sql: String, _ values: [String]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw error() }
        for (offset,value) in values.enumerated() {
            guard sqlite3_bind_text(statement, Int32(offset + 1), value, -1, transient) == SQLITE_OK else { sqlite3_finalize(statement); throw error() }
        }
        return statement
    }
    private func rows(_ sql: String, _ values: [String] = []) throws -> [[String]] {
        let query = try statement(sql, values)
        defer { sqlite3_finalize(query) }
        var result: [[String]] = []
        while true {
            let status = sqlite3_step(query)
            if status == SQLITE_DONE { return result }
            guard status == SQLITE_ROW else { throw error() }
            result.append((0..<sqlite3_column_count(query)).map { index in
                sqlite3_column_text(query,index).map { String(cString:$0) } ?? ""
            })
        }
    }
    private func write(_ sql: String, _ values: [String]) throws {
        let query = try statement(sql,values)
        defer { sqlite3_finalize(query) }
        guard sqlite3_step(query) == SQLITE_DONE else { throw error() }
    }
    func transaction<T>(_ operation: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do { let value = try operation(); try execute("COMMIT"); return value }
        catch { try? execute("ROLLBACK"); throw error }
    }
    private func version() throws -> Int64 { Int64(try rows("SELECT value FROM metadata WHERE key='version'")[0][0]) ?? 0 }
    private func nextVersion() throws -> Int64 {
        try execute("UPDATE metadata SET value=value+1 WHERE key='version'")
        return try version()
    }
    /// Persist ownership in a short transaction; never hold an OS lock across network awaits.
    func acquireSyncLease(owner: String, now: Date, duration: TimeInterval) throws -> Bool {
        try transaction {
            let instant = Int64(now.timeIntervalSince1970 * 1000)
            // UUID-only leases belong to 9.1; installing this version ends that process.
            if let row = try rows("SELECT owner,expires FROM sync_lease WHERE id=1").first,
               let expires = Int64(row[1]), expires > instant, row[0].hasPrefix("lease-v2:") { return false }
            try write("INSERT INTO sync_lease(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires", [owner, String(instant + Int64(duration * 1000))])
            return true
        }
    }
    func renewSyncLease(owner: String, now: Date, duration: TimeInterval) throws -> Bool {
        try transaction {
            let instant = Int64(now.timeIntervalSince1970 * 1000)
            guard let row = try rows("SELECT owner,expires FROM sync_lease WHERE id=1").first,
                  row[0] == owner, let expires = Int64(row[1]), expires > instant else { return false }
            try write("UPDATE sync_lease SET expires=? WHERE id=1 AND owner=?", [String(instant + Int64(duration * 1000)), owner])
            return true
        }
    }
    func releaseSyncLease(owner: String) throws {
        try write("DELETE FROM sync_lease WHERE id=1 AND owner=?", [owner])
    }
    func pendingNotes() throws -> [Note] {
        try rows("SELECT payload FROM notes WHERE dirty=1").map { try decoder.decode(Note.self, from: Data($0[0].utf8)) }
    }
    func note(_ id: String) throws -> (note: Note, dirty: Bool)? {
        guard let row = try rows("SELECT payload,dirty FROM notes WHERE id=?",[id]).first else { return nil }
        return (try decoder.decode(Note.self, from:Data(row[0].utf8)),row[1] == "1")
    }
    func put(_ note: Note, dirty: Bool) throws {
        let payload = String(decoding: try encoder.encode(note), as: UTF8.self)
        try write("INSERT INTO notes VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,dirty=excluded.dirty,version=excluded.version",[note.id,payload,dirty ? "1":"0",String(try nextVersion())])
    }
    func putFile(_ id: String, _ file: LocalFile) throws {
        try write("INSERT INTO files VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version",[id,String(decoding:try encoder.encode(file),as:UTF8.self),String(try nextVersion())])
    }
    func file(_ id: String) throws -> LocalFile? {
        guard let row = try rows("SELECT payload FROM files WHERE id=?",[id]).first else { return nil }
        return try decoder.decode(LocalFile.self,from:Data(row[0].utf8))
    }
    func snapshot() throws -> DiskState {
        // Read a consistent version; decode only changed rows after the first load.
        try execute("BEGIN")
        do {
            let current = try version()
            var next = current < cachedVersion ? DiskState() : cached
            let since = current < cachedVersion ? 0 : cachedVersion
            for row in try rows("SELECT id,payload,dirty FROM notes WHERE version>?",[String(since)]) {
                next.notes[row[0]] = try decoder.decode(Note.self,from:Data(row[1].utf8))
                decodedSnapshotNotes += 1
                if row[2] == "1" { next.dirty.insert(row[0]) } else { next.dirty.remove(row[0]) }
            }
            for row in try rows("SELECT id,payload FROM files WHERE version>?",[String(since)]) {
                next.files[row[0]] = try decoder.decode(LocalFile.self,from:Data(row[1].utf8))
            }
            try execute("COMMIT")
            cached = next; cachedVersion = current
            return next
        } catch { try? execute("ROLLBACK"); throw error }
    }
}
