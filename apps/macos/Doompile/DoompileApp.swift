import SwiftUI
import AppKit
import UniformTypeIdentifiers
import AVFoundation
import Combine

enum MacPalette {
    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color { DesignTokens.adaptive(light, dark) }
    static let background = DesignTokens.background
    static let sidebar = DesignTokens.sidebar
    static let surface = DesignTokens.surface
    static let line = DesignTokens.line
    static let text = DesignTokens.text
    static let muted = DesignTokens.muted
    static let lime = DesignTokens.lime
    static let softLime = DesignTokens.limeSoft
    static let orange = DesignTokens.danger
    static let urgent = DesignTokens.urgent
    static let send = DesignTokens.send
    static let tool = DesignTokens.tool
    static let brand = DesignTokens.brand
}

extension Notification.Name {
    static let doompileNewNote = Notification.Name("doompile.newNote")
    static let doompileSearch = Notification.Name("doompile.search")
    static let doompileSave = Notification.Name("doompile.save")
    static let doompileSaveWorkspace = Notification.Name("doompile.saveWorkspace")
}

@MainActor final class DesktopLibrary: ObservableObject {
    private let fixedScope: String?
    var isCurrentAccount: Bool { Connection.signedIn && (fixedScope == nil || fixedScope == Connection.scope) }
    @Published var notes: [Note] = []
    @Published var pending = 0
    @Published var syncing = false
    @Published var error: String?
    @Published var notice: String?
    @Published private(set) var tags: [String] = []
    init(fixedAccount: Bool = false) { fixedScope = fixedAccount ? Connection.scope : nil; reload() }
    func reload() {
        do {
            let state = try Storage.shared.snapshot()
            let snapshot = state.notes.values.filter { $0.deletedAt == nil }.sorted(by: Note.newestFirst)
            if snapshot != notes { notes = snapshot }
            tags = TagCatalog.all(noteTags: notes.flatMap(\.tags))
            pending = state.dirty.count
        } catch { self.error = error.localizedDescription }
    }
    @discardableResult func save(_ original: Note) -> Note? {
        guard isCurrentAccount else { error = "Аккаунт изменился. Открой заметку заново."; return nil }
        var note = NoteValidation.normalized(original)
        note.updatedAt = Note.now()
        do {
            try NoteValidation.validate(note)
            try Storage.shared.save(note)
            reload()
            Task { await sync(pull: false) }
            return note
        } catch { self.error = error.localizedDescription; return nil }
    }
    func toggle(_ note: Note, urgent: Bool = false) {
        var updated = notes.first { $0.id == note.id } ?? note
        if urgent { updated.urgent.toggle() } else { updated.pinned.toggle() }
        _ = save(updated)
    }
    func remove(_ note: Note) {
        var deleted = note
        deleted.deletedAt = Note.now()
        _ = save(deleted)
    }
    func sync(pull: Bool = true) async {
        guard isCurrentAccount, !syncing else { return }
        syncing = true
        defer { syncing = false; reload() }
        let scope = Connection.scope
        do { try await SyncService.shared.sync(pull: pull); if scope == Connection.scope { error = nil } }
        catch { if scope == Connection.scope { self.error = error.localizedDescription } }
    }
}

