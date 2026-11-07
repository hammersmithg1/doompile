import SwiftUI
import WebKit
import AppKit

@MainActor final class MacRichEditorBridge: ObservableObject {
    weak var webView: WKWebView?
    @Published var ready = false
    var hasFocus: Bool {
        guard let webView, let view = webView.window?.firstResponder as? NSView else { return false }
        return view.isDescendant(of: webView)
    }
    private var pending: [Attachment] = []
    private var pendingRecordings: [(String, Attachment)] = []
    private var pendingDocument: JSONValue?
    func reset() {
        ready = false; webView = nil
        pending = []; pendingRecordings = []; pendingDocument = nil
    }
    func insertAttachment(_ attachment: Attachment) {
        guard ready else { pending.append(attachment); return }
        let payload = ["id": attachment.id, "url": attachment.url, "name": attachment.name, "mimeType": attachment.mimeType, "size": attachment.size] as [String: Any]
        if let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.insertAttachment(\(json))") }
    }
    func insertRecording(_ id: String) {
        if let data = try? JSONEncoder().encode(id), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.insertRecording(\(json))") }
    }
    func recordingState(id: String, seconds: Int) {
        let payload: [String: Any] = ["id": id, "seconds": seconds, "status": "recording"]
        if let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.setRecordingState(\(json))") }
    }
    func completeRecording(_ id: String, attachment: Attachment) {
        guard ready else { pendingRecordings.append((id, attachment)); return }
        let payload: [String: Any] = ["id": attachment.id, "url": attachment.url, "name": attachment.name, "mimeType": attachment.mimeType, "size": attachment.size]
        if let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8), let idData = try? JSONEncoder().encode(id), let idJSON = String(data: idData, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.completeRecording(\(idJSON), \(json))") }
    }
    func markReady() {
        ready = true
        if let value = pendingDocument { pendingDocument = nil; replaceDocument(value) }
        let attachments = pending; pending = []
        for attachment in attachments { insertAttachment(attachment) }
        let recordings = pendingRecordings; pendingRecordings = []
        for (id, attachment) in recordings { completeRecording(id, attachment: attachment) }
    }
    func reconcileAttachments(_ replacements: [(from: String, to: String)]) {
        let payload = replacements.map { ["from": $0.from, "to": $0.to] }
        if let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.reconcileAttachments?.(\(json))") }
    }
    func setLink(_ value: String) {
        if let data = try? JSONEncoder().encode(value), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.setLink(\(json))") }
    }
    func replaceDocument(_ value: JSONValue) {
        guard ready else { pendingDocument = value; return }
        if let data = try? JSONEncoder().encode(value), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.setDocument(\(json))") }
    }
    func captureMode(compact: Bool) { webView?.evaluateJavaScript("window.doompileEditor.setCaptureMode?.(\(compact))") }
    func focus() { webView?.evaluateJavaScript("window.doompileEditor.focus?.()") }
    func snapshot() async throws -> (body: JSONValue, plainText: String) {
        guard ready, let webView else { throw DoompileError.message("Редактор ещё открывается. Попробуй сохранить через мгновение.") }
        let value = try await webView.evaluateJavaScript("window.doompileEditor.getState()")
        guard let state = value as? [String: Any], let body = state["body"], let text = state["plainText"] as? String,
              let data = try? JSONSerialization.data(withJSONObject: body), let document = try? JSONDecoder().decode(JSONValue.self, from: data) else { throw DoompileError.message("Не удалось прочитать документ из локального редактора.") }
        return (document, text)
    }
}

