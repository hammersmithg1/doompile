import Foundation
import JavaScriptCore
import Security

struct NoteReplica: Codable, Equatable { var format = "yjs-1"; var data: String; var provisional: Bool? }
struct NoteChange: Codable, Equatable {
    var id: String; var update: String; var snapshot: String; var baseRevision: Int; var authoredAt: String; var origin: String
}
struct LegacyNoteChange: Codable, Equatable {
    var id: String; var note: Note; var baseline: Note?; var baseRevision: Int; var origin: String
}
struct NoteSyncState: Codable { var server: Note?; var legacyBaseline: Note? }
struct NoteClientRecord: Encodable {
    var note: Note; var dirty: Bool; var baseRevision: Int; var server: Note?; var legacyBaseline: Note?
}
struct StagedNote: Decodable { var note: Note; var changes: [NoteChange]; var legacy: [LegacyNoteChange] }
struct NoteJournalEntry: Codable, Equatable {
    var change: NoteChange?; var legacy: LegacyNoteChange?
    var id: String { change?.id ?? legacy!.id }
}

/// The same causal model runs in the server, browser and Apple clients.
final class NoteEngine: @unchecked Sendable {
    static let shared = NoteEngine()
    static var origin: String {
        #if os(macOS)
        return "macos"
        #else
        return "ios"
        #endif
    }
    private let lock = NSRecursiveLock()
    private var context: JSContext?
    private struct Call: Encodable {
        var op: String
        var current: NoteClientRecord?
        var note: Note?
        var changes: [NoteChange]?
        var origin: String = NoteEngine.origin
        var server: Note?
        var left: NoteReplica?
        var right: NoteReplica?
        var baseline: Note?
    }
    private func load() throws -> JSContext {
        if let context { return context }
        guard let js = JSContext() else { throw DoompileError.message("Не удалось запустить синхронизацию заметок.") }
        let toBase64: @convention(block) (String) -> String = { value in value.data(using: .isoLatin1)?.base64EncodedString() ?? "" }
        let fromBase64: @convention(block) (String) -> String = { value in Data(base64Encoded: value).flatMap { String(data: $0, encoding: .isoLatin1) } ?? "" }
        let random: @convention(block) (Int) -> String = { count in
            guard count >= 0, count <= 65536 else { return "" }
            var bytes = [UInt8](repeating: 0, count: count)
            guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { return "" }
            return Data(bytes).base64EncodedString()
        }
        js.setObject(toBase64, forKeyedSubscript: "btoa" as NSString)
        js.setObject(fromBase64, forKeyedSubscript: "atob" as NSString)
        js.setObject(random, forKeyedSubscript: "_random" as NSString)
        js.evaluateScript("""
        globalThis.crypto = {
          getRandomValues(array) { const binary = atob(_random(array.byteLength)); if (binary.length !== array.byteLength) throw Error('Random source unavailable'); const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength); for (let i=0; i<bytes.length; i++) bytes[i]=binary.charCodeAt(i); return array; },
          randomUUID() { const b = new Uint8Array(16); crypto.getRandomValues(b); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128; const h=Array.from(b,v=>v.toString(16).padStart(2,'0')).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
        };
        globalThis.console = { log(){}, warn(){}, error(){} };
        """)
        #if SWIFT_PACKAGE
        let url = Bundle.module.url(forResource: "sync", withExtension: "js", subdirectory: "Resources")
        #else
        let url = Bundle.main.resourceURL?.appendingPathComponent("EditorResources/sync.js")
        #endif
        guard let url, let source = try? String(contentsOf: url, encoding: .utf8) else { throw DoompileError.message("В приложении отсутствует модуль синхронизации. Обнови приложение.") }
        js.evaluateScript(source)
        guard js.exception == nil, js.objectForKeyedSubscript("DoompileSync")?.isUndefined == false else { throw DoompileError.message("Не удалось загрузить модуль синхронизации.") }
        context = js; return js
    }
    private func call<T: Decodable>(_ input: Call, as type: T.Type = T.self) throws -> T {
        lock.lock(); defer { lock.unlock() }
        let js = try load(); js.exception = nil
        let json = String(decoding: try JSONEncoder().encode(input), as: UTF8.self)
        let result = js.objectForKeyedSubscript("DoompileSync")?.invokeMethod("run", withArguments: [json])
        guard js.exception == nil, let result, result.isString, let text = result.toString() else { js.exception = nil; throw DoompileError.message("Не удалось объединить изменения заметки. Локальное содержимое сохранено.") }
        return try JSONDecoder().decode(T.self, from: Data(text.utf8))
    }
    func stage(_ note: Note, current: NoteClientRecord?, changes: [NoteChange] = []) throws -> StagedNote { try call(Call(op: "stage", current: current, note: note, changes: changes)) }
    func receive(_ note: Note?, server: Note) throws -> Note {
        // receive accepts a note rather than an outbox record.
        lock.lock(); defer { lock.unlock() }
        let js = try load(); js.exception = nil
        var payload: [String: Any] = ["op": "receive", "server": try JSONSerialization.jsonObject(with: JSONEncoder().encode(server))]
        if let note { payload["current"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(note)) }
        let json = String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self)
        let result = js.objectForKeyedSubscript("DoompileSync")?.invokeMethod("run", withArguments: [json])
        guard js.exception == nil, let result, result.isString, let text = result.toString() else { js.exception = nil; throw DoompileError.message("Не удалось объединить изменения заметки. Локальное содержимое сохранено.") }
        return try JSONDecoder().decode(Note.self, from: Data(text.utf8))
    }
    func prepare(_ note: Note) throws -> Note { try call(Call(op: "prepare", note: note)) }
    func migrate(_ note: Note, server: Note, baseline: Note?) throws -> Note { try call(Call(op: "migrate", note: note, server: server, baseline: baseline)) }
    func recovery(_ note: Note, server: Note?) throws -> NoteChange { try call(Call(op: "recovery", note: note, server: server)) }
    func same(_ left: NoteReplica, _ right: NoteReplica) throws -> Bool { try call(Call(op: "equal", left: left, right: right)) }
}

/// Ordered background disk writes preserve raw input before any remote union/GC.
final class NoteWriter: @unchecked Sendable {
    static let shared = NoteWriter()
    private let queue = DispatchQueue(label: "doompile.note-journal", qos: .userInitiated)
    private struct Pending {
        let note: Note; let change: NoteChange; let storage: Storage
        let completion: @Sendable (Error?) -> Void
    }
    private var pending: [Pending] = []
    private func flush() throws {
        while let entry = pending.first {
            do { _ = try entry.storage.save(entry.note, changes: [entry.change]); pending.removeFirst(); entry.completion(nil) }
            catch { entry.completion(error); throw error }
        }
    }
    func enqueue(_ note: Note, change: NoteChange, storage: Storage, completion: @escaping @Sendable (Error?) -> Void) {
        queue.async {
            self.pending.append(Pending(note: note, change: change, storage: storage, completion: completion))
            do { try self.flush() } catch { /* Keep the raw event for the next retry/drain. */ }
        }
    }
    func drain() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do { try self.flush(); continuation.resume() }
                catch { continuation.resume(throwing: error) }
            }
        }
    }
}
