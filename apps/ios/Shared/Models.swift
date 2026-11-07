import Foundation

enum JSONValue: Codable, Equatable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    static func document(_ text: String) -> JSONValue {
        .object(["type": .string("doc"), "content": .array(text.components(separatedBy: "\n").map { line in
            .object(["type": .string("paragraph"), "content": .array(line.isEmpty ? [] : [.object(["type": .string("text"), "text": .string(line)])])])
        })])
    }
    /// Recover legacy captures whose file metadata was saved without a document node.
    func includingAttachments(_ attachments: [Attachment]) -> JSONValue {
        if case .object(let doc) = self, case .object(let attrs) = doc["attrs"], attrs["attachmentRecoveryVersion"] == .number(1) { return self }
        var known = Set<String>()
        func visit(_ value: JSONValue) {
            guard case .object(let node) = value else { return }
            if case .object(let attrs) = node["attrs"] {
                if node["type"] == .string("image"), case .string(let url) = attrs["src"] { known.insert(url) }
                if node["type"] == .string("attachment"), case .string(let url) = attrs["url"] { known.insert(url) }
            }
            if case .array(let children) = node["content"] { children.forEach(visit) }
        }
        visit(self)
        guard case .object(var doc) = self, doc["type"] == .string("doc") else { return self }
        var children: [JSONValue] = []
        if case .array(let content) = doc["content"] { children = content }
        for file in attachments where !known.contains(file.url) {
            let image = file.mimeType.hasPrefix("image/")
            var attrs: [String: JSONValue] = ["id": .string(file.id), "name": .string(file.name), "mimeType": .string(file.mimeType), "size": .number(Double(file.size))]
            attrs[image ? "src" : "url"] = .string(file.url)
            if image { attrs["alt"] = .string(file.name) }
            children.append(.object(["type": .string("paragraph"), "content": .array([.object(["type": .string(image ? "image" : "attachment"), "attrs": .object(attrs)])])]))
            known.insert(file.url)
        }
        doc["content"] = .array(children)
        var attrs: [String: JSONValue] = [:]
        if case .object(let existing) = doc["attrs"] { attrs = existing }
        attrs["attachmentRecoveryVersion"] = .number(1)
        doc["attrs"] = .object(attrs)
        return .object(doc)
    }
    /// Detect plain-text documents without discarding custom block structure.
    var isPlainParagraphDocument: Bool {
        guard case .object(let doc) = self,
              doc["type"] == .string("doc"),
              case .array(let paragraphs) = doc["content"],
              Set(doc.keys).isSubset(of: ["type", "content"]) else { return false }
        return paragraphs.allSatisfy { value in
            guard case .object(let paragraph) = value,
                  paragraph["type"] == .string("paragraph"),
                  Set(paragraph.keys).isSubset(of: ["type", "content"]) else { return false }
            if paragraph["content"] == nil { return true }
            guard case .array(let text) = paragraph["content"] else { return false }
            return text.allSatisfy { value in
                guard case .object(let node) = value else { return false }
                return node["type"] == .string("text") && Set(node.keys).isSubset(of: ["type", "text"])
            }
        }
    }
    func hasFinishedRecording(_ id: String) -> Bool {
        guard case .object(let node) = self else { return false }
        if node["type"] == .string("attachment"), case .object(let attrs) = node["attrs"], attrs["recordingId"] == .string(id) { return true }
        if case .array(let content) = node["content"] { return content.contains { $0.hasFinishedRecording(id) } }
        return false
    }
    func finishingRecording(_ id: String, attachment: Attachment) -> JSONValue {
        var found = false
        func replace(_ value: JSONValue) -> JSONValue {
            guard case .object(var node) = value else { return value }
            if node["type"] == .string("attachment"), case .object(let attrs) = node["attrs"], attrs["recordingId"] == .string(id) { found = true; return value }
            if node["type"] == .string("recording"), case .object(let attrs) = node["attrs"], attrs["id"] == .string(id) {
                found = true
                return .object(["type": .string("attachment"), "attrs": .object(["url": .string(attachment.url), "name": .string(attachment.name), "mimeType": .string(attachment.mimeType), "size": .number(Double(attachment.size)), "recordingId": .string(id)])])
            }
            if case .array(let content) = node["content"] { node["content"] = .array(content.map(replace)) }
            return .object(node)
        }
        var result = replace(self)
        if !found, case .object(var doc) = result {
            let placeholder: JSONValue = .object(["type": .string("recording"), "attrs": .object(["id": .string(id)])])
            var content: [JSONValue] = []; if case .array(let existing) = doc["content"] { content = existing }
            content.append(replace(placeholder)); content.append(.object(["type": .string("paragraph")]))
            doc["content"] = .array(content); result = .object(doc)
        }
        return result
    }
    func replacingString(_ source: String, with replacement: String) -> JSONValue {
        switch self {
        case .object(let object): return .object(object.mapValues { $0.replacingString(source, with: replacement) })
        case .array(let array): return .array(array.map { $0.replacingString(source, with: replacement) })
        case .string(let string): return .string(string == source ? replacement : string)
        default: return self
        }
    }
}

