import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// One capture session, independent of the main editor and of the network.
@MainActor final class QuickCaptureController: NSObject, ObservableObject, NSWindowDelegate {
    let library: DesktopLibrary
    let shortcut = GlobalCaptureShortcut()
    var onOpenMainWindow: (() -> Void)?
    let bridge = MacRichEditorBridge()
    var voice = MacVoiceRecorder()
    private var drafts = MacCaptureDraftStore(directory: Storage.shared.directory)
    @Published var note = Note() { didSet { scheduleDraft() } }
    @Published var expanded = false
    @Published var richMounted = false
    @Published var focused = true
    @Published var nativeInputHeight = MacQuickInput.height
    @Published var compactEditorHeight = MacQuickInput.height
    @Published var busy = false
    @Published private(set) var startingVoice = false
    @Published var error: String?
    @Published var showFiles = false
    @Published var showDrawing = false
    @Published var showLink = false
    @Published var link = ""
    private let linkEditorToken = UUID()
    private var accountScope = Connection.scope
    private var panel: CapturePanel?
    private var draftTask: Task<Void, Never>?
    private var changingPresentation = false
    private var dismissing = false
    private var syncTask: Task<Void, Never>?

    init(library: DesktopLibrary) {
        self.library = library
        super.init()
        NoteLinkEditors.register(linkEditorToken) { [weak self] in
            guard let self else { return true }
            return await self.prepareToTerminate()
        }
        do { if let draft = try drafts.load() { note = draft; richMounted = MacQuickDocument.needsRichEditor(draft) } }
        catch { Telemetry.shared.failure(.runtimeError, error); self.error = "Не удалось прочитать черновик: \(error.localizedDescription)" }
        shortcut.onInvoke = { [weak self] in self?.toggle() }
        syncTask = Task { @MainActor [weak library] in
            while !Task.isCancelled {
                await library?.sync()
                try? await Task.sleep(for: .seconds(25))
            }
        }
    }
    func toggle() {
        if panel?.isVisible == true { Task { await dismiss() } }
        else { show() }
    }
    func prepare() {
        if panel == nil {
            let window = CapturePanel(contentRect: NSRect(x: 0, y: 0, width: 680, height: 54), styleMask: [.borderless, .nonactivatingPanel, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "Быстрая заметка — Doompile"
            window.identifier = NSUserInterfaceItemIdentifier("quick-capture-panel")
            window.setAccessibilityIdentifier("quick-capture-panel")
            window.isReleasedWhenClosed = false
            window.isFloatingPanel = true; window.level = .floating
            window.hidesOnDeactivate = false; window.becomesKeyOnlyIfNeeded = false
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
            window.backgroundColor = .clear; window.isOpaque = false; window.hasShadow = true
            window.isMovableByWindowBackground = true
            window.minSize = NSSize(width: 440, height: 54)
            window.delegate = self
            window.onSubmit = { [weak self] in Task { await self?.submit() } }
            window.onDismiss = { [weak self] in Task { await self?.dismiss() } }
            window.contentView = NSHostingView(rootView: QuickCaptureRoot(capture: self, bridge: bridge, voice: voice).environmentObject(library))
            panel = window
        }
    }
    func accountChanged() {
        accountScope = Connection.scope
        voice.cancel(); voice = MacVoiceRecorder()
        draftTask?.cancel(); panel?.orderOut(nil); panel = nil
        bridge.reset()
        nativeInputHeight = MacQuickInput.height
        compactEditorHeight = MacQuickInput.height
        drafts = MacCaptureDraftStore(directory:Storage.shared.directory)
        note = (try? drafts.load()) ?? Note(); error = nil; richMounted = MacQuickDocument.needsRichEditor(note)
    }
    func show() {
        Telemetry.shared.record(.screenViewed, ["screen": "capture"])
        guard Connection.signedIn else { onOpenMainWindow?(); return }
        do {
            for draft in try voice.recover(noteID: note.id) {
                if note.body.hasFinishedRecording(draft.id) { voice.acknowledge(draft.id) }
                else { try acceptRecording(draft.data, id: draft.id) }
            }
        } catch {
            Telemetry.shared.failure(.runtimeError, error)
            self.error = error.localizedDescription
        }
        library.reload(); prepare()
        if !MacPreview.hasContent(note) { note.createdAt = Note.now() }
        guard let panel else { return }
        expanded = false; focused = true
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let width = min(680, visible.width - 40)
        let height = compactHeight
        panel.setFrame(NSRect(x: visible.midX - width / 2, y: visible.maxY - visible.height * 0.29 - height, width: width, height: height), display: true)
        applyAppearance()
        panel.orderFrontRegardless(); panel.makeKey()
        DispatchQueue.main.async { [weak self] in self?.focused = true; if self?.richMounted == true { self?.bridge.focus() } }
    }
    var compactHeight: CGFloat {
        let inputHeight = richMounted ? compactEditorHeight : nativeInputHeight
        return inputHeight + 15 + (error == nil ? 0 : 44) + (showsCompactAttachments ? 52 : 0)
    }
    var compactAttachments: [Attachment] {
        richMounted && bridge.ready ? MacQuickDocument.referencedFiles(in: note) : note.attachments
    }
    var showsCompactAttachments: Bool {
        !expanded && (startingVoice || voice.recording || !compactAttachments.isEmpty)
    }
    var hasContent: Bool {
        var draft = note
        draft.attachments = compactAttachments
        return EditorLifecycle.shouldSave(draft, existing: false)
    }
    func resizeForContent() { if !expanded { resize(to: NSSize(width: panel?.frame.width ?? 680, height: compactHeight)) } }
    func setExpanded(_ value: Bool) {
        guard !busy else { return }
        if value && !richMounted {
            if !voice.recording, !MacPreview.hasContent(note) { note.createdAt = Note.now() }
            note.body = note.editorDocument
            compactEditorHeight = nativeInputHeight
            richMounted = true
        }
        expanded = value
        let screen = panel?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        resize(to: value ? NSSize(width: min(780, screen.width - 48), height: min(620, screen.height - 90)) : NSSize(width: min(680, screen.width - 40), height: compactHeight))
        if bridge.ready { bridge.captureMode(compact: !value); bridge.focus() }
        focused = true
    }
    private func resize(to size: NSSize) {
        guard let panel, panel.isVisible else { return }
        let visible = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? panel.frame
        let old = panel.frame
        let width = min(size.width, visible.width - 24), height = min(size.height, visible.height - 24)
        let frame = NSRect(x: min(max(visible.minX + 12, old.midX - width / 2), visible.maxX - width - 12), y: max(visible.minY + 12, min(old.maxY - height, visible.maxY - height - 12)), width: width, height: height)
        changingPresentation = true
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.18
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(frame, display: true)
        } completionHandler: { [weak self] in Task { @MainActor in self?.changingPresentation = false } }
    }
    func updateText(_ text: String) {
        guard !richMounted else { return }
        if !voice.recording, !MacPreview.hasContent(note) { note.createdAt = Note.now() }
        note = MacQuickDocument.updating(note, text: text)
    }
    private func scheduleDraft() {
        draftTask?.cancel()
        draftTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: EditorLifecycle.autosaveDelay)
            guard !Task.isCancelled, let self else { return }
            do { try drafts.save(note) } catch { Telemetry.shared.failure(.runtimeError, error); self.error = "Не удалось сохранить черновик: \(error.localizedDescription)" }
        }
    }
    private func snapshot() async throws {
        let scope = accountScope
        guard Connection.scope == scope else { throw DoompileError.authentication }
        if richMounted && bridge.ready {
            let previous = note.body
            let state = try await bridge.snapshot()
            guard accountScope == scope, Connection.scope == scope else { throw DoompileError.authentication }
            if previous == note.body { note.body = state.body; note.plainText = state.plainText }
        }
    }
    func dismiss() async {
        guard !busy, !dismissing else { return }
        dismissing = true; defer { dismissing = false }
        do {
            if startingVoice { voice.cancel() }
            if voice.recording { try finishRecording() }
            try await snapshot()
            draftTask?.cancel(); try drafts.save(note)
            panel?.orderOut(nil)
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription; resizeForContent() }
    }
    func submit() async {
        guard Connection.signedIn, Connection.scope == accountScope else { return }
        guard !busy, !dismissing, !startingVoice else { return }
        guard !richMounted || bridge.ready else { error = "Редактор ещё открывается. Попробуй отправить через мгновение."; return }
        busy = true; defer { busy = false }
        do {
            if voice.recording { try finishRecording() }
            try await snapshot()
            var value = EditorLifecycle.prepared(note)
            if richMounted { value.attachments = MacQuickDocument.referencedFiles(in: value) }
            guard EditorLifecycle.shouldSave(value, existing: false) else { return }
            guard let saved = library.save(value) else { throw DoompileError.message(library.error ?? "Не удалось сохранить заметку на Mac.") }
            note = saved
            draftTask?.cancel(); try drafts.clear()
            panel?.orderOut(nil)
            note = Note(); draftTask?.cancel()
            richMounted = false; expanded = false; error = nil
            nativeInputHeight = MacQuickInput.height
            compactEditorHeight = MacQuickInput.height
            library.notice = "Сохранено"
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription; resizeForContent() }
    }
    func action(_ action: String) {
        switch EditorAction(rawValue: action) {
        case .sendCapture: Task { await submit() }
        case .expandCapture: setExpanded(true)
        case .file, .image: showFiles = true
        case .drawing: setExpanded(true); showDrawing = true
        case .voice: Task { await startRecording() }
        case .stopVoice:
            guard voice.recording, !busy else { return }
            do { try finishRecording(); error = nil } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
        case .retryVoice: editorReady()
        case .preferencesClosed, nil: break
        }
    }
    private func startRecording() async {
        guard Connection.signedIn, Connection.scope == accountScope, !startingVoice, !voice.recording, !busy, !dismissing else { return }
        startingVoice = true; defer { startingVoice = false }
        do {
            guard compactAttachments.count < NoteLimits.attachments else { throw DoompileError.message("В одной заметке может быть до 100 вложений.") }
            if !hasContent { note.createdAt = Note.now() }
            try drafts.save(note)
            try await voice.start(noteID: note.id)
            error = nil
            if bridge.ready { bridge.insertRecording(voice.id); bridge.recordingState(id: voice.id, seconds: 0) }
        } catch is CancellationError {} catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
    }
    func addFile(_ data: Data, name: String, mime: String) throws {
        let attachment = try storeFile(data, name: name, mime: mime)
        if richMounted { bridge.insertAttachment(attachment) }
        else { note = MacQuickDocument.updating(note, text: note.plainText) }
    }
    func storeFile(_ data: Data, name: String, mime: String) throws -> Attachment {
        guard Connection.signedIn, Connection.scope == accountScope else { throw DoompileError.authentication }
        let reserved = voice.recording || startingVoice ? 1 : 0
        guard data.count <= 30 * 1024 * 1024, compactAttachments.count + reserved < NoteLimits.attachments else { throw DoompileError.message("До 100 вложений, не более 30 МБ каждое.") }
        if !voice.recording, !hasContent { note.createdAt = Note.now() }
        let attachment = try Storage.shared.addFile(data, name: name, mimeType: mime)
        note.attachments.append(attachment)
        return attachment
    }
    func removeCompactAttachment(_ id: String) {
        if richMounted {
            if let file = note.attachments.first(where: { $0.id == id }) { bridge.removeAttachment(file) }
            return
        }
        note.attachments.removeAll { $0.id == id }
        note = MacQuickDocument.updating(note, text: note.plainText)
    }
    private func finishRecording() throws {
        let id = voice.id
        try acceptRecording(voice.finish(), id: id)
    }
    private func acceptRecording(_ data: Data, id: String) throws {
        guard Connection.signedIn, Connection.scope == accountScope else { throw DoompileError.authentication }
        guard data.count <= 30 * 1024 * 1024, compactAttachments.count < NoteLimits.attachments else { throw DoompileError.message("До 100 вложений, не более 30 МБ каждое.") }
        let attachment = try Storage.shared.addFile(data, name: "Голосовая заметка.m4a", mimeType: "audio/mp4")
        note.attachments.append(attachment); note.body = note.body.finishingRecording(id, attachment: attachment)
        if richMounted { bridge.completeRecording(id, attachment: attachment) }
        else { note = MacQuickDocument.updating(note, text: note.plainText) }
        try drafts.save(note); voice.acknowledge(id)
    }
    func editorReady() {
        bridge.captureMode(compact: !expanded); bridge.focus()
        if voice.recording { bridge.insertRecording(voice.id); bridge.recordingState(id: voice.id, seconds: voice.seconds) }
    }
    func applyAppearance() {
        let mode = AppearanceMode(rawValue: Connection.defaults.string(forKey: AppearanceMode.storageKey) ?? "system") ?? .system
        panel?.appearance = mode == .system ? nil : NSAppearance(named: mode == .dark ? .darkAqua : .aqua)
    }
    func windowDidResignKey(_ notification: Notification) {
        guard !expanded, !showFiles, !showDrawing, !showLink, !busy, !changingPresentation, !startingVoice else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(140))
            guard panel?.isKeyWindow == false, !expanded, !busy, !startingVoice else { return }
            await dismiss()
        }
    }
    func persistOnTermination() {
        syncTask?.cancel()
        draftTask?.cancel()
        if voice.recording { try? finishRecording() }
        do { try drafts.save(note) } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
    }
    func prepareToTerminate() async -> Bool {
        guard Connection.signedIn else { return true }
        do {
            if voice.recording { try finishRecording() }
            try await snapshot(); draftTask?.cancel(); try drafts.save(note)
            return true
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription; show(); return false }
    }
}

