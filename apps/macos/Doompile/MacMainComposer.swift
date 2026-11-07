import SwiftUI
import AppKit
import UniformTypeIdentifiers
import Combine

/// Main-window capture has its own draft; global capture can be used concurrently.
@MainActor final class MacMainComposer: ObservableObject {
    @Published private(set) var note = Note()
    @Published var error: String?
    @Published var startingVoice = false
    let voice = MacVoiceRecorder()
    private let accountScope = Connection.scope
    private let store = MacCaptureDraftStore(directory: Storage.shared.directory, filename: "mac-main-composer.json")
    private var task: Task<Void, Never>?
    private var voiceChanges: AnyCancellable?
    init() {
        do {
            if let draft = try store.load() { note = draft }
            else if let legacy = UserDefaults.standard.string(forKey: "macQuickDraft:" + Connection.scope), !legacy.isEmpty { note = Note.text(legacy); try store.save(note) }
            for draft in try voice.recover(noteID: note.id) {
                if note.body.hasFinishedRecording(draft.id) { voice.acknowledge(draft.id) }
                else { try acceptRecording(draft.data, id: draft.id) }
            }
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
        voiceChanges = voice.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }
    func updateText(_ text: String) { if !MacPreview.hasContent(note) { note.createdAt = Note.now() }; note = MacQuickDocument.updating(note, text: text); schedule() }
    private func schedule() {
        task?.cancel()
        task = Task { @MainActor [weak self] in
            try? await Task.sleep(for: EditorLifecycle.autosaveDelay)
            guard !Task.isCancelled, let self else { return }
            do { try persist() } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
        }
    }
    func persist() throws { guard accountScope == Connection.scope else { throw DoompileError.authentication }; try store.save(note) }
    func takeNote() throws -> Note {
        if voice.recording { try finishRecording() }
        return EditorLifecycle.prepared(note)
    }
    func clear() throws {
        task?.cancel(); try store.clear()
        note = Note(); error = nil
        UserDefaults.standard.removeObject(forKey: "macQuickDraft:" + Connection.scope)
    }
    func addFile(_ url: URL) throws {
        guard accountScope == Connection.scope else { throw DoompileError.authentication }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }
        let data = try Data(contentsOf: url)
        guard data.count <= 30 * 1024 * 1024, note.attachments.count < 100 else { throw DoompileError.message("До 100 вложений, не более 30 МБ каждое.") }
        if !MacPreview.hasContent(note) { note.createdAt = Note.now() }
        note.attachments.append(try Storage.shared.addFile(data, name: url.lastPathComponent, mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"))
        note = MacQuickDocument.updating(note, text: note.plainText); try persist()
    }
    func removeFile(_ id: String) { note.attachments.removeAll { $0.id == id }; note = MacQuickDocument.updating(note, text: note.plainText); schedule() }
    func toggleVoice() async {
        guard !startingVoice else { return }
        do {
            if voice.recording { try finishRecording() }
            else { if !MacPreview.hasContent(note) { note.createdAt = Note.now() }; try persist(); startingVoice = true; defer { startingVoice = false }; try await voice.start(noteID: note.id) }
        } catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
    }
    private func finishRecording() throws { let id = voice.id; try acceptRecording(voice.finish(), id: id) }
    private func acceptRecording(_ data: Data, id: String) throws {
        guard accountScope == Connection.scope else { throw DoompileError.authentication }
        guard note.attachments.count < 100, data.count <= 30 * 1024 * 1024 else { throw DoompileError.message("До 100 вложений, не более 30 МБ каждое.") }
        let file = try Storage.shared.addFile(data, name: "Голосовая заметка.m4a", mimeType: "audio/mp4")
        note.attachments.append(file); note.body = note.body.finishingRecording(id, attachment: file)
        note = MacQuickDocument.updating(note, text: note.plainText)
        try persist(); voice.acknowledge(id)
    }
    func finishAndPersist() {
        do { if voice.recording { try finishRecording() }; task?.cancel(); try persist() }
        catch { Telemetry.shared.failure(.runtimeError, error); self.error = error.localizedDescription }
    }
}
