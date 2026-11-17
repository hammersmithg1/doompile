import Foundation
import SwiftUI
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct NoteVersion: Decodable, Identifiable {
    var revision: Int; var parentRevision: Int?; var createdAt: String; var authoredAt: String; var origin: String; var kind: String
    var id: Int { revision }
    var dateLabel: String {
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = format.date(from: createdAt) else { return createdAt }
        let display = DateFormatter(); display.locale = Locale(identifier: "ru_RU"); display.dateFormat = "d MMM, HH:mm:ss"
        return display.string(from: date)
    }
    var label: String {
        if kind == "restore" { return "Восстановление" }
        return ["web": "Веб", "ios": "iPhone", "macos": "Mac", "migration": "Начальная версия", "recovery": "Синхронизация", "clipper": "Расширение"][origin] ?? "Сохранение"
    }
}
enum NoteHistoryService {
    private struct Versions: Decodable { let versions: [NoteVersion] }
    private struct One: Decodable { let note: Note }
    private static let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    private static func request<T: Decodable>(_ path: String, body: Data? = nil, as type: T.Type) async throws -> T {
        guard let account = Connection.account, Connection.signedIn, let url = URL(string: account.endpoint + path) else { throw DoompileError.authentication }
        let scope = account.scope
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = body == nil ? "GET" : "POST"; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + Connection.token, forHTTPHeaderField: "Authorization")
        request.setValue(account.id, forHTTPHeaderField: "X-Doompile-User-ID")
        request.setValue(String(Contracts.apiVersion), forHTTPHeaderField: "X-Doompile-API-Version")
        let (data, response) = try await Telemetry.network(session, request: request)
        guard Connection.scope == scope else { throw URLError(.cancelled) }
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw DoompileError.message("Не удалось загрузить историю. Проверь соединение и повтори.") }
        return try JSONDecoder().decode(T.self, from: data)
    }
    static func versions(_ id: String, before: Int? = nil) async throws -> [NoteVersion] {
        try await request("/api/notes/\(id)/versions" + (before.map { "?before=\($0)" } ?? ""), as: Versions.self).versions
    }
    static func preview(_ id: String, revision: Int, authored: Bool) async throws -> Note {
        try await request("/api/notes/\(id)/versions/\(revision)" + (authored ? "?view=authored" : ""), as: One.self).note
    }
    static func restore(_ id: String, revision: Int, authored: Bool) async throws -> Note {
        try await NoteWriter.shared.drain()
        let storage = Storage.shared
        try await SyncService.shared.sync(pull: false)
        guard try storage.journal(id).isEmpty else { throw DoompileError.message("Сначала нужно отправить изменения этой заметки. Они сохранены на устройстве.") }
        let body = try JSONSerialization.data(withJSONObject: ["view": authored ? "authored" : "merged", "origin": NoteEngine.origin])
        let note = try await request("/api/notes/\(id)/versions/\(revision)", body: body, as: One.self).note
        try storage.merge([note]); return note
    }
}