@main @MainActor struct DoompileMacApp: App {
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var appDelegate
    @AppStorage(AppearanceMode.storageKey, store: Connection.defaults) private var appearance: AppearanceMode = .system
    @AppStorage(MacBackgroundPreferences.showMenuBarIconKey, store: Connection.defaults) private var showMenuBarIcon = false
    private var library: DesktopLibrary { appDelegate.library }
    @ObservedObject private var account = AccountSession.shared
    private var capture: QuickCaptureController { appDelegate.capture }
    private var updater: ApplicationUpdater { appDelegate.updater }
    var body: some Scene {
        Window("Doompile", id: "main") {
            Group {
                if account.account != nil { SignedInDesktop().id(account.scope) }
                else { AccountLoginView().frame(maxWidth:.infinity,maxHeight:.infinity) }
            }.environmentObject(library).tint(MacPalette.lime).preferredColorScheme(appearance.colorScheme)
                .frame(minWidth: 900, minHeight: 600)
                .background(MacDesktopWindow(presence: appDelegate.presence, isMain: true))
        }
        .defaultSize(width: 1360, height: 860)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .appInfo) {
                CheckForUpdatesButton(updater: updater)
            }
            CommandGroup(replacing: .newItem) {
                Button("Новая заметка") { NotificationCenter.default.post(name: .doompileNewNote, object: nil) }.keyboardShortcut("n")
                Button("Быстрая заметка") { capture.toggle() }
            }
            CommandGroup(after: .textEditing) {
                Button("Найти в заметках") { NotificationCenter.default.post(name: .doompileSearch, object: nil) }.keyboardShortcut("f")
                Button("Найти в куче") { NotificationCenter.default.post(name: .doompileSearch, object: nil) }.keyboardShortcut("k")
                Divider()
                Button("Сохранить заметку") { NotificationCenter.default.post(name: .doompileSave, object: nil) }.keyboardShortcut(.return, modifiers: .command)
            }
        }
        Settings { ConnectionSettings(shortcut: capture.shortcut, updater: updater, presence: appDelegate.presence, loginItem: appDelegate.loginItem).environmentObject(library).preferredColorScheme(appearance.colorScheme).background(MacDesktopWindow(presence: appDelegate.presence)) }
        MenuBarExtra(isInserted: $showMenuBarIcon) { MacCaptureMenu(capture: capture, shortcut: capture.shortcut, updater: updater, presence: appDelegate.presence) } label: { Image("dp-mark").renderingMode(.template).resizable().aspectRatio(contentMode: .fit).frame(width: 18, height: 18).accessibilityLabel("Doompile") }
    }
}

@MainActor final class MacAppDelegate: NSObject, NSApplicationDelegate {
    let library: DesktopLibrary
    let capture: QuickCaptureController
    let updater: ApplicationUpdater
    let presence: MacApplicationPresence
    let loginItem: MacLoginItem
    private var terminating = false
    private var accountObservation: AnyCancellable?
    override init() {
        _ = Telemetry.shared
        NativeDiagnostics.shared.start()
        let library = DesktopLibrary()
        self.library = library
        capture = QuickCaptureController(library: library)
        updater = ApplicationUpdater()
        presence = MacApplicationPresence(defaults: Connection.defaults)
        loginItem = MacLoginItem()
        super.init()
        capture.onOpenMainWindow = { [weak presence] in presence?.revealMainWindow() }
        accountObservation = AccountSession.shared.$account.map { $0?.scope ?? "signed-out" }.removeDuplicates().dropFirst()
            .sink { [weak self] _ in self?.library.reload(); self?.capture.accountChanged() }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        presence.start(inBackground: MacLaunchContext.isBackgroundLaunch(NSAppleEventManager.shared().currentAppleEvent))
        capture.prepare()
    }
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { !MacLaunchContext.isBackgroundLaunch(NSAppleEventManager.shared().currentAppleEvent) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { !presence.openMainWindow() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        terminating = true
        Task { @MainActor in
            let editorSaved = await NoteLinkEditors.prepare()
            let captureSaved = await capture.prepareToTerminate()
            terminating = false
            sender.reply(toApplicationShouldTerminate: editorSaved && captureSaved)
        }
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) { capture.persistOnTermination() }
}

struct SignedInDesktop: View {
    @StateObject private var library = DesktopLibrary(fixedAccount:true)
    var body: some View { DesktopHome().environmentObject(library) }
}

struct CapturedSnippet: View {
    let source: NoteSource
    var onOpen: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let quote = source.quote, !quote.isEmpty { Text(quote).font(.system(size: 13)).lineSpacing(3).lineLimit(4).contentShape(Rectangle()).onTapGesture { onOpen?() } }
            if let url = source.navigationURL {
                Link(destination: url) {
                    HStack(spacing: 5) { DoompileSymbol(systemName: "arrow.up.right"); Text(url.host?.replacingOccurrences(of: "www.", with: "") ?? "Источник"); if let seconds = source.timestampSeconds { Text("· " + Note.timeLabel(seconds)) } }.font(.system(size: 10))
                }.foregroundStyle(MacPalette.muted).help(source.title ?? source.url)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5).padding(.leading, 13).overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(MacPalette.muted.opacity(0.4)).frame(width: 2) }
    }
}

struct TagFlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { arrange(width: proposal.width ?? 300, subviews: subviews).size }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, view) in subviews.enumerated() { view.place(at: CGPoint(x: bounds.minX + result.points[index].x, y: bounds.minY + result.points[index].y), proposal: .unspecified) }
    }
    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        var points: [CGPoint] = []
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            points.append(CGPoint(x: x, y: y)); x += size.width + spacing; rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: width, height: y + rowHeight), points)
    }
}

