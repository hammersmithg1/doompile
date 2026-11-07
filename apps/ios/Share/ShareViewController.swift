import UIKit
import SwiftUI
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Telemetry.shared.record(.screenViewed, ["screen": "capture"])
        guard Connection.signedIn else {
            let label = UILabel(); label.text = "Сначала войди в аккаунт в приложении Doompile."; label.numberOfLines = 0; label.textAlignment = .center
            label.frame = view.bounds.insetBy(dx:24,dy:24); label.autoresizingMask = [.flexibleWidth,.flexibleHeight]; view.addSubview(label)
            return
        }
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareCapture(model: model))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        host.didMove(toParent: self)
        Task { await model.load() }
    }
}

@MainActor final class ShareModel: ObservableObject {
    @Published var note = Note()
    @Published var comment = ""
    @Published var tags = ""
    @Published var timecode = ""
    @Published var loading = true
    @Published var saving = false
    @Published var loadFailed = false
    @Published var saved = false
    @Published var error: String?
    private let accountScope = Connection.scope
    private let storage = Storage.shared
    private weak var context: NSExtensionContext?
    init(context: NSExtensionContext?) { self.context = context }

    func load() async {
        defer { loading = false }
        guard let items = context?.inputItems as? [NSExtensionItem] else { return }
        for item in items {
            for provider in item.attachments ?? [] {
                do {
                    if provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
                        if let payload = try await loadItem(provider, type: UTType.propertyList.identifier) as? [String: Any],
                           let values = payload[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] {
                            let url = values["url"] as? String ?? ""
                            if URL(string: url)?.scheme?.hasPrefix("http") == true {
                                note.source = NoteSource(url: url, title: values["title"] as? String, quote: values["selection"] as? String)
                                note.title = values["title"] as? String ?? ""
                                note.kind = "article"
                            }
                        }
                    } else if let identifier = provider.registeredTypeIdentifiers.first(where: { identifier in
                        guard let type = UTType(identifier) else { return false }
                        return type.conforms(to: .image) || type.conforms(to: .pdf) || type.conforms(to: .audio) || type.conforms(to: .movie)
                    }) {
                        let type = UTType(identifier) ?? .data
                        let name = provider.suggestedName ?? "Attachment.\(type.preferredFilenameExtension ?? "bin")"
                        try addFile(try await loadFile(provider, type: identifier), name: name, type: type)
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                        let item = try await loadItem(provider, type: UTType.url.identifier)
                        let url = (item as? URL) ?? (item as? String).flatMap(URL.init(string:))
                        if let url, url.isFileURL { try addFile(Data(contentsOf: url), name: url.lastPathComponent, type: UTType(filenameExtension: url.pathExtension) ?? .data) }
                        else if let url, ["https", "http"].contains(url.scheme ?? "") { setURL(url) }
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                        if let text = try await loadItem(provider, type: UTType.plainText.identifier) as? String {
                            // YouTube sometimes supplies a URL as plain text rather than public.url.
                            if let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), ["https", "http"].contains(url.scheme ?? "") { setURL(url) }
                            else { note.plainText += (note.plainText.isEmpty ? "" : "\n") + text }
                        }
                    } else if let identifier = provider.registeredTypeIdentifiers.first(where: { type in
                        guard let value = UTType(type) else { return false }
                        return value.conforms(to: .data) || value.conforms(to: .content)
                    }) {
                        let type = UTType(identifier) ?? .data
                        let name = provider.suggestedName ?? "Attachment.\(type.preferredFilenameExtension ?? "bin")"
                        let data = try await loadFile(provider, type: identifier)
                        try addFile(data, name: name, type: type)
                    }
                } catch { loadFailed = true; self.error = error.localizedDescription }
            }
        }
        if note.title.isEmpty { note.title = note.source?.title ?? note.source?.url ?? String(note.plainText.prefix(100)) }
        if let seconds = note.source?.timestampSeconds { timecode = Note.timeLabel(seconds) }
    }
    private func setURL(_ url: URL) {
        let host = url.host?.lowercased() ?? ""
        let youtube = host == "youtu.be" || host == "youtube.com" || host.hasSuffix(".youtube.com")
        if note.source?.url != url.absoluteString { note.source = NoteSource(url: url.absoluteString) }
        note.kind = youtube ? "video" : "article"
        note.source?.timestampSeconds = Note.timestamp(from: url)
    }
    private func loadItem(_ provider: NSItemProvider, type: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: value) }
            }
        }
    }
    private func loadFile(_ provider: NSItemProvider, type: String) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                if let error { continuation.resume(throwing: error) }
                else if let url {
                    do {
                        let count = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        guard count <= 30 * 1024 * 1024 else { throw DoompileError.message("Размер одного вложения — до 30 МБ.") }
                        continuation.resume(returning: try Data(contentsOf: url))
                    } catch { continuation.resume(throwing: error) }
                } else { continuation.resume(throwing: DoompileError.message("Исходное приложение не передало вложение.")) }
            }
        }
    }
    private func addFile(_ data: Data, name: String, type: UTType) throws {
        guard data.count <= 30 * 1024 * 1024 else { throw DoompileError.message("Размер одного вложения — до 30 МБ.") }
        note.attachments.append(try storage.addFile(data, name: name, mimeType: type.preferredMIMEType ?? "application/octet-stream"))
        if note.source == nil { note.kind = type.conforms(to: .image) ? "image" : type.conforms(to: .audio) ? "audio" : "file" }
    }
    func cancel() { context?.completeRequest(returningItems: nil) }
    func save() {
        guard Connection.signedIn, Connection.scope == accountScope else { error = "Аккаунт изменился. Открой меню «Поделиться» заново."; return }
        guard !loading, !loadFailed, !saving, !saved else { return }
        if note.kind == "video" && !timecode.isEmpty && Note.parseTimestamp(timecode) == nil { error = "Введи таймкод в формате 12:34."; return }
        error = nil
        saving = true
        var captured = note
        let text = [captured.plainText, comment].filter { !$0.isEmpty }.joined(separator: "\n\n")
        captured.plainText = text
        captured.body = JSONValue.document(text).includingAttachments(captured.attachments)
        captured.tags = Array(Set(tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted()
        if captured.kind == "video" { captured.source?.timestampSeconds = Note.parseTimestamp(timecode) }
        captured.updatedAt = Note.now()
        do {
            try storage.save(captured)
            Telemetry.shared.record(.captureSaved, ["note_id": captured.id, "kind": captured.kind])
            saved = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            Task {
                // The modal never waits for an unavailable network. The App Group outbox is durable.
                await withTaskGroup(of: Void.self) { group in
                    group.addTask { try? await SyncService.shared.sync(pull: false) }
                    group.addTask { try? await Task.sleep(for: .seconds(2)) }
                    await group.next()
                    group.cancelAll()
                }
                context?.completeRequest(returningItems: nil)
            }
        } catch { self.error = error.localizedDescription; saving = false }
    }
}

private struct ShareCapture: View {
    @AppStorage(AppearanceMode.storageKey, store: Connection.defaults) private var appearance: AppearanceMode = .system
    @ObservedObject var model: ShareModel
    var body: some View {
        ZStack {
            DoompilePalette.ink.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    DoompileWordmark(height: 20).foregroundStyle(DoompilePalette.muted)
                    Spacer()
                    Button { model.cancel() } label: { DoompileSymbol(systemName: "xmark", size: 14).font(.system(size: 14)).frame(width: 32, height: 32).background(DoompilePalette.card, in: Circle()) }.foregroundStyle(DoompilePalette.text).accessibilityLabel("Закрыть сохранение").accessibilityIdentifier("capture-close")
                }
                if model.saved { Text(UICopy.savedLocal).font(.system(size: 15)).foregroundStyle(DoompilePalette.muted) }
                ScrollView {
                    VStack(alignment: .leading, spacing: 15) {
                        if model.loading { ProgressView("Читаем содержимое…") }
                        if let source = model.note.source {
                            VStack(alignment: .leading, spacing: 8) {
                                DoompileLabel(URL(string: source.url)?.host ?? "Ссылка", systemImage: model.note.kind == "video" ? "play.rectangle" : "link").font(.system(size: 11, design: .monospaced)).foregroundStyle(DoompilePalette.accent)
                                Text(model.note.displayTitle).font(.system(size: 15, weight: .semibold)).lineLimit(3)
                                if let quote = source.quote, !quote.isEmpty { Text(quote).font(.system(size: 14)).foregroundStyle(DoompilePalette.muted).lineLimit(6) }
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(15).background(DoompilePalette.card, in: RoundedRectangle(cornerRadius: 14))
                        }
                        if !model.note.plainText.isEmpty { Text(model.note.plainText).font(.system(size: 14)).foregroundStyle(DoompilePalette.muted).lineLimit(5) }
                        if model.note.kind == "video" {
                            HStack { DoompileSymbol(systemName: "clock"); TextField("Таймкод · 12:34", text: $model.timecode).keyboardType(.numbersAndPunctuation) }.font(.system(size: 14)).padding(13).background(DoompilePalette.card, in: RoundedRectangle(cornerRadius: 12))
                            Text("Если исходное приложение не передало таймкод, добавь его здесь.").font(.system(size: 11)).foregroundStyle(DoompilePalette.muted)
                        }
                        ZStack(alignment: .topLeading) {
                            TextEditor(text: $model.comment).scrollContentBackground(.hidden).frame(minHeight: 140).padding(10)
                            if model.comment.isEmpty { Text(UICopy.commentPlaceholder).font(.system(size: 16)).foregroundStyle(DoompilePalette.muted).padding(18).allowsHitTesting(false) }
                        }.background(DoompilePalette.card, in: RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(DoompilePalette.line))
                        if !model.note.attachments.isEmpty { DoompileLabel("Вложений: \(model.note.attachments.count)", systemImage: "paperclip").font(.system(size: 13)).foregroundStyle(DoompilePalette.muted) }
                        HStack { DoompileSymbol(systemName: "tag"); TextField("Теги через запятую", text: $model.tags).textInputAutocapitalization(.never) }.font(.system(size: 13)).foregroundStyle(DoompilePalette.muted).padding(13).background(DoompilePalette.card, in: RoundedRectangle(cornerRadius: 12))
                        if let error = model.error { Text(error).font(.system(size: 12)).foregroundStyle(.orange) }
                    }
                }.scrollDismissesKeyboard(.interactively)
                Button { model.save() } label: {
                    HStack { Text(model.saved ? UICopy.saved : UICopy.save).font(.system(size: 16, weight: .bold)); Spacer(); DoompileSymbol(systemName: model.saved ? "checkmark" : "arrow.up").fontWeight(.bold) }.padding(18).foregroundStyle(DesignTokens.onLime).background(DoompilePalette.lime, in: Capsule())
                }.accessibilityIdentifier("capture-save").disabled(model.loading || model.loadFailed || model.saving || (model.note.source == nil && model.note.plainText.isEmpty && model.note.attachments.isEmpty && model.comment.isEmpty))
            }.padding(24).foregroundStyle(DoompilePalette.text)
        }.preferredColorScheme(appearance.colorScheme)
    }
}
