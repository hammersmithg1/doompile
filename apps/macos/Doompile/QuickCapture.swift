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
    @Published var inputHeight: CGFloat = 39
    @Published var busy = false
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
        do { if let draft = try drafts.load() { note = draft; richMounted = !draft.body.isPlainParagraphDocument } }
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
        drafts = MacCaptureDraftStore(directory:Storage.shared.directory)
        note = (try? drafts.load()) ?? Note(); error = nil; richMounted = false
    }
    func show() {
        Telemetry.shared.record(.screenViewed, ["screen": "capture"])
        guard Connection.signedIn else { onOpenMainWindow?(); return }
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
    private var compactHeight: CGFloat { max(54, (richMounted ? 43 : inputHeight) + 12) + (error == nil ? 0 : 44) }
    func resizeForContent() { if !expanded { resize(to: NSSize(width: panel?.frame.width ?? 680, height: compactHeight)) } }
    func setExpanded(_ value: Bool) {
        guard !busy else { return }
        if value && !richMounted { if !MacPreview.hasContent(note) { note.createdAt = Note.now() }; note.body = note.editorDocument; richMounted = true }
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
        if !MacPreview.hasContent(note) { note.createdAt = Note.now() }
        note.plainText = text; note.body = .document(text)
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
            if voice.recording { try finishRecording() }
            try await snapshot()
            draftTask?.cancel(); try drafts.save(note)
            panel?.orderOut(nil)
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription; resizeForContent() }
    }
    func submit() async {
        guard Connection.signedIn, Connection.scope == accountScope else { return }
        guard !busy else { return }
        guard !richMounted || bridge.ready else { error = "Редактор ещё открывается. Попробуй отправить через мгновение."; return }
        busy = true; defer { busy = false }
        do {
            if voice.recording { try finishRecording() }
            try await snapshot()
            let value = EditorLifecycle.prepared(note)
            guard EditorLifecycle.shouldSave(value, existing: false) else { return }
            guard let saved = library.save(value) else { throw DoompileError.message(library.error ?? "Не удалось сохранить заметку на Mac.") }
            note = saved
            draftTask?.cancel(); try drafts.clear()
            panel?.orderOut(nil)
            note = Note(); draftTask?.cancel()
            richMounted = false; expanded = false; error = nil; inputHeight = 39
            library.notice = "Сохранено"
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription; resizeForContent() }
    }
    func action(_ action: String) {
        switch EditorAction(rawValue: action) {
        case .sendCapture: Task { await submit() }
        case .expandCapture: setExpanded(true)
        case .file, .image: setExpanded(true); showFiles = true
        case .drawing: setExpanded(true); showDrawing = true
        case .voice:
            setExpanded(true)
            Task {
                do { if voice.recording { try finishRecording() } else { try await voice.start(noteID: note.id); bridge.insertRecording(voice.id); bridge.recordingState(id: voice.id, seconds: 0) } }
                catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
            }
        case .stopVoice: do { try finishRecording() } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
        case .retryVoice: editorReady()
        case .preferencesClosed, nil: break
        }
    }
    func addFile(_ data: Data, name: String, mime: String) throws {
        guard Connection.signedIn, Connection.scope == accountScope else { throw DoompileError.authentication }
        guard data.count <= 30 * 1024 * 1024, note.attachments.count < NoteLimits.attachments else { throw DoompileError.message("До 100 вложений, не более 30 МБ каждое.") }
        let attachment = try Storage.shared.addFile(data, name: name, mimeType: mime)
        note.attachments.append(attachment); bridge.insertAttachment(attachment)
    }
    private func finishRecording() throws {
        let id = voice.id
        let data = try voice.finish()
        let attachment = try Storage.shared.addFile(data, name: "Голосовая заметка.m4a", mimeType: "audio/mp4")
        note.attachments.append(attachment); note.body = note.body.finishingRecording(id, attachment: attachment)
        bridge.completeRecording(id, attachment: attachment)
        try drafts.save(note); voice.acknowledge(id)
    }
    func editorReady() {
        bridge.captureMode(compact: !expanded); bridge.focus()
        if voice.recording { bridge.insertRecording(voice.id); bridge.recordingState(id: voice.id, seconds: voice.seconds) }
        else {
            do {
                for draft in try voice.recover(noteID: note.id) {
                    if note.body.hasFinishedRecording(draft.id) { voice.acknowledge(draft.id); continue }
                    let attachment = try Storage.shared.addFile(draft.data, name: "Голосовая заметка.m4a", mimeType: "audio/mp4")
                    note.attachments.append(attachment); note.body = note.body.finishingRecording(draft.id, attachment: attachment)
                    bridge.completeRecording(draft.id, attachment: attachment); try drafts.save(note); voice.acknowledge(draft.id)
                }
            } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
        }
    }
    func applyAppearance() {
        let mode = AppearanceMode(rawValue: Connection.defaults.string(forKey: AppearanceMode.storageKey) ?? "system") ?? .system
        panel?.appearance = mode == .system ? nil : NSAppearance(named: mode == .dark ? .darkAqua : .aqua)
    }
    func windowDidResignKey(_ notification: Notification) {
        guard !expanded, !showFiles, !showDrawing, !showLink, !busy, !changingPresentation else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(140))
            guard panel?.isKeyWindow == false, !expanded, !busy else { return }
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
    @State private var editorHeight: CGFloat = 300
    var body: some View {
        VStack(spacing: 0) {
            if capture.expanded {
                HStack(spacing: 5) {
                    DoompileWordmark(height: 16)
                    if voice.recording { Text("● \(Note.timeLabel(Double(voice.seconds)))").font(.system(size: 10)).foregroundStyle(MacPalette.orange); Button("Стоп") { capture.action("stopVoice") }.font(.system(size: 10)) }
                    Spacer()
                    Button { capture.note.pinned.toggle() } label: { DoompileSymbol(systemName: capture.note.pinned ? "pin.fill" : "pin").frame(width: 28, height: 28) }.help(capture.note.pinned ? "Открепить" : "Закрепить")
                    Button { capture.note.urgent.toggle() } label: { DoompileSymbol(systemName: capture.note.urgent ? "flame.fill" : "flame").foregroundStyle(capture.note.urgent ? MacPalette.orange : MacPalette.muted).frame(width: 28, height: 28) }.help("Важное")
                    Button { capture.setExpanded(false) } label: { DoompileSymbol(systemName: "arrow.down.right.and.arrow.up.left").frame(width: 28, height: 28) }.help("Свернуть панель").accessibilityLabel("Свернуть панель")
                    Button { Task { await capture.dismiss() } } label: { DoompileSymbol(systemName: "xmark").frame(width: 28, height: 28) }.help("Скрыть панель · Esc").accessibilityLabel("Скрыть панель")
                }.buttonStyle(.plain).foregroundStyle(MacPalette.muted).padding(.horizontal, 18).frame(height: 50)
                MacNoteTags(selected: $capture.note.tags, available: library.tags)
            }
            HStack(alignment: .bottom, spacing: 5) {
                if capture.richMounted {
                    MacRichEditorView(document: $capture.note.body, plainText: $capture.note.plainText, height: $editorHeight, attachments: $capture.note.attachments, noteID: capture.note.id, notes: library.notes, focusOnLoad: true, captureCompact: !capture.expanded, bridge: bridge, onReference: { id in
                        Task { await capture.dismiss(); if let url = NoteLinks.appURL(id: id) { NSWorkspace.shared.open(url) } }
                    }, onRequestLink: { capture.link = $0; capture.showLink = true }, onAction: capture.action)
                    .id(capture.note.id)
                    .frame(maxWidth: .infinity, minHeight: capture.expanded ? 240 : 43, maxHeight: capture.expanded ? .infinity : 43)
                } else {
                    MacQuickInput(text: Binding(get: { capture.note.plainText }, set: capture.updateText), height: $capture.inputHeight, focused: $capture.focused, onSubmit: { Task { await capture.submit() } }).frame(height: capture.inputHeight).padding(.leading, 8)
                }
                if !capture.expanded {
                    MacComposerButton(icon: "mic", label: "Записать голосовую заметку") { capture.action("voice") }
                    MacComposerButton(icon: "paperclip", label: "Прикрепить файл") { capture.action("file") }
                    MacComposerButton(icon: "arrow.up.left.and.arrow.down.right", label: "Развернуть редактор") { capture.setExpanded(true) }
                    MacComposerButton(icon: "arrow.up", label: "Сохранить заметку · Enter", send: true, disabled: capture.busy || !EditorLifecycle.shouldSave(capture.note, existing: false)) { Task { await capture.submit() } }
                }
            }.padding(capture.expanded ? 0 : 6).frame(maxHeight: capture.expanded ? .infinity : nil)
            if let error = capture.error { Text(error).font(.system(size: 11)).foregroundStyle(MacPalette.orange).lineLimit(3).padding(.horizontal, 14).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading) }
            if capture.expanded {
                HStack {
                    Text("Esc — скрыть · черновик останется на Mac").font(.system(size: 10)).foregroundStyle(MacPalette.muted)
                    Spacer()
                    Text("⌘ ↵").font(.system(size: 10)).foregroundStyle(MacPalette.muted)
                    MacComposerButton(icon: "arrow.up", label: "Сохранить заметку", send: true, disabled: capture.busy || !EditorLifecycle.shouldSave(capture.note, existing: false)) { Task { await capture.submit() } }
                }.padding(12)
            }
        }
        .background(capture.expanded ? MacPalette.background : MacPalette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(MacPalette.line))
        .foregroundStyle(MacPalette.text).preferredColorScheme(appearance.colorScheme)
        .onChange(of: appearance) { _, _ in capture.applyAppearance() }
        .onChange(of: capture.inputHeight) { _, _ in capture.resizeForContent() }
        .onChange(of: capture.error) { _, _ in capture.resizeForContent() }
        .onChange(of: bridge.ready) { _, ready in if ready { capture.editorReady() } }
        .onChange(of: voice.seconds) { _, seconds in if voice.recording { bridge.recordingState(id: voice.id, seconds: seconds) } }
        .fileImporter(isPresented: $capture.showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do { for url in try result.get() { let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }; guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }; try capture.addFile(Data(contentsOf: url), name: url.lastPathComponent, mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream") } }
            catch { capture.error = error.localizedDescription }
        }
        .sheet(isPresented: $capture.showDrawing) { MacDrawing { data in do { try capture.addFile(data, name: "Рисунок.png", mime: "image/png"); capture.showDrawing = false } catch { capture.error = error.localizedDescription } } }
        .alert("Адрес ссылки", isPresented: $capture.showLink) { TextField("https://…", text: $capture.link); Button("Добавить") { bridge.setLink(capture.link) }; Button("Отмена", role: .cancel) {} }
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