struct MacNoteTags: View {
    @Binding var selected: [String]
    let available: [String]
    @State private var open = false
    @State private var query = ""
    @State private var active = 0
    @FocusState private var searchFocused: Bool
    private var clean: String { query.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "#")) }
    private var suggestions: [String] { available.filter { name in !selected.contains { $0.caseInsensitiveCompare(name) == .orderedSame } && (clean.isEmpty || name.localizedCaseInsensitiveContains(clean)) } }
    private var canCreate: Bool { !clean.isEmpty && clean.utf16.count <= 100 && !(available + selected).contains { $0.caseInsensitiveCompare(clean) == .orderedSame } }
    private var choices: [String] { suggestions + (canCreate ? [clean] : []) }
    var body: some View {
        TagFlowLayout(spacing: 8) {
            ForEach(selected, id: \.self) { tag in
                HStack(spacing: 5) {
                    Text("#").opacity(0.6)
                    Text(tag).lineLimit(1).frame(maxWidth: 180).fixedSize(horizontal: true, vertical: false)
                    Button { selected.removeAll { $0 == tag } } label: { DoompileSymbol(systemName: "xmark", size: 8).font(.system(size: 8)) }.help("Убрать тег \(tag)").accessibilityLabel("Убрать тег \(tag)")
                }.font(.system(size: 11)).foregroundStyle(MacPalette.muted).frame(height: 26).help(tag)
            }
            Button { query = ""; active = 0; open = true } label: { DoompileLabel(selected.isEmpty ? "Добавить тег" : "Тег", systemImage: "plus").font(.system(size: 11)).foregroundStyle(MacPalette.muted).frame(height: 26) }.disabled(selected.count >= 100).accessibilityLabel("Добавить тег")
                .popover(isPresented: $open, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Найти или создать тег…", text: $query).textFieldStyle(.plain).focused($searchFocused).accessibilityLabel("Найти или создать тег")
                            .onSubmit { if choices.indices.contains(active) { add(choices[active]) } }
                            .onKeyPress(.downArrow) { active = min(active + 1, max(0, choices.count - 1)); return .handled }
                            .onKeyPress(.upArrow) { active = max(0, active - 1); return .handled }
                            .onKeyPress(.escape) { open = false; return .handled }
                        Divider()
                        if choices.isEmpty { Text(clean.isEmpty ? "Введи название нового тега" : "Этот тег уже добавлен").font(.system(size: 11)).foregroundStyle(MacPalette.muted).padding(6) }
                        ScrollView {
                            VStack(spacing: 2) {
                                ForEach(Array(choices.enumerated()), id: \.element) { index, name in
                                    Button { add(name) } label: { HStack { Text(index >= suggestions.count ? "+" : "#").foregroundStyle(MacPalette.muted); Text(index >= suggestions.count ? "Создать «\(name)»" : name).lineLimit(2); Spacer() }.font(.system(size: 12)).padding(8).frame(maxWidth: .infinity, alignment: .leading).background(active == index ? MacPalette.softLime.opacity(0.5) : Color.clear, in: RoundedRectangle(cornerRadius: 5)) }.buttonStyle(.plain)
                                }
                            }
                        }.frame(height: min(220, CGFloat(choices.count) * 36))
                    }.padding(12).frame(width: 280).task { searchFocused = true }.onChange(of: query) { _, _ in active = 0 }
                }
        }.buttonStyle(.plain).padding(.horizontal, 32).padding(.top, 10).padding(.bottom, 2)
    }
    private func add(_ name: String) {
        guard selected.count < 100, !selected.contains(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) else { return }
        TagCatalog.create(name); selected.append(name); query = ""; active = 0; searchFocused = true
    }
}

