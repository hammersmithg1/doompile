import Foundation

/// Keep the source canonical; a text directive belongs only on the outgoing link.
extension NoteSource {
    var quoteContext: (prefix: String, suffix: String) {
        guard case .object(let value) = selector else { return ("", "") }
        let prefix: String; if case .string(let text) = value["prefix"] { prefix = text } else { prefix = "" }
        let suffix: String; if case .string(let text) = value["suffix"] { suffix = text } else { suffix = "" }
        return (prefix, suffix)
    }
    var navigationURL: URL? {
        guard var components = URLComponents(string: url), let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme), components.host != nil else { return nil }
        if let seconds = timestampSeconds, seconds.isFinite, seconds >= 0, seconds <= 31_536_000,
           let host = components.host?.lowercased(), host == "youtube.com" || host.hasSuffix(".youtube.com") || host == "youtu.be" || host.hasSuffix(".youtu.be") {
            var items = components.queryItems ?? []
            items.removeAll { $0.name == "t" }
            items.append(URLQueryItem(name: "t", value: String(Int(seconds))))
            components.queryItems = items
        }
        func normalized(_ value: String) -> String { value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
        func lines(_ value: String) -> [String] { value.components(separatedBy: .newlines).map(normalized).filter { !$0.isEmpty } }
        func edge(_ value: String, _ count: Int, end: Bool = false) -> String {
            let value = normalized(value)
            guard value.unicodeScalars.count > count else { return value }
            let scalars = Array(value.unicodeScalars)
            let part = String(String.UnicodeScalarView(end ? Array(scalars.suffix(count)) : Array(scalars.prefix(count))))
            let boundary = end ? part.firstIndex(of: " ") : part.lastIndex(of: " ")
            guard let boundary else { return part }
            return end ? String(part[part.index(after: boundary)...]) : String(part[..<boundary])
        }
        guard let quote, !normalized(quote).isEmpty else { return components.url }
        let clean = normalized(quote), parts = lines(quote), context = quoteContext
        let prefix = edge(lines(context.prefix).last ?? "", 64, end: true)
        let suffix = edge(lines(context.suffix).first ?? "", 64)
        let ranged = parts.count > 1 || clean.unicodeScalars.count > 240
        let start = ranged ? edge(parts.first ?? clean, 96) : clean
        let end = ranged ? edge(parts.last ?? clean, 96, end: true) : ""
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.~")
        func encoded(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        var directive = ""
        if !prefix.isEmpty { directive += encoded(prefix) + "-," }
        directive += encoded(start)
        if !end.isEmpty { directive += "," + encoded(end) }
        if !suffix.isEmpty { directive += ",-" + encoded(suffix) }
        let anchor = (components.percentEncodedFragment ?? "").components(separatedBy: ":~:").first ?? ""
        components.percentEncodedFragment = anchor + ":~:text=" + directive
        return components.url
    }
}