struct MacRichEditorView: NSViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @Binding var document: JSONValue
    @Binding var plainText: String
    @Binding var height: CGFloat
    @Binding var attachments: [Attachment]
    var noteID: String? = nil
    let notes: [Note]
    var focusOnLoad = false
    var captureCompact: Bool? = nil
    @ObservedObject var bridge: MacRichEditorBridge
    var onReference: (String) -> Void
    var onRequestLink: (String) -> Void
    var onAction: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let theme = colorScheme == .dark ? "dark" : "light"
        let startup = """
        (() => {
          const apply = () => {
            if (!document.documentElement) return false;
            document.documentElement.dataset.nativeDesktop = 'true';
            document.documentElement.dataset.theme = '\(theme)';
            return true;
          };
          if (!apply()) {
            const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
            observer.observe(document, { childList: true });
          }
        })();
        """
        configuration.userContentController.addUserScript(WKUserScript(source: startup, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.add(context.coordinator, name: "doompile")
        configuration.setURLSchemeHandler(context.coordinator.media, forURLScheme: "doompile-media")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.underPageBackgroundColor = .clear
        webView.setAccessibilityLabel("Редактор заметки")
        bridge.webView = webView
        if let folder = Bundle.main.resourceURL?.appendingPathComponent("EditorResources"), FileManager.default.fileExists(atPath: folder.appendingPathComponent("editor.html").path) { webView.loadFileURL(folder.appendingPathComponent("editor.html"), allowingReadAccessTo: folder) }
        return webView
    }
    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.media.attachments = attachments
        if bridge.ready { context.coordinator.applyTheme(); context.coordinator.applyCaptureMode() }
        // A transaction updates the SwiftUI binding. Resetting document here would lose the caret.
    }
    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "doompile")
        let bridge = coordinator.parent.bridge
        if bridge.webView === webView { bridge.ready = false; bridge.webView = nil }
    }
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: MacRichEditorView
        let media = MacMediaSchemeHandler()
        private var appliedTheme: String?
        private var appliedCapture: Bool?
        init(parent: MacRichEditorView) { self.parent = parent; media.attachments = parent.attachments }
        func applyTheme() {
            let theme = parent.colorScheme == .dark ? "dark" : "light"
            guard theme != appliedTheme else { return }
            appliedTheme = theme
            parent.bridge.webView?.evaluateJavaScript("window.doompileEditor.setTheme?.('\(theme)')")
        }
        func applyCaptureMode() {
            guard let compact = parent.captureCompact, appliedCapture != compact else { return }
            appliedCapture = compact; parent.bridge.captureMode(compact: compact)
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "doompile", let payload = message.body as? [String: Any], let type = payload["type"] as? String else { return }
            switch type {
            case "telemetry":
                if let name = payload["name"] as? String, let event = TelemetryEventName(rawValue: name), [.editorReady, .editorAction, .editorFailed, .runtimeError].contains(event) {
                    Telemetry.shared.record(event, payload["properties"] as? [String: Any] ?? [:])
                }
            case "ready":
                guard let data = try? JSONEncoder().encode(parent.document.includingAttachments(parent.attachments)), let json = String(data: data, encoding: .utf8) else { return }
                let references = parent.notes.filter { $0.deletedAt == nil }.map { ["id": $0.id, "title": $0.displayTitle] }
                let attachmentsJSON = (try? JSONEncoder().encode(parent.attachments)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                let referencesJSON = (try? JSONSerialization.data(withJSONObject: references)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                let noteURL = parent.noteID.flatMap { NoteLinks.shareURL(id: $0) }?.absoluteString ?? ""
                let noteURLJSON = (try? JSONEncoder().encode(noteURL)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
                let theme = parent.colorScheme == .dark ? "dark" : "light"
                parent.bridge.webView?.evaluateJavaScript("document.documentElement.dataset.nativeDesktop = 'true'; window.doompileEditor.setDocument(\(json)); window.doompileEditor.setAttachments?.(\(attachmentsJSON)); window.doompileEditor.setNoteURL?.(\(noteURLJSON)); window.doompileEditor.setNotes?.(\(referencesJSON)); window.doompileEditor.setTheme?.('\(theme)')") { [weak self] _, error in
                    guard error == nil else { if let error { Telemetry.shared.failure(.editorFailed, error) }; return }
                    self?.appliedTheme = theme
                    self?.parent.bridge.markReady()
                    self?.applyCaptureMode()
                    if self?.parent.focusOnLoad == true { self?.parent.bridge.webView?.evaluateJavaScript("window.doompileEditor.focus?.()") }
                }
            case "change":
                guard let body = payload["body"], JSONSerialization.isValidJSONObject(body), let data = try? JSONSerialization.data(withJSONObject: body), let document = try? JSONDecoder().decode(JSONValue.self, from: data), let text = payload["plainText"] as? String else { return }
                parent.document = document
                parent.plainText = text
            case "pastedMedia":
                if let value = payload["attachments"], let data = try? JSONSerialization.data(withJSONObject: value), let attachments = try? JSONDecoder().decode([Attachment].self, from: data) {
                    parent.attachments.append(contentsOf: attachments.filter { incoming in !parent.attachments.contains(where: { $0.id == incoming.id }) })
                }
            case "height":
                if let height = payload["height"] as? Double, height.isFinite { parent.height = max(300, min(100_000, height)) }
            case "openAttachment":
                if let url = payload["url"] as? String, let attachment = parent.attachments.first(where: { $0.url == url }) {
                    Task { @MainActor in if let file = try? await AttachmentFiles.resolve(attachment) { NSWorkspace.shared.open(file) } }
                }
            case "reference": if let id = payload["id"] as? String { parent.onReference(id) }
            case "requestLink": parent.onRequestLink(payload["href"] as? String ?? "")
            case "action": if let action = payload["action"] as? String { Telemetry.shared.record(.editorAction, ["action": action]); parent.onAction(action) }
            default: break
            }
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { Telemetry.shared.record(.editorFailed, ["error_code": "webview_terminated"]) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { Telemetry.shared.failure(.editorFailed, error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { Telemetry.shared.failure(.editorFailed, error) }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL { decisionHandler(.allow); return }
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
    }
}

/// Only local attachments and the connected server can be requested by editor JavaScript.
final class MacMediaSchemeHandler: NSObject, WKURLSchemeHandler {
    var attachments: [Attachment] = []
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        tasks[key] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { tasks.removeValue(forKey: key) }
            do {
                guard let url = urlSchemeTask.request.url, let host = url.host, ["local", "attachment"].contains(host), let id = url.pathComponents.last, UUID(uuidString: id) != nil else { throw URLError(.badURL) }
                let data: Data
                let mime: String
                if host == "local" {
                    let metadata = attachments.first { $0.id == id } ?? Attachment(id: id, name: "Attachment", mimeType: "application/octet-stream", url: "local:\(id)", size: 0)
                    guard let file = Storage.shared.fileURL(metadata) else { throw URLError(.fileDoesNotExist) }
                    data = try Data(contentsOf: file)
                    mime = (try? Storage.shared.snapshot().files[id]?.mimeType) ?? metadata.mimeType
                } else {
                    guard Connection.validEndpoint(Connection.endpoint), let remote = URL(string: Connection.endpoint + "/api/attachments/" + id) else { throw URLError(.badURL) }
                    var request = URLRequest(url: remote, timeoutInterval: 15)
                    request.setValue("Bearer " + Connection.token, forHTTPHeaderField: "Authorization")
                    let result = try await Telemetry.network(session, request: request)
                    guard (result.1 as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                    data = result.0; mime = result.1.mimeType ?? "application/octet-stream"
                }
                try Task.checkCancellation()
                urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
                urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
            } catch { if !Task.isCancelled { urlSchemeTask.didFailWithError(error) } }
        }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { tasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask as AnyObject))?.cancel() }
}
