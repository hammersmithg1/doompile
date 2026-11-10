import SwiftUI
import WebKit

/// The editor code is bundled locally. Only authenticated media fetching uses the network.
@MainActor final class RichEditorBridge: ObservableObject {
    weak var webView: WKWebView?
    @Published private var readyViewID: ObjectIdentifier?
    var ready: Bool { webView.map(ObjectIdentifier.init) == readyViewID && readyViewID != nil }
    @Published var activeFormats: Set<String> = []
    private var pending: [Attachment] = []
    private var pendingRecordingCompletions: [(String, Attachment)] = []

    func insertAttachment(_ attachment: Attachment) {
        guard ready else { pending.append(attachment); return }
        let payload = ["id": attachment.id, "url": attachment.url, "name": attachment.name, "mimeType": attachment.mimeType, "size": attachment.size] as [String: Any]
        if let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) {
            webView?.evaluateJavaScript("window.doompileEditor.insertAttachment(\(json))")
        }
    }
    func removeAttachment(_ attachment: Attachment) {
        guard ready, let data = try? JSONEncoder().encode(attachment.url), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.doompileEditor.removeAttachment?.(\(json))")
    }
    func replaceDocument(_ document: JSONValue) {
        guard ready, let data = try? JSONEncoder().encode(document), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.doompileEditor.setDocument(\(json))")
    }
    func focus() {
        webView?.becomeFirstResponder()
        webView?.evaluateJavaScript("window.doompileEditor.focus?.()")
    }
    func blur() {
        webView?.evaluateJavaScript("window.doompileEditor.blur?.()")
        webView?.endEditing(true)
    }
    func command(_ action: String) {
        guard let data = try? JSONEncoder().encode(action), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.doompileEditor.command(\(json))")
    }
    func insertRecording(_ id: String) {
        if let data = try? JSONEncoder().encode(id), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.insertRecording(\(json))") }
    }
    func recordingState(id: String, seconds: Int, retry: Bool) {
        var payload: [String: Any] = ["id": id, "seconds": seconds, "status": retry ? "ready" : "recording"]
        if retry { payload["error"] = "Не удалось сохранить запись." }
        if let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.setRecordingState(\(json))") }
    }
    func completeRecording(_ id: String, attachment: Attachment) {
        guard webView != nil else { return }
        guard ready else { pendingRecordingCompletions.append((id, attachment)); return }
        let payload: [String: Any] = ["id": attachment.id, "url": attachment.url, "name": attachment.name, "mimeType": attachment.mimeType, "size": attachment.size]
        if let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8), let idData = try? JSONEncoder().encode(id), let idJSON = String(data: idData, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.completeRecording(\(idJSON), \(json))") }
    }
    func markReady(_ webView: WKWebView) {
        guard self.webView === webView else { return }
        readyViewID = ObjectIdentifier(webView)
        let attachments = pending
        pending = []
        for attachment in attachments { insertAttachment(attachment) }
        let completions = pendingRecordingCompletions
        pendingRecordingCompletions = []
        for (id, attachment) in completions { completeRecording(id, attachment: attachment) }
    }
    func detach(_ webView: WKWebView) {
        guard self.webView === webView else { return }
        self.webView = nil
        pendingRecordingCompletions = []
    }
    func clearReadiness() { if webView == nil { readyViewID = nil } }
    func checklist() { webView?.evaluateJavaScript("window.doompileEditor.toggleTaskList?.(); window.doompileEditor.focus?.()") }
    func setLink(_ value: String) {
        if let data = try? JSONEncoder().encode(value), let json = String(data: data, encoding: .utf8) { webView?.evaluateJavaScript("window.doompileEditor.setLink(\(json))") }
    }
    func reconcileAttachments(_ updates: [MediaURLReplacement]) {
        guard let data = try? JSONEncoder().encode(updates), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.doompileEditor.reconcileAttachments?.(\(json))")
    }
    func snapshot() async throws -> (body: JSONValue, plainText: String) {
        guard ready, let webView else { throw DoompileError.message("Редактор ещё открывается. Попробуй сохранить через мгновение.") }
        let value = try await webView.evaluateJavaScript("window.doompileEditor.getState()")
        guard let state = value as? [String: Any], let body = state["body"], let text = state["plainText"] as? String,
              let data = try? JSONSerialization.data(withJSONObject: body), let document = try? JSONDecoder().decode(JSONValue.self, from: data) else { throw DoompileError.message("Не удалось прочитать текущий документ из редактора.") }
        return (document, text)
    }
}

private final class TouchEditorWebView: WKWebView {
    var onWindowReady: (() -> Void)?
    override var inputAccessoryView: UIView? { nil }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { onWindowReady?() }
    }
}