struct NoteHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    let noteID: String
    let onRestored: (Note) -> Void
    @State private var versions: [NoteVersion] = []
    @State private var selected: Int?
    @State private var authored = false
    @State private var preview: Note?
    @State private var previewRevision: Int?
    @State private var previewAuthored = false
    @State private var loading = true
    @State private var restoring = false
    @State private var more = false
    @State private var error: String?
    private var selectionKey: String { "\(selected.map(String.init) ?? "none"):\(authored)" }
    private var visiblePreview: Note? { previewRevision == selected && previewAuthored == authored ? preview : nil }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error { HStack { Text(error).font(.system(size: 13)).foregroundStyle(DesignTokens.danger); Spacer(); Button("Повторить") { Task { await load() } } }.padding() }
                GeometryReader { geometry in
                    if geometry.size.width >= 620 {
                        HStack(spacing: 0) { versionList(horizontal: false).frame(width: 230); Divider(); versionPreview }
                    } else {
                        VStack(spacing: 0) { versionList(horizontal: true).frame(height: 106); Divider(); versionPreview }
                    }
                }
                Divider()
                VStack(alignment: .leading, spacing: 12) {
                    Text("Восстановление сохранит текущую версию в истории.").font(.system(size: 12)).foregroundStyle(DesignTokens.muted)
                    HStack { Spacer(); Button { Task { await restore() } } label: {
                        Text(restoring ? "Восстанавливаем…" : "Восстановить версию").font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 17).padding(.vertical, 11)
                            .foregroundStyle(DesignTokens.onLime).background(DesignTokens.lime, in: RoundedRectangle(cornerRadius: 9))
                    }.buttonStyle(.plain).disabled(visiblePreview == nil || restoring).opacity(visiblePreview == nil || restoring ? 0.5 : 1) }
                }.padding(16)
            }
            .background(DesignTokens.background).navigationTitle("История версий")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() }.foregroundStyle(DesignTokens.text).disabled(restoring) } }
        }
        #if os(macOS)
        .frame(minWidth: 760, idealWidth: 900, minHeight: 560, idealHeight: 650)
        #endif
        .task { await load() }
        .task(id: selectionKey) {
            guard let selected else { return }
            let authoredView = authored
            preview = nil
            do { let note = try await NoteHistoryService.preview(noteID, revision: selected, authored: authoredView); if !Task.isCancelled { preview = note; previewRevision = selected; previewAuthored = authoredView } }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .interactiveDismissDisabled(restoring)
    }
    private func versionList(horizontal: Bool) -> some View {
        ScrollView(horizontal ? .horizontal : .vertical) {
            let layout = horizontal ? AnyLayout(HStackLayout(alignment: .top, spacing: 6)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            layout {
                ForEach(versions) { version in
                    Button { selected = version.revision; error = nil } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(version.dateLabel).font(.system(size: 13, weight: .semibold))
                            Text("\(version.label) · \(version.revision)").font(.system(size: 12)).foregroundStyle(DesignTokens.muted)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
                            .background(selected == version.revision ? DesignTokens.limeSoft : .clear, in: RoundedRectangle(cornerRadius: 10))
                    }.buttonStyle(.plain).disabled(restoring).accessibilityIdentifier("history-version-\(version.revision)")
                }
                if loading { ProgressView().padding() }
                if !loading && versions.isEmpty { Text("История появится после синхронизации заметки.").font(.system(size: 13)).foregroundStyle(DesignTokens.muted).padding() }
                if more { Button("Более ранние версии") { Task { await load(before: versions.last?.revision) } }.disabled(loading || restoring).padding() }
            }.padding(8)
        }.accessibilityLabel("Сохранённые версии")
    }
    private var versionPreview: some View {
        VStack(alignment: .leading, spacing: 12) {
            if selected != nil { Toggle("Сохранённый вариант устройства", isOn: $authored).font(.system(size: 12)).disabled(restoring).padding(.horizontal, 16).padding(.top, 16) }
            if let preview = visiblePreview { NoteVersionPreview(note: preview) }
            else if selected != nil { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
            else { Spacer() }
        }
    }
    @MainActor private func load(before: Int? = nil) async {
        loading = true; error = nil
        do {
            let rows = try await NoteHistoryService.versions(noteID, before: before)
            if before == nil { versions = rows; selected = rows.first?.revision } else { versions.append(contentsOf: rows) }
            more = rows.count == 30
        } catch { self.error = error.localizedDescription }
        loading = false
    }
    @MainActor private func restore() async {
        guard let selected else { return }; restoring = true; error = nil
        do { let note = try await NoteHistoryService.restore(noteID, revision: selected, authored: authored); onRestored(note); dismiss() }
        catch { self.error = error.localizedDescription }
        restoring = false
    }
}

