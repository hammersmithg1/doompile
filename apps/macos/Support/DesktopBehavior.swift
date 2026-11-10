import Foundation

typealias MacFeedSection = FeedSection

enum MacDates {
    private static let fractional: ISO8601DateFormatter = { let value = ISO8601DateFormatter(); value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return value }()
    private static let internet = ISO8601DateFormatter()
    static let day: DateFormatter = { let value = DateFormatter(); value.locale = Locale(identifier: "ru_RU"); value.dateFormat = "d MMMM"; return value }()
    static let time: DateFormatter = { let value = DateFormatter(); value.dateFormat = "HH:mm"; return value }()
    static func date(_ value: String) -> Date? { fractional.date(from: value) ?? internet.date(from: value) }
    static func timeLabel(_ value: String) -> String { date(value).map { time.string(from: $0) } ?? "" }
}

/// Compact preview of the actual document, without repeating a clip's source.
enum MacPreview {
    static func text(_ value: JSONValue) -> String {
        guard case .object(let node) = value else { return "" }
        let type = node["type"]
        if type == .string("sourceSnippet") || type == .string("image") || type == .string("attachment") { return "" }
        if type == .string("hardBreak") { return "\n" }
        if type == .string("noteReference"), case .object(let attrs) = node["attrs"], case .string(let title) = attrs["title"] { return "@" + title }
        if case .string(let text) = node["text"] { return text }
        guard case .array(let content) = node["content"] else { return "" }
        let separator = ["doc", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "blockquote", "table", "tableRow"].contains(type?.string ?? "") ? "\n" : ""
        let result = content.map(text).filter { !$0.isEmpty }.joined(separator: separator)
        if type == .string("listItem") { return "• " + result }
        if type == .string("taskItem") {
            let checked: Bool
            if case .object(let attrs) = node["attrs"] { checked = attrs["checked"] == .bool(true) } else { checked = false }
            return (checked ? "☑ " : "○ ") + result
        }
        return result
    }
    static func text(for note: Note) -> String { text(note.editorDocument).trimmingCharacters(in: .whitespacesAndNewlines) }
    static func hasContent(_ note: Note) -> Bool {
        EditorLifecycle.shouldSave(note, existing: false)
    }
}

extension JSONValue {
    var string: String? { if case .string(let value) = self { return value }; return nil }
}

/// A panel draft has its own identity and does not replace a main-window draft.
final class MacCaptureDraftStore {
    let url: URL
    init(directory: URL, filename: String = "mac-quick-capture.json") { url = directory.appendingPathComponent(filename) }
    func load() throws -> Note? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(Note.self, from: Data(contentsOf: url))
    }
    func save(_ note: Note) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: url.path), let original = try? Data(contentsOf: url), (try? JSONDecoder().decode(Note.self, from: original)) == nil {
            // Preserve unreadable bytes before starting a new draft in this slot.
            let recovery = url.deletingLastPathComponent().appendingPathComponent("mac-quick-capture-recovery-" + UUID().uuidString + ".json")
            try original.write(to: recovery, options: .withoutOverwriting)
        }
        try JSONEncoder().encode(note).write(to: url, options: .atomic)
    }
    func clear() throws { if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) } }
}

enum MacQuickDocument {
    static func needsRichEditor(_ note: Note) -> Bool {
        !note.body.isPlainParagraphDocument && note.body != updating(note, text: note.plainText).body
    }

    static func referencedFiles(in note: Note) -> [Attachment] {
        var urls = Set<String>()
        func collect(_ value: JSONValue) {
            guard case .object(let node) = value else { return }
            if case .object(let attrs) = node["attrs"] {
                if node["type"] == .string("image"), let url = attrs["src"]?.string { urls.insert(url) }
                if node["type"] == .string("attachment"), let url = attrs["url"]?.string { urls.insert(url) }
            }
            if case .array(let children) = node["content"] { children.forEach(collect) }
        }
        collect(note.body)
        return note.attachments.filter { urls.contains($0.url) }
    }

    /// The compact native input edits text; retain every media node's metadata.
    static func updating(_ original: Note, text: String) -> Note {
        var media: [String: JSONValue] = [:]
        func collect(_ value: JSONValue) {
            guard case .object(let node) = value else { return }
            if case .object(let attrs) = node["attrs"], let url = (node["type"] == .string("image") ? attrs["src"] : attrs["url"])?.string { media[url] = value }
            if case .array(let children) = node["content"] { children.forEach(collect) }
        }
        collect(original.body)
        var note = original; note.plainText = text
        var content: [JSONValue] = []
        if case .object(let document) = JSONValue.document(text), case .array(let paragraphs) = document["content"] { content = paragraphs }
        for file in note.attachments {
            let image = file.mimeType.hasPrefix("image/")
            let node = media[file.url] ?? .object(["type": .string(image ? "image" : "attachment"), "attrs": .object([image ? "src" : "url": .string(file.url), "id": .string(file.id), "name": .string(file.name), "mimeType": .string(file.mimeType), "size": .number(Double(file.size))])])
            content.append(.object(["type": .string("paragraph"), "content": .array([node])]))
        }
        note.body = .object(["type": .string("doc"), "content": .array(content)])
        return note
    }
}