struct NoteWorkspace: View {
    @EnvironmentObject private var library: DesktopLibrary
    let initial: Note
    var expanded: Bool
    var onExpand: () -> Void
    @State private var openedExisting: Bool
    var onSelect: (Note) -> Void
    var onClose: () -> Void
    let initialAction: String?
    @State private var note: Note
    @State private var tags: [String]
    @State private var dirty = false
    @State private var saving = false
    @State private var lastSaved: Note?
    @State private var draftTask: Task<Void, Never>?
    @State private var editorHeight: CGFloat = 300
    @State private var fileImporter = false
    @State private var drawing = false
    @State private var linkPrompt = false
    @State private var linkValue = ""
    @State private var error: String?
    @State private var linkEditorToken = UUID()
    @StateObject private var bridge = MacRichEditorBridge()
    @StateObject private var voice = MacVoiceRecorder()
    init(initial: Note, existing: Bool, expanded: Bool, onExpand: @escaping () -> Void, onSelect: @escaping (Note) -> Void, onClose: @escaping () -> Void, initialAction: String? = nil) {
        self.initial = initial; self.expanded = expanded; self.onExpand = onExpand; self.onSelect = onSelect; self.onClose = onClose
        self.initialAction = initialAction
        _openedExisting = State(initialValue: existing)
        _lastSaved = State(initialValue: existing ? initial : nil)
        var editable = initial; editable.body = initial.editorDocument
        _note = State(initialValue: editable); _tags = State(initialValue: initial.tags)
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                if voice.recording { HStack(spacing: 6) { Circle().fill(MacPalette.orange).frame(width: 6, height: 6); Text("Запись \(Note.timeLabel(Double(voice.seconds)))").font(.system(size: 10)); Button("■ Стоп", action: finishRecording).font(.system(size: 10)) }.foregroundStyle(MacPalette.orange) }
                else { Text(error != nil ? "Не удалось сохранить" : dirty ? "Сохраняем…" : "Сохранено").font(.system(size: 10)).foregroundStyle(MacPalette.muted) }
                Spacer()
                Button { Task { await finishEditing { if let url = NoteLinks.shareURL(id: note.id) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(url.absoluteString, forType: .string) } } } } label: { DoompileSymbol(systemName: "link").frame(width: 28, height: 28) }.foregroundStyle(MacPalette.muted).help("Скопировать ссылку на заметку").accessibilityLabel("Скопировать ссылку на заметку").disabled(!bridge.ready || saving)
                if openedExisting {
                    Button { note.pinned.toggle() } label: { DoompileSymbol(systemName: note.pinned ? "pin.fill" : "pin").frame(width: 28, height: 28) }.foregroundStyle(note.pinned ? MacPalette.adaptive(0x8B9E37, 0xC6FF00) : MacPalette.muted).help(note.pinned ? "Открепить" : "Закрепить").accessibilityLabel(note.pinned ? "Открепить" : "Закрепить")
                    Button { note.urgent.toggle() } label: { DoompileSymbol(systemName: note.urgent ? "flame.fill" : "flame").frame(width: 28, height: 28) }.foregroundStyle(note.urgent ? MacPalette.orange : MacPalette.muted).help("Важное").accessibilityLabel("Важное")
                    Button { Task { await finishEditing { draftTask?.cancel(); library.remove(note); dirty = false; onClose() } } } label: { DoompileSymbol(systemName: "trash").frame(width: 28, height: 28) }.foregroundStyle(MacPalette.muted).help("Удалить заметку").accessibilityLabel("Удалить заметку")
                    Divider().frame(height: 16)
                    Button(action: onExpand) { DoompileSymbol(systemName: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right").frame(width: 28, height: 28) }.foregroundStyle(MacPalette.muted).help(expanded ? "Свернуть заметку" : "Развернуть заметку").accessibilityLabel(expanded ? "Свернуть заметку" : "Развернуть заметку")
                }
                Button { Task { await finishEditing(onClose) } } label: { DoompileSymbol(systemName: "xmark").frame(width: 28, height: 28) }.foregroundStyle(MacPalette.muted).help("Закрыть")
            }.buttonStyle(.plain).padding(.horizontal, 20).frame(height: 56).overlay(alignment: .bottom) { Rectangle().fill(MacPalette.line).frame(height: 1) }
            MacNoteTags(selected: $tags, available: library.tags)
            MacRichEditorView(document: $note.body, plainText: $note.plainText, height: $editorHeight, attachments: $note.attachments, noteID: note.id, notes: library.notes.filter { $0.id != note.id }, focusOnLoad: !library.notes.contains { $0.id == note.id }, bridge: bridge, onReference: { id in if let other = library.notes.first(where: { $0.id == id }) { Task { await finishEditing { onSelect(other) } } } }, onRequestLink: { linkValue = $0; linkPrompt = true }, onAction: { action in
                switch EditorAction(rawValue: action) {
                case .file, .image: fileImporter = true
                case .drawing: drawing = true
                case .voice: if voice.recording { finishRecording() } else { Task { await startRecording() } }
                case .stopVoice: if voice.recording { finishRecording() }
                case .retryVoice: recoverRecording()
                case .preferencesClosed, .expandCapture, .sendCapture, nil: break
                }
            }).frame(maxWidth: .infinity, maxHeight: .infinity)
            if let error { Text(error).font(.system(size: 11)).foregroundStyle(MacPalette.orange).textSelection(.enabled).padding(12) }
            if let article = note.source?.articleText, !article.isEmpty { DisclosureGroup("Сохранённый текст статьи") { ScrollView { Text(article).font(.system(size: 12)).textSelection(.enabled).padding() }.frame(maxHeight: 200) }.font(.system(size: 11)).padding(12) }

        }
        .background(MacPalette.background)
        .onChange(of: bridge.ready) { _, ready in if ready { recoverRecording(); changed(); if initialAction == "voice" { Task { await startRecording() } } else if initialAction == "file" { fileImporter = true } } }
        .onChange(of: voice.seconds) { _, seconds in if voice.recording { bridge.recordingState(id: voice.id, seconds: seconds) } }
        .onChange(of: note) { _, _ in changed() }
        .onChange(of: tags) { _, _ in changed() }
        .onReceive(NotificationCenter.default.publisher(for: .doompileSaveWorkspace)) { _ in save() }
        .onReceive(library.$notes) { notes in
            guard let saved = lastSaved, let server = notes.first(where: { $0.id == note.id }) else { return }
            guard let acknowledgement = Note.acknowledging(saved: saved, server: server, current: note) else {
                if !dirty, server != saved {
                    if note.body != server.editorDocument { bridge.replaceDocument(server.editorDocument) }
                    note = server; note.body = server.editorDocument; tags = server.tags; lastSaved = server
                }
                return
            }
            note = acknowledgement.note
            lastSaved = server
            if !acknowledgement.replacements.isEmpty { bridge.reconcileAttachments(acknowledgement.replacements.map { ($0.from, $0.to) }) }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in if voice.recording { finishRecording(); dirty = true }; if dirty { persistDraft(); save() } }
        .onAppear { NoteLinkEditors.register(linkEditorToken) { var saved = false; await finishEditing { saved = true }; return saved } }
        .onDisappear { NoteLinkEditors.unregister(linkEditorToken); draftTask?.cancel(); if voice.recording { finishRecording(); dirty = true }; if dirty { persistDraft(); save() }; voice.cancel() }
        .fileImporter(isPresented: $fileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do { for url in try result.get() { let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }; let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0; guard size <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }; try addFile(Data(contentsOf: url), name: url.lastPathComponent, mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream") } }
            catch { self.error = error.localizedDescription }
        }
        .sheet(isPresented: $drawing) { MacDrawing { data in do { try addFile(data, name: "Рисунок.png", mime: "image/png"); drawing = false } catch { self.error = error.localizedDescription } } }
        .alert("Адрес ссылки", isPresented: $linkPrompt) { TextField("https://…", text: $linkValue); Button("Добавить") { bridge.setLink(linkValue) }; Button("Отмена", role: .cancel) {} }
    }
    private func finishEditing(_ completion: () -> Void) async {
        if voice.recording { finishRecording() }
        let before = note.body
        if bridge.ready {
            do {
                let state = try await bridge.snapshot()
                // An input arriving while the snapshot crosses the bridge wins.
                if note.body == before { note.body = state.body; note.plainText = state.plainText }
            } catch { self.error = error.localizedDescription; return }
        }
        save()
        if error == nil { completion() }
    }
    private func changed() {
        var compare = note
        let baseline = lastSaved ?? initial
        compare.tags = uniqueTags
        compare.revision = baseline.revision
        compare.updatedAt = baseline.updatedAt
        dirty = compare != baseline
        draftTask?.cancel()
        guard dirty else { return }
        draftTask = Task { @MainActor in
            try? await Task.sleep(for: EditorLifecycle.autosaveDelay)
            if !Task.isCancelled { persistDraft(); save() }
        }
    }
    private func persistDraft() {
        guard library.isCurrentAccount else { return }
        var draft = note; draft.tags = uniqueTags; draft.source = draft.editorSource
        do { try EditorDrafts.save(draft) } catch { self.error = "Не удалось сохранить черновик на Mac: \(error.localizedDescription)" }
    }
    private var uniqueTags: [String] { Array(NSOrderedSet(array: tags.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })) as? [String] ?? [] }
    private func save() {
        guard library.isCurrentAccount else { return }
        guard !saving, !voice.recording else { return }
        saving = true
        defer { saving = false }
        note.tags = uniqueTags
        guard note.tags.count <= 100, note.tags.allSatisfy({ $0.utf16.count <= 100 }) else { error = "Можно указать до 100 тегов, не более 100 символов в названии каждого."; return }
        note = EditorLifecycle.prepared(note)
        guard EditorLifecycle.shouldSave(note, existing: library.notes.contains(where: { $0.id == note.id })) else { return }
        if let stored = library.notes.first(where: { $0.id == note.id }), note == stored { lastSaved = stored; dirty = false; error = nil; EditorDrafts.clear(note.id); return }
        if let saved = library.save(note) { note = saved; lastSaved = saved; dirty = false; draftTask?.cancel(); EditorDrafts.clear(note.id); error = nil }
        else { error = library.error ?? "Не удалось сохранить заметку на устройстве." }
    }
    private func addFile(_ data: Data, name: String, mime: String) throws {
        guard library.isCurrentAccount else { throw DoompileError.authentication }
        guard data.count <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }
        guard note.attachments.count < 100 else { throw DoompileError.message("В одной заметке может быть до 100 вложений.") }
        let attachment = try Storage.shared.addFile(data, name: name, mimeType: mime)
        note.attachments.append(attachment)
        bridge.insertAttachment(attachment)
    }
    private func startRecording() async {
        do { try await voice.start(noteID: note.id); bridge.insertRecording(voice.id); bridge.recordingState(id: voice.id, seconds: 0) } catch { self.error = error.localizedDescription }
    }
    private func saveRecording(_ data: Data, id: String) throws {
        guard library.isCurrentAccount else { throw DoompileError.authentication }
        let attachment = try Storage.shared.addFile(data, name: "Голосовая заметка.m4a", mimeType: "audio/mp4")
        note.attachments.append(attachment)
        note.body = note.body.finishingRecording(id, attachment: attachment)
        bridge.completeRecording(id, attachment: attachment)
        try EditorDrafts.save(note)
        voice.acknowledge(id)
    }
    private func finishRecording() { do { let id = voice.id; try saveRecording(voice.finish(), id: id) } catch { self.error = error.localizedDescription } }
    private func recoverRecording() { do { for draft in try voice.recover(noteID: note.id) { if note.body.hasFinishedRecording(draft.id) { voice.acknowledge(draft.id) } else { try saveRecording(draft.data, id: draft.id) } } } catch { self.error = error.localizedDescription } }
}

