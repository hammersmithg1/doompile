import Foundation

/// Shared by the iPhone editor and Mac workspace; closing never means discarding a populated note.
enum EditorLifecycle {
    static let autosaveDelay: Duration = .milliseconds(Contracts.autosaveMilliseconds)
    static func prepared(_ note: Note, plainText: String? = nil) -> Note {
        var value = note
        if let plainText { value.plainText = plainText }
        value.source = value.editorSource
        value.title = value.editorTitle
        return value
    }
    static func matchesStored(_ note: Note, _ stored: Note) -> Bool {
        var candidate = note
        candidate.revision = stored.revision
        candidate.updatedAt = stored.updatedAt
        return candidate == stored
    }
    static func shouldSave(_ note: Note, existing: Bool) -> Bool {
        existing || !note.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !note.attachments.isEmpty || note.editorSource != nil || meaningful(note.body)
    }
    private static func meaningful(_ value: JSONValue) -> Bool {
        guard case .object(let node) = value else { return false }
        if case .string(let text) = node["text"], !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        if case .string(let type) = node["type"], !["doc", "paragraph", "heading", "text", "hardBreak", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "blockquote", "codeBlock"].contains(type) { return true }
        if case .array(let children) = node["content"] { return children.contains(where: meaningful) }
        return false
    }
}

/// Durable native draft storage, shared by iOS and macOS, with recovery of earlier Mac drafts.
enum EditorDrafts {
    static var directory: URL { Storage.shared.directory.appendingPathComponent("editor-drafts", isDirectory: true) }
    private static var legacy: URL { Storage.shared.directory.appendingPathComponent("mac-drafts", isDirectory: true) }
    static func load(_ note: Note) -> Note {
        for folder in [directory, legacy] {
            if let data = try? Data(contentsOf: folder.appendingPathComponent(note.id + ".json")), let draft = try? JSONDecoder().decode(Note.self, from: data) { return draft }
        }
        return note
    }
    static func save(_ note: Note) throws {
        do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(note).write(to: directory.appendingPathComponent(note.id + ".json"), options: [.atomic])
        UserDefaults.standard.set(note.id, forKey: "editorLastDraft:" + Connection.scope)
        } catch { Telemetry.shared.failure(.storageFailed, error, ["operation": "update"]); throw error }
    }
    static func last() -> Note? {
        let id = UserDefaults.standard.string(forKey: "editorLastDraft:" + Connection.scope) ?? UserDefaults.standard.string(forKey: "macLastDraft:" + Connection.scope)
        guard let id, UUID(uuidString: id) != nil else { return nil }
        for folder in [directory, legacy] {
            if let data = try? Data(contentsOf: folder.appendingPathComponent(id + ".json")), let note = try? JSONDecoder().decode(Note.self, from: data) { return note }
        }
        return nil
    }
    static func clear(_ id: String) {
        for folder in [directory, legacy] { try? FileManager.default.removeItem(at: folder.appendingPathComponent(id + ".json")) }
        for key in ["editorLastDraft", "macLastDraft"] where UserDefaults.standard.string(forKey: key + ":" + Connection.scope) == id { UserDefaults.standard.removeObject(forKey: key + ":" + Connection.scope) }
    }
}