struct NoteSource: Codable, Equatable {
    var url: String
    var title: String?
    var quote: String?
    var timestampSeconds: Double?
    var articleText: String?
    var selector: JSONValue?
}

struct Attachment: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var mimeType: String
    var url: String
    var size: Int
}

struct MediaURLReplacement: Codable, Equatable {
    let from: String
    let to: String
}

struct NoteAcknowledgement {
    let note: Note
    let replacements: [MediaURLReplacement]
}

struct Note: Codable, Identifiable, Equatable {
    var id = UUID().uuidString.lowercased()
    var title = ""
    var body = JSONValue.document("")
    var plainText = ""
    var tags: [String] = []
    var pinned = false
    var urgent = false
    var kind = "note"
    var source: NoteSource?
    var attachments: [Attachment] = []
    var createdAt = Self.now()
    var updatedAt = Self.now()
    var deletedAt: String?
    var revision = 0

    /// Timeline placement is immutable across edits, pinning, urgency and sync acknowledgements.
    static func newestFirst(_ lhs: Note, _ rhs: Note) -> Bool {
        lhs.createdAt == rhs.createdAt ? lhs.id > rhs.id : lhs.createdAt > rhs.createdAt
    }

    /// Recognize our own save acknowledgement without adopting an unrelated remote edit.
    static func acknowledging(saved: Note, server: Note, current: Note) -> NoteAcknowledgement? {
        guard saved.id == server.id, current.id == saved.id, server.revision >= saved.revision else { return nil }
        var expected = saved
        var replacements: [MediaURLReplacement] = []
        for index in expected.attachments.indices {
            let previous = saved.attachments[index]
            guard let uploaded = server.attachments.first(where: { $0.id == previous.id }) else { continue }
            expected.attachments[index] = uploaded
            if previous.url != uploaded.url {
                replacements.append(MediaURLReplacement(from: previous.url, to: uploaded.url))
                expected.body = expected.body.replacingString(previous.url, with: uploaded.url)
            }
        }
        expected.revision = server.revision
        guard expected == server else { return nil }
        var updated = current
        updated.revision = server.revision
        for previous in saved.attachments {
            guard let index = updated.attachments.firstIndex(where: { $0.id == previous.id }),
                  updated.attachments[index].url == previous.url,
                  var uploaded = server.attachments.first(where: { $0.id == previous.id }) else { continue }
            if updated.attachments[index].name != previous.name { uploaded.name = updated.attachments[index].name }
            updated.attachments[index] = uploaded
        }
        for replacement in replacements { updated.body = updated.body.replacingString(replacement.from, with: replacement.to) }
        return NoteAcknowledgement(note: updated, replacements: replacements)
    }