@MainActor final class MacVoiceRecorder: NSObject, ObservableObject {
    struct Manifest: Codable { let id: String; let noteID: String }
    @Published var recording = false
    @Published var seconds = 0
    var id = ""
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var startedAt = Date()
    private var url: URL?
    private let directory = Storage.shared.directory.appendingPathComponent("voice-drafts", isDirectory: true)
    func start(noteID: String) async throws {
        let permitted = await AVCaptureDevice.requestAccess(for: .audio)
        guard permitted else { throw DoompileError.message("Разреши доступ к микрофону в настройках macOS.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let id = UUID().uuidString.lowercased(), url = directory.appendingPathComponent(id + ".m4a")
        let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
        try JSONEncoder().encode(Manifest(id: id, noteID: noteID)).write(to: directory.appendingPathComponent(id + ".json"), options: .atomic)
        guard recorder.record() else { throw DoompileError.message("Не удалось начать запись.") }
        self.id = id; self.url = url; self.recorder = recorder; recording = true; seconds = 0; startedAt = Date()
        Telemetry.shared.record(.recordingStarted)
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in Task { @MainActor in guard let self else { return }; self.seconds = Int(Date().timeIntervalSince(self.startedAt)) } }
    }
    func finish() throws -> Data {
        guard let url else { throw DoompileError.message("Запись не начата.") }
        recorder?.stop(); recording = false; recorder = nil; timer?.invalidate(); timer = nil
        let data = try Data(contentsOf: url)
        Telemetry.shared.record(.recordingCompleted, ["duration_ms": Date().timeIntervalSince(startedAt) * 1000, "bytes": data.count])
        return data
    }
    func acknowledge(_ id: String) { try? FileManager.default.removeItem(at: directory.appendingPathComponent(id + ".m4a")); try? FileManager.default.removeItem(at: directory.appendingPathComponent(id + ".json")) }
    func recover(noteID: String) throws -> [(id: String, data: Data)] {
        guard !recording, FileManager.default.fileExists(atPath: directory.path) else { return [] }
        var result: [(id: String, data: Data)] = []
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where file.pathExtension == "json" {
            guard let manifest = try? JSONDecoder().decode(Manifest.self, from: Data(contentsOf: file)), manifest.noteID == noteID, let data = try? Data(contentsOf: directory.appendingPathComponent(manifest.id + ".m4a")), !data.isEmpty else { continue }
            result.append((manifest.id, data))
        }
        return result
    }
    func cancel() { recorder?.stop(); recorder = nil; recording = false; timer?.invalidate(); timer = nil }
}

struct MacDrawing: View {
    @Environment(\.dismiss) private var dismiss
    @State private var paths: [[CGPoint]] = []
    @State private var current: [CGPoint] = []
    var onSave: (Data) -> Void
    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Дай мысли форму").font(.headline); Spacer(); Button("Отмена") { dismiss() } }.padding(20)
            Canvas { context, _ in for points in paths + [current] where !points.isEmpty { var path = Path(); path.addLines(points); context.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)) } }.background(Color(red: 1, green: 0.995, blue: 0.97)).frame(width: 700, height: 420).gesture(DragGesture(minimumDistance: 0).onChanged { current.append($0.location) }.onEnded { _ in paths.append(current); current = [] })
            HStack { Button("Очистить") { paths = []; current = [] }; Spacer(); Button("Добавить рисунок") { if let data = imageData() { onSave(data) } }.buttonStyle(.borderedProminent) }.padding(20)
        }
    }
    private func imageData() -> Data? {
        let image = NSImage(size: NSSize(width: 700, height: 420)); image.lockFocus()
        NSColor.white.setFill(); NSBezierPath(rect: NSRect(x: 0, y: 0, width: 700, height: 420)).fill(); NSColor.black.setStroke()
        for points in paths + [current] where !points.isEmpty { let path = NSBezierPath(); path.lineWidth = 3; path.lineCapStyle = .round; path.move(to: CGPoint(x: points[0].x, y: 420 - points[0].y)); for point in points.dropFirst() { path.line(to: CGPoint(x: point.x, y: 420 - point.y)) }; path.stroke() }
        image.unlockFocus()
        return image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) }
    }
}