final class CapturePanel: NSPanel {
    var onSubmit: (() -> Void)?
    var onDismiss: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { onDismiss?() }
    override func performClose(_ sender: Any?) { onDismiss?() }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if [36, 76].contains(event.keyCode), event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command { onSubmit?(); return true }
        return super.performKeyEquivalent(with: event)
    }
}

struct QuickCaptureRoot: View {
    @AppStorage(AppearanceMode.storageKey, store: Connection.defaults) private var appearance: AppearanceMode = .system
    @EnvironmentObject private var library: DesktopLibrary
    @ObservedObject var capture: QuickCaptureController
    @ObservedObject var bridge: MacRichEditorBridge
    @ObservedObject var voice: MacVoiceRecorder
    private var editorLoading: Bool { capture.richMounted && !bridge.ready }
    private var sendDisabled: Bool { editorLoading || capture.busy || capture.startingVoice || (!voice.recording && !capture.hasContent) }
    var body: some View {
        panel
            .fileImporter(isPresented: $capture.showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true, onCompletion: importFiles)
            .sheet(isPresented: $capture.showDrawing) { MacDrawing(onSave: saveDrawing) }
            .alert("Адрес ссылки", isPresented: $capture.showLink) {
                TextField("https://…", text: $capture.link)
                Button("Добавить") { bridge.setLink(capture.link) }
                Button("Отмена", role: .cancel) {}
            }
    }
    private var panel: some View {
        panelContent
            .background(capture.expanded ? MacPalette.background : MacPalette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(MacPalette.line))
            .foregroundStyle(MacPalette.text)
            .preferredColorScheme(appearance.colorScheme)
            .onChange(of: appearance) { capture.applyAppearance() }
            .onChange(of: capture.compactHeight) { capture.resizeForContent() }
            .onChange(of: bridge.ready, editorReadinessChanged)
            .onChange(of: voice.seconds, updateRecordingTime)
    }
    private var panelContent: some View {
        VStack(spacing: 0) {
            if capture.expanded {
                header
                MacNoteTags(selected: $capture.note.tags, available: library.tags)
            }
            if capture.expanded && capture.startingVoice && !editorLoading {
                MacRecordingSnippet(starting: capture.startingVoice, seconds: voice.seconds) { capture.action("stopVoice") }
            }
            composerInput
            if let error = capture.error { Text(error).font(.system(size: 11)).foregroundStyle(MacPalette.orange).lineLimit(3).padding(.horizontal, 14).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading) }
            if capture.expanded { footer }
        }
    }
    private var header: some View {
        HStack(spacing: 5) {
            DoompileWordmark(height: 16)
            Spacer()
            Button { capture.note.pinned.toggle() } label: { DoompileSymbol(systemName: capture.note.pinned ? "pin.fill" : "pin").frame(width: 28, height: 28) }.help(capture.note.pinned ? "Открепить" : "Закрепить")
            Button { capture.note.urgent.toggle() } label: { DoompileSymbol(systemName: capture.note.urgent ? "flame.fill" : "flame").foregroundStyle(capture.note.urgent ? MacPalette.orange : MacPalette.muted).frame(width: 28, height: 28) }.help("Важное")
            Button { capture.setExpanded(false) } label: { DoompileSymbol(systemName: "arrow.down.right.and.arrow.up.left").frame(width: 28, height: 28) }
                .help("Свернуть редактор").accessibilityLabel("Свернуть редактор").accessibilityIdentifier("quick-composer-collapse")
        }.buttonStyle(.plain).foregroundStyle(MacPalette.muted).padding(.horizontal, 18).frame(height: 50)
    }
    private var composerInput: some View {
        VStack(spacing: 6) {
            if capture.showsCompactAttachments || (capture.expanded && editorLoading && (capture.startingVoice || voice.recording || !capture.compactAttachments.isEmpty)) {
                MacComposerAttachmentStrip(attachments: capture.compactAttachments, starting: capture.startingVoice, recording: voice.recording,
                                           seconds: voice.seconds, onRemove: capture.removeCompactAttachment) { capture.action("stopVoice") }
            }
            HStack(alignment: .bottom, spacing: 5) {
                if !capture.expanded {
                    MacComposerButton(icon: "paperclip", label: "Прикрепить файл", disabled: capture.busy, identifier: "quick-composer-attach") { capture.action("file") }
                }
                if capture.richMounted { richInput }
                else { nativeInput }
                if !capture.expanded {
                    MacComposerButton(icon: "arrow.up.left.and.arrow.down.right", label: "Развернуть редактор", disabled: capture.busy, identifier: "quick-composer-expand") { capture.setExpanded(true) }
                    MacComposerPrimaryButton(canSend: voice.recording || capture.hasContent, starting: capture.startingVoice, busy: capture.busy || editorLoading,
                                             onStart: { capture.action("voice") }, onSend: submit,
                                             onHoldRelease: releaseVoiceHold, onVoiceCancel: cancelVoicePress)
                }
            }
        }.padding(capture.expanded ? 0 : 6).frame(maxHeight: capture.expanded ? .infinity : nil)
    }
    private var richInput: some View {
        MacRichEditorView(document: $capture.note.body, plainText: $capture.note.plainText, height: $capture.compactEditorHeight, attachments: $capture.note.attachments, noteID: capture.note.id, notes: library.notes, focusOnLoad: true, captureCompact: !capture.expanded, bridge: bridge, onReference: { id in
            Task { await capture.dismiss(); if let url = NoteLinks.appURL(id: id) { NSWorkspace.shared.open(url) } }
        }, onRequestLink: { capture.link = $0; capture.showLink = true }, onAction: capture.action, onPasteImage: capture.storeFile)
        .id(capture.note.id)
        .accessibilityIdentifier("quick-composer-input")
        .frame(maxWidth: .infinity, minHeight: capture.expanded ? 240 : capture.compactEditorHeight, maxHeight: capture.expanded ? .infinity : capture.compactEditorHeight)
        .opacity(bridge.ready ? 1 : 0)
        .overlay {
            if editorLoading { MacQuickEditorPreview(text: capture.note.plainText, compact: !capture.expanded) }
        }
    }
    private var nativeInput: some View {
        MacQuickInput(text: Binding(get: { capture.note.plainText }, set: capture.updateText), focused: $capture.focused, contentHeight: $capture.nativeInputHeight, onSubmit: submit, onPasteImage: pasteQuickImage)
            .frame(height: capture.nativeInputHeight).padding(.horizontal, 4)
    }
    private func pasteQuickImage(_ data: Data) {
        do { try capture.addFile(data, name: "Изображение.png", mime: "image/png") }
        catch { capture.error = error.localizedDescription }
    }
    private var footer: some View {
        HStack {
            Text("Esc — скрыть · черновик останется на Mac").font(.system(size: 10)).foregroundStyle(MacPalette.muted)
            Spacer()
            Text("⌘ ↵").font(.system(size: 10)).foregroundStyle(MacPalette.muted)
            MacComposerButton(icon: "arrow.up", label: "Отправить заметку", send: true, disabled: sendDisabled, identifier: "quick-composer-send", action: submit)
        }.padding(12)
    }
    private func submit() { Task { await capture.submit() } }
    private func releaseVoiceHold() {
        guard voice.recording else { return }
        if voice.elapsed >= 0.12 { submit() } else { capture.action("stopVoice") }
    }
    private func cancelVoicePress() {
        if capture.startingVoice { voice.cancel() } else { capture.action("stopVoice") }
    }
    private func editorReadinessChanged(from _: Bool, to ready: Bool) {
        if ready { capture.editorReady() }
    }
    private func updateRecordingTime(from _: Int, to seconds: Int) {
        if voice.recording { bridge.recordingState(id: voice.id, seconds: seconds) }
    }
    private func importFiles(_ result: Result<[URL], Error>) {
        do {
            for url in try result.get() {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }
                try capture.addFile(Data(contentsOf: url), name: url.lastPathComponent, mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")
            }
        } catch { capture.error = error.localizedDescription }
    }
    private func saveDrawing(_ data: Data) {
        do {
            try capture.addFile(data, name: "Рисунок.png", mime: "image/png")
            capture.showDrawing = false
        } catch {
            capture.error = error.localizedDescription
        }
    }
}

struct MacCaptureMenu: View {
    @Environment(\.openSettings) private var openSettings
    @ObservedObject var capture: QuickCaptureController
    @ObservedObject var shortcut: GlobalCaptureShortcut
    @ObservedObject var updater: ApplicationUpdater
    let presence: MacApplicationPresence
    var body: some View {
        Button("Быстрая заметка\(shortcut.shortcut.map { "  " + $0.label } ?? "")") { capture.toggle() }
        Button("Открыть Doompile") { presence.revealMainWindow() }
        Divider()
        Button("Настройки…") { presence.showDesktopWindow { openSettings() } }
        CheckForUpdatesButton(updater: updater)
        Divider()
        Button("Завершить Doompile") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