struct RichEditorView: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @Binding var document: JSONValue
    @Binding var plainText: String
    @Binding var height: CGFloat
    @Binding var attachments: [Attachment]
    var noteID: String? = nil
    let notes: [Note]
    var focusOnLoad = false
    @ObservedObject var bridge: RichEditorBridge
    var onReference: (String) -> Void
    var onRequestLink: (String) -> Void
    var onAction: (String) -> Void
    var openPreferencesOnLoad = false
    var captureCompact = false
    var captureHeightLimit: CGFloat? = nil
    var onPasteImage: EditorImagePaste.Store? = nil

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(context.coordinator, name: "doompile")
        if onPasteImage != nil {
            config.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: EditorImagePaste.messageName)
        }
        config.setURLSchemeHandler(context.coordinator.media, forURLScheme: "doompile-media")
        let webView = TouchEditorWebView(frame: .zero, configuration: config)
        webView.inputAssistantItem.leadingBarButtonGroups = []
        webView.inputAssistantItem.trailingBarButtonGroups = []
        webView.navigationDelegate = context.coordinator
        webView.onWindowReady = { [weak coordinator = context.coordinator] in
            coordinator?.focusAfterPresentation()
        }
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.keyboardDismissMode = captureCompact ? .none : .interactive
        webView.scrollView.alwaysBounceVertical = !captureCompact
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.accessibilityLabel = captureCompact ? UICopy.capturePlaceholder : "Редактор заметки"
        bridge.webView = webView
        if let folder = Bundle.main.resourceURL?.appendingPathComponent("EditorResources"),
           FileManager.default.fileExists(atPath: folder.appendingPathComponent("editor.html").path) {
            webView.loadFileURL(folder.appendingPathComponent("editor.html"), allowingReadAccessTo: folder)
        }
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.parent = self
        if bridge.ready {
            context.coordinator.applyTheme()
            context.coordinator.applyCaptureHeightLimit()
        }
        // Native state receives every transaction. Never setDocument here: it would reset the caret.
    }
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "doompile")
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: EditorImagePaste.messageName, contentWorld: .page)
        let bridge = coordinator.parent.bridge
        bridge.detach(uiView)
        // SwiftUI is dismantling its graph here. Publishing synchronously can
        // re-enter that mutation and trip Swift's exclusivity check on dismissal.
        Task { @MainActor in bridge.clearReadiness() }
    }
    final class Coordinator: NSObject, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
        var parent: RichEditorView
        let media = MediaSchemeHandler()
        private var appliedTheme: String?
        private var appliedCaptureHeightLimit: CGFloat?
        private var initialFocusScheduled = false
        func focusAfterPresentation() {
            guard !initialFocusScheduled, parent.focusOnLoad, parent.bridge.ready,
                  let webView = parent.bridge.webView, webView.window != nil else { return }
            initialFocusScheduled = true
            let focus = { [weak self, weak webView] in
                guard let self, let webView, self.parent.bridge.webView === webView,
                      webView.window != nil else { return }
                self.parent.bridge.focus()
            }
            var responder: UIResponder? = webView
            while let current = responder {
                if let controller = current as? UIViewController,
                   let transition = controller.transitionCoordinator, transition.isAnimated,
                   transition.animate(alongsideTransition: nil, completion: { context in
                       if !context.isCancelled { focus() }
                   }) { return }
                responder = current.next
            }
            focus()
        }
        func applyTheme() {
            let theme = parent.colorScheme == .dark ? "dark" : "light"
            guard theme != appliedTheme else { return }
            appliedTheme = theme
            parent.bridge.webView?.evaluateJavaScript("window.doompileEditor.setTheme?.('\(theme)')")
        }
        func applyCaptureHeightLimit() {
            guard parent.captureCompact, let webView = parent.bridge.webView,
                  parent.captureHeightLimit != appliedCaptureHeightLimit else { return }
            appliedCaptureHeightLimit = parent.captureHeightLimit
            let limit = appliedCaptureHeightLimit.map { String(Double($0)) } ?? "null"
            webView.evaluateJavaScript("window.doompileEditor.setCaptureHeightLimit?.(\(limit))")
        }
        init(parent: RichEditorView) { self.parent = parent }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
            do { replyHandler(try EditorImagePaste.store(message, in: parent.bridge.webView, using: parent.onPasteImage), nil) }
            catch { replyHandler(nil, error.localizedDescription) }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "doompile", let payload = message.body as? [String: Any], let type = payload["type"] as? String else { return }
            switch type {
            case "telemetry":
                if let name = payload["name"] as? String, let event = TelemetryEventName(rawValue: name), [.editorReady, .editorAction, .editorFailed, .runtimeError].contains(event) {
                    Telemetry.shared.record(event, payload["properties"] as? [String: Any] ?? [:])
                }
            case "ready":
                guard let webView = parent.bridge.webView, message.webView === webView,
                      let data = try? JSONEncoder().encode(parent.document.includingAttachments(parent.attachments)),
                      let json = String(data: data, encoding: .utf8) else { return }
                let references = parent.notes.filter { $0.deletedAt == nil }.map { ["id": $0.id, "title": $0.displayTitle] }
                let attachmentsJSON = (try? JSONEncoder().encode(parent.attachments)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                let referencesJSON = (try? JSONSerialization.data(withJSONObject: references)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                let noteURL = parent.noteID.flatMap { NoteLinks.shareURL(id: $0) }?.absoluteString ?? ""
                let noteURLJSON = (try? JSONEncoder().encode(noteURL)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
                let theme = parent.colorScheme == .dark ? "dark" : "light"
                let preferences = parent.openPreferencesOnLoad
                    ? "; window.doompileEditor.setEditable(false); window.doompileEditor.openPreferences()"
                    : ""
                let presentation = parent.captureCompact ? "setCaptureMode?.(true)" : "setTouchMode?.(true)"
                applyCaptureHeightLimit()
                webView.evaluateJavaScript("window.doompileEditor.setDocument(\(json)); window.doompileEditor.setAttachments?.(\(attachmentsJSON)); window.doompileEditor.setNoteURL?.(\(noteURLJSON)); window.doompileEditor.setNotes?.(\(referencesJSON)); window.doompileEditor.setTheme?.('\(theme)'); window.doompileEditor.\(presentation)\(preferences)") { [weak self, weak webView] _, error in
                    guard error == nil else { if let error { Telemetry.shared.failure(.editorFailed, error) }; return }
                    guard let self, let webView, parent.bridge.webView === webView else { return }
                    appliedTheme = theme
                    parent.bridge.markReady(webView)
                    applyCaptureHeightLimit()
                    focusAfterPresentation()
                }
            case "change":
                guard let body = payload["body"], JSONSerialization.isValidJSONObject(body),
                      let data = try? JSONSerialization.data(withJSONObject: body),
                      let document = try? JSONDecoder().decode(JSONValue.self, from: data),
                      let text = payload["plainText"] as? String else { return }
                parent.document = document
                parent.plainText = text
            case "formats":
                if let formats = payload["active"] as? [String], Set(formats) != parent.bridge.activeFormats { parent.bridge.activeFormats = Set(formats) }
            case "pastedMedia":
                if let value = payload["attachments"], let data = try? JSONSerialization.data(withJSONObject: value), let attachments = try? JSONDecoder().decode([Attachment].self, from: data) {
                    parent.attachments.append(contentsOf: attachments.filter { incoming in !parent.attachments.contains(where: { $0.id == incoming.id }) })
                }
            case "height":
                guard message.webView === parent.bridge.webView,
                      (payload["compact"] as? Bool ?? false) == parent.captureCompact,
                      let height = payload["height"] as? Double, height.isFinite else { return }
                let measured = parent.captureCompact ? max(44, height) : max(280, min(100_000, height))
                if parent.height != measured { parent.height = measured }
            case "openAttachment": if let url = payload["url"] as? String { parent.onAction("openAttachment:" + url) }
            case "reference":
                if let id = payload["id"] as? String { parent.onReference(id) }
            case "action": if let action = payload["action"] as? String { Telemetry.shared.record(.editorAction, ["action": action]); parent.onAction(action) }
            case "requestLink":
                parent.onRequestLink(payload["href"] as? String ?? "")
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
            if navigationAction.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        }
    }
}

/// Web content gets opaque media URLs, never the connection token or arbitrary authenticated URLs.
final class MediaSchemeHandler: NSObject, WKURLSchemeHandler {
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        tasks[key] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { tasks.removeValue(forKey: key) }
            do {
                guard let url = urlSchemeTask.request.url,
                      let host = url.host, ["local", "attachment"].contains(host),
                      let id = url.pathComponents.last, UUID(uuidString: id) != nil else { throw URLError(.badURL) }
                let data: Data
                let mime: String
                if let file = Storage.shared.localFile(id: id), let bytes = try? Data(contentsOf: file.url) {
                    data = bytes
                    mime = file.mimeType
                } else {
                    guard host == "attachment" else { throw URLError(.fileDoesNotExist) }
                    guard Connection.validEndpoint(Connection.endpoint), let remote = URL(string: Connection.endpoint + "/api/attachments/" + id) else { throw URLError(.badURL) }
                    var request = URLRequest(url: remote, timeoutInterval: 15)
                    request.setValue("Bearer " + Connection.token, forHTTPHeaderField: "Authorization")
                    let response = try await Telemetry.network(session, request: request)
                    guard (response.1 as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                    data = response.0
                    mime = response.1.mimeType ?? "application/octet-stream"
                }
                try Task.checkCancellation()
                urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            } catch {
                if !Task.isCancelled { urlSchemeTask.didFailWithError(error) }
            }
        }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        tasks.removeValue(forKey: key)?.cancel()
    }
}