struct MacEditorCommandSettings: View {
    @Environment(\.dismiss) private var dismiss
    @State private var document = JSONValue.document("")
    @State private var text = ""
    @State private var height: CGFloat = 600
    @State private var attachments: [Attachment] = []
    @StateObject private var bridge = MacRichEditorBridge()
    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Команды редактора").font(.headline); Spacer(); Button("Закрыть") { dismiss() } }.padding()
            MacRichEditorView(document: $document, plainText: $text, height: $height, attachments: $attachments, notes: [], bridge: bridge, onReference: { _ in }, onRequestLink: { _ in }, onAction: { action in if action == "preferencesClosed" { dismiss() } })
        }.frame(width: 560, height: 680)
        .onChange(of: bridge.ready) { _, ready in if ready { bridge.webView?.evaluateJavaScript("window.doompileEditor.setEditable(false); window.doompileEditor.openPreferences()") } }
    }
}

struct ConnectionSettings: View {
    @AppStorage(AppearanceMode.storageKey, store: Connection.defaults) private var appearance: AppearanceMode = .system
    @AppStorage(MacBackgroundPreferences.minimizeToDockKey, store: Connection.defaults) private var minimizeToDock = false
    @AppStorage(MacBackgroundPreferences.showMenuBarIconKey, store: Connection.defaults) private var showMenuBarIcon = false
    @EnvironmentObject private var library: DesktopLibrary
    @ObservedObject var shortcut: GlobalCaptureShortcut
    @ObservedObject var updater: ApplicationUpdater
    let presence: MacApplicationPresence
    @ObservedObject var loginItem: MacLoginItem
    @State private var error: String?
    @State private var editorCommands = false
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 22) {
            HStack { DoompileWordmark(height: 27); Spacer(); DoompileHalo(width: 42) }
            Text("Одно хранилище для хороших мыслей.").font(.system(size: 12)).foregroundStyle(MacPalette.muted)
            Picker("Тема", selection: $appearance) {
                ForEach(AppearanceMode.allCases) { mode in Text(mode.title).tag(mode) }
            }.pickerStyle(.segmented)
            VStack(alignment: .leading, spacing: 10) {
                Text("ФОНОВЫЙ РЕЖИМ").font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(1.5).foregroundStyle(MacPalette.muted)
                Toggle("Сворачивать в Dock", isOn: $minimizeToDock).toggleStyle(.checkbox)
                Toggle("Показывать в строке меню", isOn: $showMenuBarIcon).toggleStyle(.checkbox)
                Text("После закрытия окна Doompile продолжает работать. Если выключить обе галочки, быстрая заметка останется доступна по горячей клавише. Открыть окно и настройки можно через Finder или Spotlight.").font(.system(size: 11)).foregroundStyle(MacPalette.muted).lineSpacing(4)
                Toggle("Запускать при входе в систему", isOn: Binding(get: { loginItem.requested }, set: loginItem.setEnabled)).toggleStyle(.checkbox)
                Text("При входе в систему Doompile запускается в фоне, без открытия основного окна.").font(.system(size: 11)).foregroundStyle(MacPalette.muted).lineSpacing(4)
                if loginItem.status == .requiresApproval {
                    Text("Для автозапуска нужно разрешение в настройках macOS.").font(.system(size: 11)).foregroundStyle(MacPalette.muted)
                    Button("Открыть настройки автозапуска…", action: loginItem.openSystemSettings)
                }
                if let error = loginItem.error { Text(error).font(.system(size: 11)).foregroundStyle(MacPalette.orange) }
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("БЫСТРАЯ ЗАМЕТКА").font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(1.5).foregroundStyle(MacPalette.muted)
                HStack {
                    CaptureShortcutRecorder(shortcut: shortcut).frame(width: 210, height: 34)
                    Button("Сбросить") { _ = shortcut.assign(.standard) }.font(.system(size: 11))
                    if shortcut.shortcut != nil { Button("Отключить") { _ = shortcut.assign(nil) }.font(.system(size: 11)) }
                }
                Text("Нажми поле и введи своё сочетание. Оно вызывает панель поверх любого приложения, пока Doompile запущен. Повторное нажатие скрывает панель; черновик сохраняется.").font(.system(size: 11)).foregroundStyle(MacPalette.muted).lineSpacing(4)
                if let error = shortcut.error { Text(error).font(.system(size: 11)).foregroundStyle(MacPalette.orange) }
            }
            Button("Команды и алиасы редактора") { editorCommands = true }
            AccountSettingsView()
            DiagnosticsView()
            Divider()
            ApplicationUpdateSettings(updater: updater)
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                Text("РАСШИРЕНИЕ SAFARI").font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(1.5).foregroundStyle(MacPalette.muted)
                Text("Расширение входит в это приложение. Включи Doompile Clipper в Safari → Настройки → Расширения. В его настройках нажми «Взять подключение из приложения».").font(.system(size: 12)).foregroundStyle(MacPalette.muted).lineSpacing(5)
                Text("Неподписанная сборка требует ручного разрешения в Safari после перезапуска. Расширение обновляется вместе с Doompile.").font(.system(size: 11)).foregroundStyle(MacPalette.muted).lineSpacing(4)
            }
            Divider()
            Text("Локальные данные: \(Storage.shared.directory.path)").font(.system(size: 10, design: .monospaced)).foregroundStyle(MacPalette.muted).textSelection(.enabled)
            Text(BrandCopy.tagline).font(.system(size: 10)).foregroundStyle(MacPalette.muted)
        }.padding(30).frame(maxWidth: .infinity, alignment: .leading)
        }.frame(width: 520, height: min(740, (NSScreen.main?.visibleFrame.height ?? 850) - 80)).background(MacPalette.background).tint(MacPalette.adaptive(0x8FA42F, 0xC6FF00))
        .sheet(isPresented: $editorCommands) { MacEditorCommandSettings() }
        .onChange(of: minimizeToDock) { _, _ in presence.refresh() }
        .onAppear { loginItem.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in loginItem.refresh() }
    }

}