private final class HistoryPreviewCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var note: Note; var theme: String; weak var webView: WKWebView?; var ready = false
    private let media = HistoryMediaHandler()
    private let openLink: (URL) -> Void
    init(note: Note, theme: String, openLink: @escaping (URL) -> Void) { self.note = note; self.theme = theme; self.openLink = openLink }
    func render() {
        media.note = note
        guard ready, let data = try? JSONEncoder().encode(note.body), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.doompileEditor.setDocument(\(json)); window.doompileEditor.setEditable(false); window.doompileEditor.setTheme('\(theme)')")
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let payload = message.body as? [String: Any], payload["type"] as? String == "ready" { ready = true; render() }
    }
    func makeView() -> WKWebView {
        let config = WKWebViewConfiguration(); config.userContentController.add(self, name: "doompile")
        media.note = note
        config.setURLSchemeHandler(media, forURLScheme: "doompile-media")
        let view = WKWebView(frame: .zero, configuration: config); webView = view; view.navigationDelegate = self
        #if os(iOS)
        view.accessibilityIdentifier = "history-preview"
        view.accessibilityLabel = "Версия заметки"
        #else
        view.setAccessibilityIdentifier("history-preview")
        view.setAccessibilityLabel("Версия заметки")
        #endif
        if let folder = Bundle.main.resourceURL?.appendingPathComponent("EditorResources") { view.loadFileURL(folder.appendingPathComponent("editor.html"), allowingReadAccessTo: folder) }
        return view
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if navigationAction.navigationType == .linkActivated, ["http", "https"].contains(url.scheme ?? "") {
            openLink(url)
        }
    }
}
private final class HistoryMediaHandler: NSObject, WKURLSchemeHandler {
    var note: Note?
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        tasks[key] = Task { @MainActor [weak self] in
            defer { self?.tasks.removeValue(forKey: key) }
            do {
                guard let url = urlSchemeTask.request.url, let id = url.pathComponents.last, UUID(uuidString: id) != nil, ["attachment", "local"].contains(url.host ?? "") else { throw URLError(.badURL) }
                let file: URL; let mime: String
                if let local = Storage.shared.localFile(id: id) { file = local.url; mime = local.mimeType }
                else {
                    func metadata(_ value: JSONValue) -> Attachment? {
                        guard case .object(let node) = value else { return nil }
                        if case .object(let attrs) = node["attrs"], attrs["id"] == .string(id), case .string(let type) = attrs["mimeType"] {
                            let name: String; if case .string(let value) = attrs["name"] { name = value } else { name = id }
                            return Attachment(id: id, name: name, mimeType: type, url: "/api/attachments/" + id, size: 0)
                        }
                        if case .array(let children) = node["content"] { return children.compactMap(metadata).first }
                        return nil
                    }
                    let attachment = self?.note?.attachments.first(where: { $0.id == id }) ?? self?.note.flatMap { metadata($0.body) } ?? Attachment(id: id, name: id, mimeType: "application/octet-stream", url: "/api/attachments/" + id, size: 0)
                    file = try await AttachmentFiles.resolve(attachment); mime = attachment.mimeType
                }
                let data = try Data(contentsOf: file); try Task.checkCancellation()
                urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil)); urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
            } catch { if !Task.isCancelled { urlSchemeTask.didFailWithError(error) } }
        }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { tasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask as AnyObject))?.cancel() }
}
#if os(iOS)
private struct NoteVersionPreview: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let note: Note
    func makeCoordinator() -> HistoryPreviewCoordinator { HistoryPreviewCoordinator(note: note, theme: colorScheme == .dark ? "dark" : "light", openLink: { openURL($0) }) }
    func makeUIView(context: Context) -> WKWebView { context.coordinator.makeView() }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.note = note; context.coordinator.theme = colorScheme == .dark ? "dark" : "light"; context.coordinator.render() }
    static func dismantleUIView(_ view: WKWebView, coordinator: HistoryPreviewCoordinator) { view.configuration.userContentController.removeScriptMessageHandler(forName: "doompile") }
}
#else
private struct NoteVersionPreview: NSViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let note: Note
    func makeCoordinator() -> HistoryPreviewCoordinator { HistoryPreviewCoordinator(note: note, theme: colorScheme == .dark ? "dark" : "light", openLink: { openURL($0) }) }
    func makeNSView(context: Context) -> WKWebView { context.coordinator.makeView() }
    func updateNSView(_ view: WKWebView, context: Context) { context.coordinator.note = note; context.coordinator.theme = colorScheme == .dark ? "dark" : "light"; context.coordinator.render() }
    static func dismantleNSView(_ view: WKWebView, coordinator: HistoryPreviewCoordinator) { view.configuration.userContentController.removeScriptMessageHandler(forName: "doompile") }
}
#endif
