import SwiftUI
import AppKit
import UniformTypeIdentifiers
import Combine

/// Main-window capture has its own draft; global capture can be used concurrently.
@MainActor final class MacMainComposer: ObservableObject {
    @Published var note = Note() { didSet { schedule() } }
    @Published var error: String?
    @Published private(set) var startingVoice = false
    @Published private(set) var richMounted = false
    @Published private(set) var busy = false
    let bridge = MacRichEditorBridge()
    let voice = MacVoiceRecorder()
    private let accountScope = Connection.scope
    private let store = MacCaptureDraftStore(directory: Storage.shared.directory, filename: "mac-main-composer.json")
    private var task: Task<Void, Never>?
    private var voiceChanges: AnyCancellable?
    init() {
        do {
            if let draft = try store.load() { note = draft }
            else if let legacy = UserDefaults.standard.string(forKey: "macQuickDraft:" + Connection.scope), !legacy.isEmpty { note = Note.text(legacy); try store.save(note) }
            richMounted = !note.body.isPlainParagraphDocument
            for draft in try voice.recover(noteID: note.id) {
                if note.body.hasFinishedRecording(draft.id) { voice.acknowledge(draft.id) }
                else { try acceptRecording(draft.data, id: draft.id) }
            }
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
        voiceChanges = voice.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }
    func updateText(_ text: String) {
        guard !richMounted else { return }
        if !voice.recording, !MacPreview.hasContent(note) { note.createdAt = Note.now() }
        note = MacQuickDocument.updating(note, text: text)
    }
    func mountEditor() {
        guard !richMounted else { return }
        if !voice.recording, !MacPreview.hasContent(note) { note.createdAt = Note.now() }
        note.body = note.editorDocument
        richMounted = true
    }
    func editorReady() {
        if voice.recording { bridge.insertRecording(voice.id); bridge.recordingState(id: voice.id, seconds: voice.seconds) }
    }
    private func schedule() {
        task?.cancel()
        task = Task { @MainActor [weak self] in
            try? await Task.sleep(for: EditorLifecycle.autosaveDelay)
            guard !Task.isCancelled, let self else { return }
            do { try persist() } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
        }
    }
    func persist() throws { guard accountScope == Connection.scope else { throw DoompileError.authentication }; try store.save(note) }
    func submit(in library: DesktopLibrary, tag: String?) async -> Bool {
        guard accountScope == Connection.scope, !busy, !startingVoice else { return false }
        guard !richMounted || bridge.ready else { error = "Редактор ещё открывается. Попробуй отправить через мгновение."; return false }
        busy = true; defer { busy = false }
        do {
            if voice.recording { try finishRecording() }
            if richMounted {
                let before = note.body
                let state = try await bridge.snapshot()
                guard accountScope == Connection.scope else { throw DoompileError.authentication }
                if note.body == before { note.body = state.body; note.plainText = state.plainText }
            }
            var value = EditorLifecycle.prepared(note)
            guard EditorLifecycle.shouldSave(value, existing: false) else { return false }
            if let tag, !value.tags.contains(tag) { value.tags.append(tag) }
            guard let saved = library.save(value) else { throw DoompileError.message(library.error ?? "Не удалось сохранить заметку на Mac.") }
            note = saved
            try store.clear()
            note = Note(); richMounted = false; task?.cancel(); error = nil
            UserDefaults.standard.removeObject(forKey: "macQuickDraft:" + Connection.scope)
            return true
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription; return false }
    }
    func addFile(_ url: URL) throws {
        guard accountScope == Connection.scope else { throw DoompileError.authentication }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }
        let data = try Data(contentsOf: url)
        try addFile(data, name: url.lastPathComponent, mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")
    }
    func addFile(_ data: Data, name: String, mime: String) throws {
        guard accountScope == Connection.scope else { throw DoompileError.authentication }
        let reserved = voice.recording || startingVoice ? 1 : 0
        guard data.count <= 30 * 1024 * 1024, note.attachments.count + reserved < NoteLimits.attachments else { throw DoompileError.message("До 100 вложений, не более 30 МБ каждое.") }
        if !voice.recording, !MacPreview.hasContent(note) { note.createdAt = Note.now() }
        let attachment = try Storage.shared.addFile(data, name: name, mimeType: mime)
        note.attachments.append(attachment)
        if richMounted { bridge.insertAttachment(attachment) }
        else { note = MacQuickDocument.updating(note, text: note.plainText) }
        try persist()
    }
    func removeFile(_ id: String) {
        guard !richMounted else { return }
        note.attachments.removeAll { $0.id == id }; note = MacQuickDocument.updating(note, text: note.plainText)
    }
    func startRecording() async {
        guard !startingVoice, !voice.recording, !busy else { return }
        startingVoice = true; defer { startingVoice = false }
        do {
            guard note.attachments.count < NoteLimits.attachments else { throw DoompileError.message("В одной заметке может быть до 100 вложений.") }
            if !MacPreview.hasContent(note) { note.createdAt = Note.now() }
            try persist()
            try await voice.start(noteID: note.id)
            error = nil
            if bridge.ready { editorReady() }
        } catch is CancellationError {} catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
    }
    func stopRecording() {
        guard voice.recording, !busy else { return }
        do { try finishRecording(); error = nil }
        catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
    }
    private func finishRecording() throws { let id = voice.id; try acceptRecording(voice.finish(), id: id) }
    private func acceptRecording(_ data: Data, id: String) throws {
        guard accountScope == Connection.scope else { throw DoompileError.authentication }
        guard note.attachments.count < NoteLimits.attachments, data.count <= 30 * 1024 * 1024 else { throw DoompileError.message("До 100 вложений, не более 30 МБ каждое.") }
        let file = try Storage.shared.addFile(data, name: "Голосовая заметка.m4a", mimeType: "audio/mp4")
        note.attachments.append(file); note.body = note.body.finishingRecording(id, attachment: file)
        if richMounted { bridge.completeRecording(id, attachment: file) }
        else { note = MacQuickDocument.updating(note, text: note.plainText) }
        try persist(); voice.acknowledge(id)
    }
    func finishAndPersist() {
        if startingVoice { voice.cancel() }
        do { if voice.recording { try finishRecording() }; task?.cancel(); try persist() }
        catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
    }
}
