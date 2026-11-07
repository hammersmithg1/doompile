import Foundation

/// Wire limits shared with the API. Validation never truncates document text or attachments.
enum NoteValidation {
    static func normalized(_ note: Note) -> Note {
        var value = note
        if value.title.utf16.count > NoteLimits.title {
            var units = Array(value.title.utf16.prefix(NoteLimits.title))
            if let last = units.last, (0xD800...0xDBFF).contains(last) { units.removeLast() }
            value.title = String(decoding: units, as: UTF16.self)
        }
        var seen = Set<String>()
        value.tags = value.tags.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty && seen.insert($0).inserted }
        return value
    }
    static func validate(_ note: Note) throws {
        func require(_ condition: Bool, _ message: String) throws {
            if !condition { throw DoompileError.message(message) }
        }
        try require(note.title.utf16.count <= NoteLimits.title, "Слишком длинный заголовок заметки.")
        try require(note.plainText.utf16.count <= NoteLimits.plainText, "Слишком большой текст заметки. Раздели его на несколько заметок.")
        try require(note.tags.count <= NoteLimits.tags && note.tags.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= NoteLimits.tagLength }, "Слишком много тегов или слишком длинный тег.")
        try require(note.attachments.count <= NoteLimits.attachments, "В одной заметке может быть не больше \(NoteLimits.attachments) вложений.")
        for file in note.attachments {
            try require(UUID(uuidString: file.id) != nil && !file.name.isEmpty && file.name.utf16.count <= NoteLimits.attachmentName && !file.mimeType.isEmpty && file.mimeType.utf16.count <= NoteLimits.mimeType && file.size >= 0 && file.url.utf16.count <= NoteLimits.url, "Некорректные метаданные вложения.")
        }
        if let source = note.source {
            if let timestamp = source.timestampSeconds { try require(timestamp.isFinite && timestamp >= 0 && timestamp <= Double(NoteLimits.timestampSeconds), "Некорректный таймкод источника.") }
            try require(source.url.utf16.count <= NoteLimits.url && ["https", "http"].contains(URL(string: source.url)?.scheme?.lowercased() ?? ""), "Некорректная ссылка источника.")
            try require((source.title?.utf16.count ?? 0) <= NoteLimits.title && (source.quote?.utf16.count ?? 0) <= NoteLimits.quote && (source.articleText?.utf16.count ?? 0) <= NoteLimits.articleText, "Слишком большой источник заметки.")
        }
        var count = 0
        func bounded(_ value: JSONValue, depth: Int) -> Bool {
            count += 1
            guard count <= NoteLimits.documentNodes, depth <= NoteLimits.documentDepth,
                  case .object(let node) = value, case .string(let type) = node["type"], type.utf16.count <= 100 else { return false }
            if let content = node["content"] {
                guard case .array(let children) = content else { return false }
                return children.allSatisfy { bounded($0, depth: depth + 1) }
            }
            return true
        }
        guard case .object(let document) = note.body, document["type"] == .string("doc"), bounded(note.body, depth: 0) else {
            throw DoompileError.message("Слишком сложный или повреждённый документ заметки.")
        }
        try require(try JSONEncoder().encode(note).count <= NoteLimits.requestBytes - 256, "Слишком большая заметка для синхронизации. Раздели её на несколько заметок.")
    }
}
