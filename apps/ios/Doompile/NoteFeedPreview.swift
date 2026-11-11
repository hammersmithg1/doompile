import SwiftUI
import UIKit

/// Feed rows share the web's text-first layout. Only sources and media are cards.
struct NoteCard: View {
    let note: Note
    var uploadStates: [String: AttachmentUploadState] = [:]

    private var source: NoteSource? { note.editorSource }
    private var showTitle: Bool {
        source == nil && note.attachments.isEmpty && !note.title.isEmpty
            && note.title != note.plainText.components(separatedBy: "\n").first
    }
    private static let date = ISO8601DateFormatter()
    private static let fractionalDate: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let time: DateFormatter = {
        let formatter = DateFormatter(); formatter.dateFormat = "HH:mm"; return formatter
    }()
    private var timestamp: String {
        (Self.fractionalDate.date(from: note.createdAt) ?? Self.date.date(from: note.createdAt))
            .map { Self.time.string(from: $0) } ?? ""
    }
    private func transfer(for attachment: Attachment) -> AttachmentUploadState? {
        attachment.url.hasPrefix("local:") ? uploadStates[attachment.id] ?? .queued : nil
    }

    var body: some View {
        Group {
            if note.urgent {
                VStack(alignment: .leading, spacing: 5) {
                    FeedLinkedText(text: note.displayTitle).font(.system(size: 15, weight: .semibold)).lineLimit(2)
                    if let tag = note.tags.first { Text(tag).font(.system(size: 10)).foregroundStyle(Palette.muted) }
                }
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Palette.urgent, in: RoundedRectangle(cornerRadius: 9))
            } else {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 8) {
                        if showTitle { FeedLinkedText(text: note.title).font(.system(size: 15, weight: .semibold)).lineLimit(2) }
                        if let source { FeedSourceSnippet(source: source) }
                        if !note.plainText.isEmpty { FeedTextExcerpt(text: note.plainText, comment: source != nil) }
                        if note.plainText.isEmpty && source == nil && note.attachments.isEmpty {
                            FeedLinkedText(text: note.displayTitle).font(.system(size: 15))
                        }
                        ForEach(note.attachments) { file in
                            if file.mimeType.hasPrefix("image/") {
                                AttachmentImage(attachment: file)
                                    .frame(maxWidth: .infinity, maxHeight: 240, alignment: .leading)
                                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
                                    .overlay(alignment: .bottomTrailing) {
                                        if let state = transfer(for: file) {
                                            AttachmentTransferBadge(state: state)
                                                .padding(.horizontal, 8).padding(.vertical, 6)
                                                .background(Palette.card, in: RoundedRectangle(cornerRadius: DesignTokens.radiusControl))
                                                .padding(8)
                                        }
                                    }
                            } else {
                                CaptureAttachmentSnippet(attachment: file, transfer: transfer(for: file))
                            }
                        }
                        if !note.tags.isEmpty {
                            Text(note.tags.map { "# " + $0 }.joined(separator: "   "))
                                .font(.system(size: 10)).foregroundStyle(Palette.muted)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    VStack(spacing: 6) {
                        Text(timestamp).font(.system(size: 11)).monospacedDigit()
                        if note.pinned { DoompileSymbol(systemName: "pin", size: 11).accessibilityLabel("Закреплено") }
                    }.foregroundStyle(Palette.muted).padding(.top, 3)
                }
                .padding(.vertical, 15)
                .overlay(alignment: .bottom) { Rectangle().fill(Palette.line).frame(height: 0.5) }
            }
        }.foregroundStyle(Palette.text).frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct FeedLinkedText: View {
    let text: String
    private var linked: AttributedString {
        var result = AttributedString(text)
        for link in FeedLinks.links(in: text) {
            guard let range = Range(link.range, in: text),
                  let start = AttributedString.Index(range.lowerBound, within: result),
                  let end = AttributedString.Index(range.upperBound, within: result) else { continue }
            result[start..<end].link = link.url
            result[start..<end].foregroundColor = DesignTokens.link
            result[start..<end].underlineStyle = .single
        }
        return result
    }
    var body: some View { Text(linked).tint(DesignTokens.link) }
}

private struct FeedSourceSnippet: View {
    let source: NoteSource
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let quote = source.quote, !quote.isEmpty {
                Text(quote).font(.system(size: 13)).lineSpacing(4).lineLimit(3)
            }
            if let url = source.navigationURL {
                Link(destination: url) {
                    HStack(spacing: 5) {
                        DoompileSymbol(systemName: "arrow.up.right", size: 11)
                        Text(url.host?.replacingOccurrences(of: "www.", with: "") ?? "Источник").lineLimit(1)
                        if let seconds = source.timestampSeconds { Text("· " + Note.timeLabel(seconds)) }
                    }.font(.system(size: 11))
                }.foregroundStyle(Palette.accent)
                    .accessibilityLabel(source.quote?.isEmpty == false ? "Открыть источник у цитаты" : "Открыть источник")
                    .accessibilityIdentifier("feed-source-link")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 14).padding(.horizontal, 16)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).strokeBorder(Palette.line) }
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(Palette.accent).frame(width: 3) }
    }
}

private struct FeedTextExcerpt: View {
    let text: String
    let comment: Bool
    @State private var long = false
    private var font: UIFont { .systemFont(ofSize: comment ? 12 : 15) }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if long {
                HStack(spacing: 5) { DoompileSymbol(systemName: "doc.text", size: 12); Text("Заметка") }
                    .font(.system(size: 10)).foregroundStyle(Palette.muted)
            }
            FeedLinkedText(text: text)
                .font(.system(size: font.pointSize))
                .foregroundStyle(comment ? Palette.muted : Palette.text)
                .lineSpacing(5).lineLimit(long ? 5 : nil)
                .fixedSize(horizontal: false, vertical: true)
                .background {
                    GeometryReader { geometry in
                        Color.clear.onChange(of: geometry.size.width, initial: true) { _, width in measure(width) }
                            .onChange(of: text) { _, _ in measure(geometry.size.width) }
                    }
                }
            if long {
                HStack(spacing: 5) { Text("Читать дальше"); DoompileSymbol(systemName: "arrow.up.right", size: 13) }
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.muted)
            }
        }
        .padding(.leading, long ? 11 : 0).padding(.vertical, long ? 4 : 0)
        .overlay(alignment: .leading) {
            if long { Rectangle().fill(Palette.line).frame(width: 2) }
        }
    }
    private func measure(_ width: CGFloat) {
        guard width > 0 else { return }
        let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 5
        let bounds = (text as NSString).boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font, .paragraphStyle: paragraph], context: nil)
        long = bounds.height > 20 * font.lineHeight + 19 * paragraph.lineSpacing + 1
    }
}