    static func now() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
    static func text(_ text: String) -> Note {
        var note = Note()
        note.plainText = text
        note.title = String(text.components(separatedBy: .newlines).first?.prefix(NoteLimits.generatedTitle) ?? "")
        note.body = .document(text)
        return note
    }
    /// Lift legacy titles and captures into movable editor blocks once.
    var editorDocument: JSONValue {
        guard case .object(var document) = body else { return body }
        if let source, case .array(let nodes) = document["content"] {
            let context = source.quoteContext
            document["content"] = .array(nodes.map { value in
                guard case .object(var node) = value, node["type"] == .string("sourceSnippet"), case .object(var attrs) = node["attrs"], attrs["url"] == .string(source.url) else { return value }
                if attrs["quote"] != nil && attrs["quote"] != .string(source.quote ?? "") { return value }
                if !context.prefix.isEmpty, attrs["quotePrefix"] == nil || attrs["quotePrefix"] == .string("") { attrs["quotePrefix"] = .string(context.prefix) }
                if !context.suffix.isEmpty, attrs["quoteSuffix"] == nil || attrs["quoteSuffix"] == .string("") { attrs["quoteSuffix"] = .string(context.suffix) }
                node["attrs"] = .object(attrs); return .object(node)
            })
        }
        if case .object(let attrs) = document["attrs"], attrs["captureVersion"] == .number(2) { return .object(document) }
        let versioned: Bool
        if case .object(let attrs) = document["attrs"] { versioned = attrs["editorVersion"] == .number(1) } else { versioned = false }
        var content: [JSONValue] = []
        if case .array(let nodes) = document["content"] { content = nodes }
        func text(_ node: JSONValue) -> String {
            guard case .object(let value) = node else { return "" }
            if case .string(let text) = value["text"] { return text }
            if case .array(let children) = value["content"] { return children.map(text).joined() }
            return ""
        }
        let provenance = editorSource
        let hasSourceBlock = content.contains { value in
            guard case .object(let node) = value, node["type"] == .string("sourceSnippet"), case .object(let attrs) = node["attrs"] else { return false }
            return attrs["url"] == .string(provenance?.url ?? "")
        }
        if let provenance, !versioned || hasSourceBlock {
            var prefix = true, seenSource = false
            content = content.filter { value in
                guard prefix, case .object(let node) = value else { return true }
                if node["type"] == .string("sourceSnippet") {
                    guard case .object(let attrs) = node["attrs"], attrs["url"] == .string(provenance.url) else { prefix = false; return true }
                    if seenSource { return false }; seenSource = true; return true
                }
                let valueText = text(value).trimmingCharacters(in: .whitespacesAndNewlines)
                if (node["type"] == .string("heading") && valueText == (provenance.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) || (node["type"] == .string("blockquote") && valueText == (provenance.quote ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) { return false }
                prefix = false; return true
            }
        }
        if versioned {
            guard hasSourceBlock else { return body }
            document["content"] = .array(content)
            var attrs: [String: JSONValue] = [:]; if case .object(let existing) = document["attrs"] { attrs = existing }
            attrs["captureVersion"] = .number(2); document["attrs"] = .object(attrs)
            return .object(document)
        }
        func hasType(_ type: String) -> Bool {
            func contains(_ value: JSONValue) -> Bool {
                guard case .object(let node) = value else { return false }
                if node["type"] == .string(type) { return true }
                if case .array(let children) = node["content"] { return children.contains(where: contains) }
                return false
            }
            return content.contains(where: contains)
        }
        if title != provenance?.title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, content.first.map(text)?.trimmingCharacters(in: .whitespacesAndNewlines) != title.trimmingCharacters(in: .whitespacesAndNewlines), !content.contains(where: { if case .object(let node) = $0 { return node["type"] == .string("heading") && text($0) == title }; return false }) {
            content.insert(.object(["type": .string("heading"), "attrs": .object(["level": .number(1)]), "content": .array([.object(["type": .string("text"), "text": .string(title)])])]), at: 0)
        }
        if let source, !hasType("sourceSnippet") {
            var attrs: [String: JSONValue] = ["url": .string(source.url), "title": .string(source.title ?? ""), "quote": .string(source.quote ?? "")]
            if !source.quoteContext.prefix.isEmpty { attrs["quotePrefix"] = .string(source.quoteContext.prefix) }
            if !source.quoteContext.suffix.isEmpty { attrs["quoteSuffix"] = .string(source.quoteContext.suffix) }
            if let seconds = source.timestampSeconds { attrs["timestampSeconds"] = .number(seconds) }
            content.insert(.object(["type": .string("sourceSnippet"), "attrs": .object(attrs)]), at: 0)
        }
        document["content"] = .array(content)
        var attrs: [String: JSONValue] = [:]
        if case .object(let existing) = document["attrs"] { attrs = existing }
        attrs["editorVersion"] = .number(1)
        if provenance != nil { attrs["captureVersion"] = .number(2) }
        document["attrs"] = .object(attrs)
        return .object(document)
    }
    var editorSource: NoteSource? {
        if let source { return source }
        func firstSource(_ value: JSONValue) -> NoteSource? {
            guard case .object(let node) = value else { return nil }
            if node["type"] == .string("sourceSnippet"), case .object(let attrs) = node["attrs"], case .string(let href) = attrs["url"], let url = URL(string: href), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                var result = NoteSource(url: href)
                if case .string(let title) = attrs["title"] { result.title = title }
                if case .string(let quote) = attrs["quote"] { result.quote = quote }
                let prefix = attrs["quotePrefix"] ?? .string("")
                let suffix = attrs["quoteSuffix"] ?? .string("")
                if prefix != .string("") || suffix != .string("") { result.selector = .object(["type": .string("TextQuoteSelector"), "exact": .string(result.quote ?? ""), "prefix": prefix, "suffix": suffix]) }
                if case .number(let seconds) = attrs["timestampSeconds"], seconds >= 0 { result.timestampSeconds = seconds }
                return result
            }
            if case .array(let children) = node["content"] { return children.compactMap(firstSource).first }
            return nil
        }
        return firstSource(body)
    }
    var editorTitle: String {
        func text(_ value: JSONValue) -> String {
            guard case .object(let node) = value else { return "" }
            if node["type"] == .string("sourceSnippet") { return "" }
            if node["type"] == .string("noteReference"), case .object(let attrs) = node["attrs"], case .string(let title) = attrs["title"] { return title }
            if case .string(let value) = node["text"] { return value }
            if case .array(let children) = node["content"] { return children.map(text).joined() }
            return ""
        }
        if case .object(let doc) = body, case .array(let content) = doc["content"], let first = content.map(text).first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { return String(first.prefix(120)) }
        return editorSource?.title ?? editorSource?.url ?? attachments.first?.name ?? ""
    }
    var displayTitle: String { title.isEmpty ? (source?.title ?? source?.url ?? "Без названия") : title }
    var icon: String {
        switch kind {
        case "video": return "play.rectangle.fill"
        case "article": return "doc.richtext"
        case "image": return "photo"
        case "audio": return "waveform"
        case "file": return "doc"
        default: return "text.alignleft"
        }
    }
    static func timestamp(from url: URL) -> Double? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let value = items.first(where: { ["t", "start"].contains($0.name) })?.value
                ?? url.fragment?.replacingOccurrences(of: "t=", with: "") else { return nil }
        return parseTimestamp(value)
    }
    static func parseTimestamp(_ value: String) -> Double? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if let number = Double(text), number >= 0, number.isFinite, number <= Double(NoteLimits.timestampSeconds) { return number }
        if text.contains(":") {
            let tokens = text.split(separator: ":", omittingEmptySubsequences: false)
            let parts = tokens.compactMap { Double($0) }
            guard parts.count == tokens.count, parts.count <= 3, parts.allSatisfy({ $0 >= 0 && $0.isFinite }) else { return nil }
            let seconds = parts.reduce(0) { $0 * 60 + $1 }
            return seconds <= Double(NoteLimits.timestampSeconds) ? seconds : nil
        }
        let regex = try? NSRegularExpression(pattern: "(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?")
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex?.firstMatch(in: text, range: range), match.range == range, match.range.length > 0 else { return nil }
        let values = (1...3).map { i -> Double in
            guard let range = Range(match.range(at: i), in: text) else { return 0 }
            return Double(text[range]) ?? 0
        }
        let seconds = values[0] * 3600 + values[1] * 60 + values[2]
        return seconds.isFinite && seconds <= Double(NoteLimits.timestampSeconds) ? seconds : nil
    }
    static func timeLabel(_ seconds: Double) -> String {
        let total = seconds.isFinite && seconds >= 0 && seconds <= Double(Int.max / 2) ? Int(seconds) : 0
        if total >= 3600 { return String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60) }
        return String(format: "%d:%02d", total / 60, total % 60)
    }
    var sourceURL: URL? { (source ?? editorSource)?.navigationURL }
}

struct LocalFile: Codable {
    var filename: String
    var mimeType: String
}

struct DiskState: Codable {
    var notes: [String: Note] = [:]
    var dirty: Set<String> = []
    var files: [String: LocalFile] = [:]
}
