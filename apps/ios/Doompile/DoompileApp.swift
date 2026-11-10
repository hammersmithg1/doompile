import SwiftUI
import PhotosUI
import ImageIO
import Network
import UniformTypeIdentifiers
import AVFoundation
import PencilKit
import QuickLook
import AppIntents

typealias Palette = DoompilePalette

enum TouchMotion {
    static var quick: Animation { UIAccessibility.isReduceMotionEnabled ? .linear(duration: 0.01) : .snappy(duration: 0.18, extraBounce: 0) }
}

private enum FeedItem: Identifiable {
    case heading(String, String, Int, String?)
    case note(Note)
    var id: String {
        switch self { case .heading(let key, _, _, _): return "heading-" + key; case .note(let note): return note.id }
    }
}

@MainActor final class Library: ObservableObject {
    private let accountScope = Connection.scope
    private let storage = Storage.shared
    var isCurrentAccount: Bool { accountScope == Connection.scope && Connection.signedIn }
    @Published var notes: [Note] = []
    @Published var tags: [String] = []
    @Published var pending = 0
    @Published var syncing = false
    @Published var error: String?
    @Published private(set) var uploadStates: [String: AttachmentUploadState] = [:]
    private let connectivity = NWPathMonitor()
    private var syncWorker: Task<Void, Never>?
    private var syncRequested = false
    private var pullRequested = false
    init() {
        reload()
        connectivity.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor [weak self] in await self?.sync() }
        }
        connectivity.start(queue: DispatchQueue(label: "doompile-connectivity"))
    }
    deinit { connectivity.cancel(); syncWorker?.cancel() }
    func reload() {
        do {
            let state = try storage.snapshot()
            let updated = state.notes.values.filter { $0.deletedAt == nil }.sorted(by: Note.newestFirst)
            if notes != updated { notes = updated }
            let catalog = TagCatalog.all(noteTags: updated.flatMap(\.tags))
            if tags != catalog { tags = catalog }
            if pending != state.dirty.count { pending = state.dirty.count }
        } catch { self.error = error.localizedDescription }
    }
    @discardableResult func save(_ original: Note, feedback: Bool = true) -> Bool {
        guard isCurrentAccount else { error = "Аккаунт изменился. Открой заметку заново."; return false }
        var note = NoteValidation.normalized(original)
        if let stored = notes.first(where: { $0.id == note.id }), EditorLifecycle.matchesStored(note, stored) {
            if pending > 0 { Task { await sync(pull: false) } }
            return true
        }
        note.updatedAt = Note.now()
        do {
            try NoteValidation.validate(note)
            try storage.save(note)
            withAnimation(TouchMotion.quick) { reload() }
            if feedback { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
            Task { await sync(pull: false) }
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    @discardableResult func createTag(_ value: String) -> Bool {
        guard TagCatalog.create(value) else { return false }
        reload()
        return true
    }
    func remove(_ original: Note) {
        var note = original
        note.deletedAt = Note.now()
        save(note)
    }
    func sync(pull: Bool = true) async {
        guard isCurrentAccount else { return }
        syncRequested = true
        pullRequested = pullRequested || pull
        if let syncWorker { await syncWorker.value; return }
        // A view's task/refresh cancellation must not cancel durable outbox delivery.
        let worker = Task { await self.drainSyncRequests() }
        syncWorker = worker
        await worker.value
    }
    private func drainSyncRequests() async {
        syncing = true
        defer { syncing = false; syncWorker = nil; reload() }
        while syncRequested && isCurrentAccount && !Task.isCancelled {
            let pull = pullRequested
            syncRequested = false; pullRequested = false
            do {
                try await SyncService.shared.sync(pull: pull, onProgress: { @MainActor [weak self] in self?.reload() },
                    onUpload: { @MainActor [weak self] id, state in self?.uploadStates[id] = state })
                error = nil
            } catch { self.error = error.localizedDescription }
            reload()
            // Saves made during an upload have queued another pass, rather than being dropped.
        }
    }
}

@main struct DoompileApp: App {
    @AppStorage(AppearanceMode.storageKey, store: Connection.defaults) private var appearance: AppearanceMode = .system
    @ObservedObject private var account = AccountSession.shared
    init() {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.environment["DOOMPILE_UI_TESTING"] == "1" {
            // UI automation only uses the offline endpoint or the isolated CI fixture.
            let environment = ProcessInfo.processInfo.environment
            let endpoint = environment["DOOMPILE_UI_COMPOSER_FIXTURE"] == "1" ? "http://127.0.0.1:18743" : "http://localhost:1"
            Connection.endpoint = endpoint
            try? Connection.install(NativeAccount(id:"11111111-1111-4111-8111-111111111111",email:"ui-test@localhost",name:"UI Test",endpoint:endpoint),token:String(repeating:"t",count:43))
            AccountSession.shared.refresh()
            UserDefaults.standard.removeObject(forKey: "quickDraft")
            UserDefaults.standard.removeObject(forKey: "quickDraft:" + Connection.scope)
            UserDefaults.standard.removeObject(forKey: "quickComposer:" + Connection.scope)
            let testAppearance = ProcessInfo.processInfo.environment["DOOMPILE_TEST_APPEARANCE"] ?? "light"
            if testAppearance != "preserve" { Connection.defaults.set(testAppearance, forKey: AppearanceMode.storageKey) }
            if ProcessInfo.processInfo.environment["DOOMPILE_UI_KEEP_TAGS"] != "1" { Connection.defaults.removeObject(forKey: TagCatalog.key) }
            if ProcessInfo.processInfo.environment["DOOMPILE_UI_KEEP_COLLAPSED"] != "1" { UserDefaults.standard.removeObject(forKey: "collapsedFeedSections:" + Connection.scope) }
            if environment["DOOMPILE_UI_ARCHIVE_FIXTURE"] == "1",
               let file = try? Storage.shared.addFile(Data(repeating: 0, count: 184_100),
                   name: "Проект с длинным названием для проверки.zip", mimeType: "application/zip") {
                var note = Note.text("")
                note.attachments = [file]
                note.body = note.body.appendingQuickAttachment(file)
                note.kind = "file"
                if let data = try? JSONEncoder().encode(note) {
                    UserDefaults.standard.set(data, forKey: "quickComposer:" + Connection.scope)
                }
            }
            // Each UI test starts with an empty local pile on a dedicated simulator.
            if let state = try? Storage.shared.snapshot() {
                for original in state.notes.values where original.deletedAt == nil {
                    var deleted = original; deleted.deletedAt = Note.now()
                    try? Storage.shared.save(deleted)
                }
            }
            if ProcessInfo.processInfo.environment["DOOMPILE_UI_SCROLL_FIXTURE"] == "1" {
                for index in 0..<24 {
                    var note = Note.text("Scroll fixture \(String(format: "%02d", index))\nSecond line for the scrolling fixture")
                    note.createdAt = "2026-10-30T10:00:\(String(format: "%02d", index)).000Z"
                    try? Storage.shared.save(note)
                }
            }
        }
        #endif
        DoompileShortcuts.updateAppShortcutParameters()
        _ = Telemetry.shared
        NativeDiagnostics.shared.start()
    }
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group {
                if account.account != nil { SignedInHome().id(account.scope) }
                else { AccountLoginView() }
            }.preferredColorScheme(appearance.colorScheme)
                .tint(Palette.accent)
                .onChange(of: phase) { _, phase in
                    Telemetry.shared.record(.appState, ["state": phase == .active ? "active" : "background"])
                    if phase == .active { account.refresh(); Task { await Telemetry.shared.flush() } }
                }
        }
    }
}

struct SignedInHome: View {
    @StateObject private var library = Library()
    var body: some View { Home().environmentObject(library) }
}

struct Brand: View {
    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            DoompileWordmark(height: 29)
            DoompileHalo(width: 36)
        }
    }
}

struct Home: View {
    @EnvironmentObject var library: Library
    @Environment(\.scenePhase) var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage private var draft: String
    @AppStorage private var collapsedSectionsJSON: String
    @State private var quickNote: Note?
    @State private var quickUsesRichEditor: Bool
    @State private var quickTransitioning = false
    @StateObject private var quickBridge = RichEditorBridge()
    private let quickComposerKey: String
    init() {
        _draft = AppStorage(wrappedValue: "", "quickDraft:" + Connection.scope)
        _collapsedSectionsJSON = AppStorage(wrappedValue: "[]", "collapsedFeedSections:" + Connection.scope)
        let key = "quickComposer:" + Connection.scope
        quickComposerKey = key
        let restored = UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(Note.self, from: $0) }
        _quickNote = State(initialValue: restored)
        _quickUsesRichEditor = State(initialValue: restored != nil)
    }
    private var collapsedSections: Set<String> {
        guard let data = collapsedSectionsJSON.data(using: .utf8), let ids = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return Set(ids)
    }
    private func toggleSection(_ id: String) {
        var ids = collapsedSections
        if !ids.insert(id).inserted { ids.remove(id) }
        if let data = try? JSONEncoder().encode(ids.sorted()), let json = String(data: data, encoding: .utf8) {
            withAnimation(TouchMotion.quick) { collapsedSectionsJSON = json }
        }
        revealedNoteID = nil
    }
    @State private var drawer = false
    @State private var drawerProgress: CGFloat = 0
    @State private var drawerDragOrigin: CGFloat?
    @State private var creatingTag = false
    @State private var newTag = ""
    @ObservedObject private var quickCapture = QuickCaptureRouter.shared
    @State private var query = ""
    @State private var filter = "Все заметки"
    @State private var revealedNoteID: String?
    @State private var editorFocusID: String?
    @State private var editor: Note?
    @State private var quickEditorID: String?
    @State private var pendingNoteID: String?
    @State private var noteLinkRequest = UUID()
    @State private var noteLinkError: String?
    @State private var settings = false
    @State private var quickError: String?
    @State private var quickHolding = false
    @State private var quickImporter = false
    @State private var quickPhotoPicker = false
    @State private var quickPhoto: PhotosPickerItem?
    @State private var quickPreparing: [Attachment] = []
    @State private var preparingPhoto = false
    @StateObject private var recorder = VoiceRecorder()
    @FocusState private var focused: Bool
    @FocusState private var searchFocused: Bool

    var filtered: [Note] {
        library.notes.filter { note in
            let matchesFilter = filter == "Все заметки" || (filter == "Важное" && note.urgent) || (filter == "Закреплённое" && note.pinned) || note.tags.contains(filter)
            let matchesSearch = query.isEmpty || "\(note.displayTitle) \(note.plainText) \(note.source?.quote ?? "") \(note.source?.url ?? "") \(note.tags.joined(separator: " "))".localizedCaseInsensitiveContains(query)
            return matchesFilter && matchesSearch
        }
    }
    private var navigationContent: some View {
        captureContent
        .onOpenURL(perform: handleNoteLink)
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { handleNoteLink(url) }
        }
        .onChange(of: library.notes) { _, _ in resolveNoteLink() }
        .onChange(of: filter) { _, value in recordFilterView(value) }
        .task(id: query) {
            guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(800))
            if !Task.isCancelled { Telemetry.shared.record(.searchPerformed, ["query_length": query.utf16.count, "results": filtered.count]) }
        }
        .onChange(of: library.syncing) { _, syncing in if !syncing { resolveNoteLink(reportMissing: true) } }
        .alert("Открытие заметки", isPresented: Binding(get: { noteLinkError != nil }, set: { if !$0 { noteLinkError = nil } })) {
            Button("Понятно", role: .cancel) { noteLinkError = nil }
        } message: { Text(noteLinkError ?? "") }
    }
    var body: some View {
        navigationContent
        .onChange(of: phase) { _, value in
            if value != .active && !quickEditorOpen && recorder.recording { finishQuickRecording() }
            if value == .active { library.reload(); Task { await library.sync() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { _ in
            if !quickEditorOpen && recorder.recording { finishQuickRecording() }
        }
        .task {
            if let recovered = EditorDrafts.last() { editorFocusID = recovered.id; editor = recovered }
            await library.sync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(library.pending > 0 ? 2 : 30))
                guard !Task.isCancelled else { return }
                if phase == .active { await library.sync() }
            }
        }
    }
    private var captureContent: some View {
        homeContent
        .sheet(item: $editor, onDismiss: { editorFocusID = nil; quickEditorID = nil }) { note in
            let capture = quickEditorID == note.id
                ? QuickCaptureEditor(recorder: recorder, saveDraft: saveQuickDraft)
                : nil
            NoteEditor(note: note, focusOnOpen: editorFocusID == note.id || !library.notes.contains { $0.id == note.id }, capture: capture) { updated in
                if capture != nil { return saveQuickNote(updated) }
                let isNew = !library.notes.contains { $0.id == updated.id }
                let saved = library.save(updated, feedback: false)
                if saved && isNew && quickNote == nil && recorder.recordingID == nil { draft = "" }
                return saved
            }.id(note.id).presentationDragIndicator(.hidden).presentationCornerRadius(24)
        }
        .sheet(isPresented: $settings) { SettingsView() }
        .alert("Новый тег", isPresented: $creatingTag) {
            TextField("Название тега", text: $newTag).textInputAutocapitalization(.never)
            Button("Создать") { if library.createTag(newTag) { newTag = "" } }
                .disabled(newTag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || newTag.utf16.count > 100)
            Button("Отмена", role: .cancel) { newTag = "" }
        } message: { Text("Одну заметку можно отметить несколькими тегами.") }
        .onReceive(quickCapture.$pending) { request in
            guard request != nil else { return }
            quickCapture.pending = nil
            Task { @MainActor in
                guard await NoteLinkEditors.prepare() else { return }
                closeDrawer(); settings = false; focused = false
                if recorder.recordingID != nil || quickNote != nil { expandQuickComposer() }
                else { openComposer(draft) }
            }
        }
        .fileImporter(isPresented: $quickImporter, allowedContentTypes: [.item], allowsMultipleSelection: true, onCompletion: importQuickFiles)
        .photosPicker(isPresented: $quickPhotoPicker, selection: $quickPhoto, matching: .images)
        .onChange(of: quickPhoto) { _, photo in
            if let photo { importQuickPhoto(photo) }
        }
        .alert("Быстрая заметка", isPresented: Binding(get: { quickError != nil }, set: { if !$0 { quickError = nil } })) {
            Button("Понятно", role: .cancel) { quickError = nil }
        } message: { Text(quickError ?? "") }
    }
    private var homeContent: some View {
        GeometryReader { geometry in
            let width = min(320.0, geometry.size.width * 0.82)
            ZStack(alignment: .leading) {
                Palette.ink
                    .overlay { Palette.sidebar.opacity(min(1, drawerProgress * 3)) }
                    .ignoresSafeArea(.container, edges: .vertical)
                sidebar.frame(width: width)
                    .disabled(drawerDragOrigin != nil)
                    .allowsHitTesting(drawer)
                    .accessibilityHidden(!drawer)
                homeForeground(width: width)
                Button(action: closeDrawer) { Color.clear.contentShape(Rectangle()) }
                    .buttonStyle(.plain)
                    .frame(width: geometry.size.width - drawerProgress * width)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .allowsHitTesting(drawer)
                    .accessibilityHidden(!drawer)
                    .accessibilityLabel("Закрыть боковое меню")
                    .accessibilityIdentifier("close-sidebar")
            }
            .contentShape(Rectangle())
            .modifier(HorizontalDragModifier(enabled: drawer, target: .closeDrawer,
                onChanged: { translation, _ in changeDrawer(translation: translation, width: width) },
                onEnded: { translation, predicted in finishDrawer(translation: translation, predicted: predicted, width: width) },
                onCancelled: cancelDrawerDrag))
        }
    }
    private func homeForeground(width: CGFloat) -> some View {
        let progress = min(1, max(0, drawerProgress))
        let shape = RoundedRectangle(cornerRadius: 32 * min(1, progress * 2.5), style: .continuous)
        return feed
            .scrollDisabled(drawer)
            .modifier(HorizontalDragModifier(enabled: !drawer, target: .openDrawer,
                onChanged: { translation, _ in changeDrawer(translation: translation, width: width) },
                onEnded: { translation, predicted in finishDrawer(translation: translation, predicted: predicted, width: width) },
                onCancelled: cancelDrawerDrag))
            .safeAreaInset(edge: .top, spacing: 0) { sidebarButton }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
            .background(Palette.ink, ignoresSafeAreaEdges: [])
            .clipShape(shape)
            .compositingGroup()
            .shadow(color: .black.opacity(progress * 0.18), radius: 16, x: -4)
            .scaleEffect(reduceMotion ? 1 : 1 - 0.027 * progress, anchor: .leading)
            .offset(x: progress * width)
            .allowsHitTesting(!drawer)
            .accessibilityHidden(drawer)
    }
    private var sidebarButton: some View {
        Button(action: openDrawer) {
            DoompileSymbol(systemName: "sidebar.left", size: 21)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.text)
        .padding(.leading, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ink)
        .accessibilityLabel("Открыть боковое меню")
        .accessibilityIdentifier("open-sidebar")
    }
    private func recordFilterView(_ value: String) {
        let category: String
        switch value {
        case "Все заметки": category = "all"
        case "Важное": category = "urgent"
        case "Закреплённое": category = "pinned"
        default: category = "tag"
        }
        Telemetry.shared.record(.screenViewed, ["screen": "feed", "filter": category])
    }
    private func openComposer(_ text: String) {
        let note = Note.text(text)
        editorFocusID = note.id
        editor = note
    }
    private var quickEditorOpen: Bool { quickEditorID != nil && editor?.id == quickEditorID }
    private var quickDraft: Note { quickNote ?? Note.text(draft) }
    private func compactQuickNote(_ original: Note) -> Binding<Note> {
        Binding(get: { quickNote ?? original }, set: { note in
            guard !quickEditorOpen, quickNote?.id == original.id else { return }
            do { try saveQuickDraft(note) } catch { quickError = error.localizedDescription }
        })
    }
    private func expandQuickComposer() {
        guard !quickTransitioning else { return }
        quickTransitioning = true
        Task {
            defer { quickTransitioning = false }
            do { try await refreshCompactQuickNote() } catch { quickError = error.localizedDescription; return }
            focused = false
            let note = quickDraft
            quickUsesRichEditor = true
            quickEditorID = note.id
            editorFocusID = note.id
            editor = note
        }
    }
    private func handleNoteLink(_ url: URL) {
        if url.scheme == "doompile", url.host == "quick-note" { quickCapture.request(); return }
        if url.scheme == "doompile", url.host == "compose" {
            openComposer(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "text" })?.value ?? "")
            return
        }
        guard let id = NoteLinks.noteID(in: url, allowedOrigins: NoteLinks.acceptedOrigins) else { return }
        if editor?.id == id { return }
        let request = UUID(); noteLinkRequest = request
        Task { @MainActor in
            guard await NoteLinkEditors.prepare() else { noteLinkError = "Сначала сохрани открытую заметку и повтори переход."; return }
            guard noteLinkRequest == request else { return }
            closeDrawer(); settings = false; focused = false
            library.reload(); pendingNoteID = id
            resolveNoteLink()
            if pendingNoteID != nil {
                await library.sync()
                if !library.syncing { resolveNoteLink(reportMissing: true) }
            }
        }
    }
    private func resolveNoteLink(reportMissing: Bool = false) {
        guard let id = pendingNoteID else { return }
        if let note = library.notes.first(where: { $0.id == id }) {
            pendingNoteID = nil; editor = note
        } else if reportMissing && !library.syncing {
            pendingNoteID = nil
            noteLinkError = library.error ?? "Заметка не найдена или удалена. Проверь, что подключено нужное хранилище."
        }
    }
    private var feedItems: [FeedItem] {
        var result: [FeedItem] = []
        let collapsed = collapsedSections
        for group in FeedSection.make(filtered, includingUrgent: true) {
            let icon = group.id == "urgent" ? "flame.fill" : group.id == "pinned" ? "pin" : nil
            result.append(.heading(group.id, group.title, group.notes.count, icon))
            if !collapsed.contains(group.id) { result += group.notes.map(FeedItem.note) }
        }
        return result
    }
    private var feed: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
            // A note keeps its identity as it moves between urgent, pinned and dated groups.
            ForEach(feedItems) { item in
                switch item {
                case .heading(let id, let title, let count, let icon): sectionLabel(id: id, title: title, count: count, icon: icon)
                case .note(let note): noteRow(note)
                }
            }
            if filtered.isEmpty {
                VStack(alignment: .leading, spacing: 16) {
                    Image("dp-void").resizable().aspectRatio(contentMode: .fit).frame(width: 104, height: 104).accessibilityHidden(true)
                    Text(query.isEmpty ? BrandCopy.motto : UICopy.searchEmpty).font(.system(size: 29, weight: .bold)).tracking(-0.8)
                    Text(query.isEmpty ? UICopy.emptyBody : UICopy.searchHint)
                        .font(.system(size: 15)).foregroundStyle(Palette.muted).lineSpacing(4)
                }.padding(.top, 70).padding(.bottom, 90).padding(.horizontal, 30)
            }
            }
        }
        .accessibilityIdentifier("note-feed")
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .simultaneousGesture(TapGesture().onEnded { focused = false; quickBridge.blur() })
        .refreshable { await library.sync() }

    }
    private func sectionLabel(id: String, title: String, count: Int, icon: String?) -> some View {
        HStack(spacing: 0) {
            Button { focused = false; toggleSection(id) } label: {
                HStack(spacing: 7) {
                    DoompileSymbol(systemName: "chevron.right", size: 9)
                        .rotationEffect(.degrees(collapsedSections.contains(id) ? 0 : 90))
                        .foregroundStyle(Palette.muted)
                    if let icon { DoompileSymbol(systemName: icon).foregroundStyle(id == "urgent" ? Palette.orange : Palette.muted) }
                    Text(title).fontWeight(.semibold)
                    Text(String(count)).foregroundStyle(Palette.muted)
                    Spacer()
                }.font(.system(size: 12)).foregroundStyle(Palette.text).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("feed-section-" + id)
                .accessibilityLabel("\(title), \(count)")
                .accessibilityValue(collapsedSections.contains(id) ? "Свёрнуто" : "Развёрнуто")
            if !query.isEmpty || filter != "Все заметки" {
                Button { query = ""; filter = "Все заметки" } label: {
                    DoompileSymbol(systemName: "xmark.circle.fill").foregroundStyle(Palette.muted)
                }.buttonStyle(.plain).accessibilityLabel("Сбросить фильтры")
            }
        }.padding(.top, 20).padding(.bottom, 8).padding(.horizontal, 22)
    }
    private func noteRow(_ note: Note, urgent: Bool = false) -> some View {
        NoteSwipeRow(note: note, revealedID: $revealedNoteID,
            onOpen: { focused = false; editor = note },
            onPin: { togglePinned(note) }, onUrgent: { toggleUrgent(note) },
            onDelete: { library.remove(note) }) { NoteCard(note: note, uploadStates: library.uploadStates) }
            .padding(.horizontal, 20).padding(.vertical, 6)
    }

    private var quickHasPayload: Bool {
        recorder.recording || recorder.starting || recorder.hasPendingRecording
            || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || quickNote.map({ EditorLifecycle.shouldSave($0, existing: false) }) == true
    }
    private var quickImportInProgress: Bool { !quickPreparing.isEmpty || preparingPhoto }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            if recorder.recording || recorder.starting || recorder.hasPendingRecording {
                quickRecordingSnippet
                    .padding(.horizontal, 6).padding(.top, 4)
            }
            let attachments = quickNote?.attachments ?? []
            if !attachments.isEmpty || quickImportInProgress {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachments) { file in
                            CaptureAttachmentSnippet(attachment: file, remove: { removeQuickAttachment(file) })
                                .frame(width: 210).accessibilityIdentifier("quick-attachment")
                        }
                        ForEach(quickPreparing) { file in
                            CaptureAttachmentSnippet(attachment: file, transfer: .uploading(nil))
                                .frame(width: 210)
                        }
                        if preparingPhoto {
                            CaptureAttachmentSnippet(attachment: Attachment(id: "photo", name: "Фото", mimeType: "image/*", url: "", size: 0),
                                transfer: .uploading(nil)).frame(width: 210)
                        }
                    }.padding(.horizontal, 6)
                }.padding(.top, 4)
            }
            HStack(spacing: 2) {
                quickAttachmentMenu
                quickInput
                Button(action: expandQuickComposer) {
                    DoompileSymbol(systemName: "arrow.up.left.and.arrow.down.right", size: 18)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .disabled(quickTransitioning || quickImportInProgress)
                .accessibilityLabel("Развернуть редактор").accessibilityIdentifier("expand-editor")
                quickVoiceAction
            }.foregroundStyle(Palette.muted)
        }
        .buttonStyle(.plain)
        .padding(4).background(Palette.card, in: RoundedRectangle(cornerRadius: 21))
        .overlay { RoundedRectangle(cornerRadius: 21).strokeBorder(Palette.line) }
        .shadow(color: .black.opacity(0.04), radius: 12, y: 3)
        .padding(.horizontal, 14).padding(.vertical, 8).background(Palette.ink)
    }
    private var quickAttachmentMenu: some View {
        Menu {
            Button { focused = false; quickBridge.blur(); quickImporter = true } label: {
                DoompileLabel("Файл", systemImage: "doc")
            }
            Button { focused = false; quickBridge.blur(); quickPhotoPicker = true } label: {
                DoompileLabel("Фото", systemImage: "photo")
            }
        } label: {
            DoompileSymbol(systemName: "paperclip", size: 19)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .disabled(quickTransitioning || quickImportInProgress)
        .accessibilityLabel("Прикрепить файл").accessibilityIdentifier("quick-attach")
    }
    @ViewBuilder private var quickInput: some View {
        if quickUsesRichEditor, !quickEditorOpen, let quickNote {
            let binding = compactQuickNote(quickNote)
            RichEditorView(document: binding.body, plainText: binding.plainText, height: .constant(0),
                attachments: binding.attachments, notes: library.notes, bridge: quickBridge,
                onReference: { id in
                    if let note = library.notes.first(where: { $0.id == id }) { editor = note }
                }, onRequestLink: { _ in expandQuickComposer() }, onAction: handleCompactCaptureAction, captureCompact: true,
                onPasteImage: { data, name, mime in try storeQuickImage(data, name: name, mime: mime, noteID: quickNote.id) })
                .id(quickNote.id).frame(height: 44).accessibilityIdentifier("quick-rich-input")
        } else {
            TextField(UICopy.capturePlaceholder, text: Binding(get: { draft }, set: updateQuickText), axis: .vertical)
                .lineLimit(1).focused($focused).onTapGesture { focused = true }.font(.system(size: 16))
                .foregroundStyle(Palette.text).frame(maxWidth: .infinity).accessibilityIdentifier("quick-input")
        }
    }
    private var quickVoiceAction: some View {
        QuickVoiceControl(showsSend: quickHasPayload,
            enabled: !recorder.starting && !quickTransitioning && !quickImportInProgress,
            onActivate: { if quickHasPayload { sendQuickDraft() } else { startQuickRecording() } },
            onHoldStart: { startQuickRecording(held: true) }, onHoldEnd: finishQuickHold)
            .frame(width: 44, height: 44)
            .overlay {
                DoompileSymbol(systemName: quickHasPayload ? "arrow.up" : "mic", size: 19)
                    .frame(width: 40, height: 40)
                    .background(quickHasPayload ? Palette.lime : .clear, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(quickHasPayload ? Palette.onLime : Palette.muted)
                    .allowsHitTesting(false).accessibilityHidden(true)
            }
    }
    private var quickRecordingSnippet: some View {
        HStack(spacing: 8) {
            DoompileSymbol(systemName: "waveform", size: 17)
                .foregroundStyle(Palette.orange)
                .frame(width: 32, height: 32)
                .background(Palette.urgent, in: RoundedRectangle(cornerRadius: DesignTokens.radiusControl))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(recorder.starting ? "Включаем микрофон…" : "Голосовая заметка")
                    .font(.system(size: 13, weight: .medium)).lineLimit(1)
                if !recorder.starting {
                    HStack(spacing: 5) {
                        Text(Note.timeLabel(recorder.seconds)).monospacedDigit()
                        if quickHolding { Text("· Отпусти, чтобы отправить").lineLimit(1) }
                    }.font(.system(size: 11)).foregroundStyle(Palette.muted)
                }
            }.accessibilityIdentifier("quick-recording")
            Spacer(minLength: 0)
            Button {
                if recorder.starting { quickHolding = false; recorder.cancel() }
                else { finishQuickRecording() }
            } label: {
                DoompileSymbol(systemName: recorder.starting ? "xmark" : recorder.hasPendingRecording ? "arrow.clockwise" : "stop.fill", size: 14)
                    .foregroundStyle(Palette.orange)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel(recorder.starting ? "Отменить запись" : recorder.hasPendingRecording ? "Повторить сохранение записи" : "Остановить запись")
            .accessibilityIdentifier("quick-stop-recording")
        }
        .padding(.leading, 6).frame(minHeight: 44)
        .foregroundStyle(Palette.text)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay { RoundedRectangle(cornerRadius: DesignTokens.radiusCard).strokeBorder(Palette.line) }
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Brand().padding(.top, 24).padding(.bottom, 8)
            Text(BrandCopy.motto).font(.system(size: 12)).foregroundStyle(Palette.muted).padding(.bottom, 26)
            HStack(spacing: 8) {
                DoompileSymbol(systemName: "magnifyingglass").foregroundStyle(Palette.muted)
                TextField("Поиск по заметкам", text: $query).focused($searchFocused).onTapGesture { searchFocused = true }
                    .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
                    .onSubmit { closeDrawer() }.accessibilityIdentifier("sidebar-search")
                if !query.isEmpty { Button { query = "" } label: { DoompileSymbol(systemName: "xmark.circle.fill").foregroundStyle(Palette.muted) }.accessibilityLabel("Очистить поиск") }
            }.font(.system(size: 14)).padding(12).background(Palette.line.opacity(0.5), in: RoundedRectangle(cornerRadius: 11)).padding(.bottom, 20)
            ScrollView {
                VStack(alignment: .leading, spacing: 5) {
                    navRow("Все заметки", icon: "tray", count: library.notes.count)
                    navRow("Важное", icon: "flame", count: library.notes.filter(\.urgent).count)
                    navRow("Закреплённое", icon: "pin", count: library.notes.filter(\.pinned).count)
                    HStack {
                        Text("ТЕГИ").font(.system(size: 10, weight: .medium)).tracking(1.8).foregroundStyle(Palette.muted)
                        Spacer()
                        Button { searchFocused = false; creatingTag = true } label: { DoompileSymbol(systemName: "plus").frame(width: 44, height: 38).contentShape(Rectangle()) }
                            .accessibilityLabel("Создать тег").accessibilityIdentifier("sidebar-create-tag")
                    }.padding(.top, 18).padding(.leading, 12)
                    ForEach(library.tags, id: \.self) { tag in
                        navRow(tag, icon: "number", count: library.notes.filter { $0.tags.contains(tag) }.count)
                    }
                    if library.tags.isEmpty { Text("Одна заметка может быть\nсразу в нескольких тегах.").font(.system(size: 13)).foregroundStyle(Palette.muted).lineSpacing(4).padding(12) }
                }
            }.scrollDismissesKeyboard(.interactively)
            Spacer(minLength: 12)
            Divider().overlay(Palette.line).padding(.bottom, 10)
            Button { closeDrawer(); settings = true } label: {
                DoompileLabel("Настройки", systemImage: "gearshape").font(.system(size: 14)).frame(maxWidth: .infinity, alignment: .leading).padding(12)
            }.accessibilityIdentifier("sidebar-settings")
            HStack(spacing: 6) {
                DoompileSymbol(systemName: library.error == nil ? "checkmark.icloud" : "icloud.slash")
                Text(library.pending > 0 ? "\(library.pending) ждут синхронизации" : "Всё сохранено на устройстве")
            }.font(.system(size: 10)).foregroundStyle(Palette.muted).padding(.horizontal, 12).padding(.top, 8)
        }.padding(.horizontal, 18).padding(.bottom, 22).frame(maxHeight: .infinity)
            .foregroundStyle(Palette.text)
    }
    private func navRow(_ title: String, icon: String, count: Int) -> some View {
        Button { filter = title; closeDrawer() } label: {
            HStack(spacing: 12) {
                DoompileSymbol(systemName: icon).frame(width: 20).foregroundStyle(title == "Важное" ? Palette.orange : Palette.text)
                Text(title); Spacer(); Text(String(count)).foregroundStyle(Palette.muted).font(.system(size: 12))
            }.font(.system(size: 14)).padding(12).background(filter == title ? Palette.limeSoft : .clear, in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).accessibilityIdentifier("nav-" + title)
    }
    private func changeDrawer(translation: CGSize, width: CGFloat) {
        if drawerDragOrigin == nil {
            drawerDragOrigin = drawerProgress
            focused = false; searchFocused = false; quickBridge.blur()
            revealedNoteID = nil
        }
        guard let origin = drawerDragOrigin else { return }
        var transaction = Transaction(); transaction.disablesAnimations = true
        withTransaction(transaction) { drawerProgress = min(1, max(0, origin + translation.width / width)) }
    }
    private func finishDrawer(translation: CGSize, predicted: CGSize, width: CGFloat) {
        guard let origin = drawerDragOrigin else { return }
        let progress = min(1, max(0, origin + translation.width / width))
        let projected = predicted.width - translation.width
        let flick = abs(translation.width) >= 28 && abs(projected) >= 28
        let open = flick ? projected > 0 : progress > (drawer ? 0.68 : 0.32)
        let remaining = ((open ? 1 : 0) - progress) * width
        let initialVelocity = abs(remaining) > 1 ? Double(projected / (HorizontalDragTarget.projectionTime * remaining)) : 0
        setDrawer(open, initialVelocity: min(4, max(0, initialVelocity)))
    }
    private func cancelDrawerDrag() {
        guard drawerDragOrigin != nil else { return }
        setDrawer(drawer)
    }
    private func setDrawer(_ open: Bool, initialVelocity: Double = 0) {
        focused = false; searchFocused = false; quickBridge.blur()
        if open { revealedNoteID = nil }
        drawerDragOrigin = nil
        let motion: Animation = reduceMotion ? .linear(duration: 0.01)
            : .interpolatingSpring(stiffness: 330, damping: 36, initialVelocity: initialVelocity)
        withAnimation(motion) { drawer = open; drawerProgress = open ? 1 : 0 }
    }
    private func openDrawer() { setDrawer(true) }
    private func closeDrawer() { setDrawer(false) }
    private func toggleUrgent(_ note: Note) {
        var updated = note
        updated.urgent.toggle()
        if library.save(updated, feedback: false) { UISelectionFeedbackGenerator().selectionChanged() }
    }
    private func togglePinned(_ note: Note) {
        var updated = note
        updated.pinned.toggle()
        if library.save(updated, feedback: false) { UISelectionFeedbackGenerator().selectionChanged() }
    }
    @ViewBuilder private func noteMenu(_ note: Note) -> some View {
        if let url = NoteLinks.shareURL(id: note.id) {
            Button { UIPasteboard.general.url = url } label: { DoompileLabel("Скопировать ссылку", systemImage: "link") }
            ShareLink(item: url) { DoompileLabel("Поделиться ссылкой", systemImage: "square.and.arrow.up") }
        }
        Button { toggleUrgent(note) } label: { DoompileLabel(note.urgent ? "Убрать из важного" : "Сделать важной", systemImage: "flame") }
        Button { togglePinned(note) } label: { DoompileLabel(note.pinned ? "Открепить" : "Закрепить", systemImage: "pin") }
        Button(role: .destructive) { library.remove(note) } label: { DoompileLabel("Удалить", systemImage: "trash") }
    }
    private func startQuickRecording(held: Bool = false) {
        guard !quickTransitioning, !quickImportInProgress,
              !recorder.starting, !recorder.recording, !recorder.hasPendingRecording else { return }
        guard (quickNote?.attachments.count ?? 0) < NoteLimits.attachments else {
            quickError = "В заметке уже \(NoteLimits.attachments) вложений."
            return
        }
        quickHolding = held
        Task {
            do { try await recorder.start() }
            catch { quickHolding = false; quickError = error.localizedDescription }
        }
    }
    private func finishQuickHold(_ release: QuickVoiceControl.Release) {
        guard quickHolding else { return }
        quickHolding = false
        if recorder.recording {
            if release == .inside && recorder.elapsed >= 0.12 { sendQuickDraft() }
            else { finishQuickRecording() }
        } else if release == .outside {
            recorder.cancel()
        }
        // A first-run permission prompt can outlast the press. That recording
        // stays in the composer until the user stops or sends it explicitly.
    }
    private func finishQuickRecording() {
        quickHolding = false
        do {
            guard library.isCurrentAccount else { throw DoompileError.authentication }
            var note = quickDraft
            let (id, attachment) = try recorder.attachRecording(to: &note)
            try saveQuickDraft(note)
            quickBridge.completeRecording(id, attachment: attachment)
        } catch { quickError = error.localizedDescription }
    }
    private func updateQuickText(_ text: String) {
        draft = text
        guard var note = quickNote, note.plainText != text else { return }
        note.plainText = text
        note.body = JSONValue.document(text).includingAttachments(note.attachments)
        do { try saveQuickDraft(note) } catch { quickError = error.localizedDescription }
    }
    private func saveQuickDraft(_ note: Note) throws {
        quickNote = note
        draft = note.plainText
        var durable = note
        if let id = recorder.recordingID { durable.body = durable.body.removingRecording(id) }
        UserDefaults.standard.set(try JSONEncoder().encode(durable), forKey: quickComposerKey)
    }
    private var quickAttachmentSlots: Int {
        let reservedForRecording = recorder.recordingID != nil || recorder.starting ? 1 : 0
        return NoteLimits.attachments - (quickNote?.attachments.count ?? 0) - reservedForRecording
    }
    private func storeQuickImage(_ data: Data, name: String, mime: String, noteID: String) throws -> Attachment {
        guard quickNote?.id == noteID else { throw DoompileError.authentication }
        return try storeQuickFile(data, name: name, mime: mime)
    }
    @discardableResult
    private func storeQuickFile(_ data: Data, name: String, mime: String) throws -> Attachment {
        guard library.isCurrentAccount, !quickTransitioning, !quickEditorOpen else { throw DoompileError.authentication }
        guard data.count <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }
        guard quickAttachmentSlots > 0 else { throw DoompileError.message("В заметке уже \(NoteLimits.attachments) вложений.") }
        var note = quickDraft
        let attachment = try Storage.shared.addFile(data, name: name, mimeType: mime)
        note.attachments.append(attachment)
        note.body = note.body.appendingQuickAttachment(attachment)
        if note.kind == "note" {
            note.kind = mime.hasPrefix("image/") ? "image" : mime.hasPrefix("audio/") ? "audio" : "file"
        }
        try saveQuickDraft(note)
        return attachment
    }
    private func removeQuickAttachment(_ attachment: Attachment) {
        guard !quickTransitioning, var note = quickNote else { return }
        note.attachments.removeAll { $0.id == attachment.id }
        note.body = note.body.removingQuickAttachment(url: attachment.url)
        if note.attachments.isEmpty && ["image", "audio", "file"].contains(note.kind) { note.kind = "note" }
        do {
            try saveQuickDraft(note)
            quickBridge.removeAttachment(attachment)
        } catch { quickError = error.localizedDescription }
    }
    private func importQuickFiles(_ result: Result<[URL], Error>) {
        do {
            let urls = try result.get()
            guard urls.count <= quickAttachmentSlots else {
                throw DoompileError.message("В одной заметке может быть не больше \(NoteLimits.attachments) вложений.")
            }
            let selected = urls.map { url in
                Attachment(id: UUID().uuidString, name: url.lastPathComponent,
                    mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                    url: url.absoluteString, size: 0)
            }
            quickPreparing = selected
            Task {
                for (url, item) in zip(urls, selected) {
                    defer { quickPreparing.removeAll { $0.id == item.id } }
                    do {
                        let data = try await Task.detached(priority: .userInitiated) {
                            let access = url.startAccessingSecurityScopedResource()
                            defer { if access { url.stopAccessingSecurityScopedResource() } }
                            if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 30 * 1024 * 1024 {
                                throw DoompileError.message("Максимальный размер вложения — 30 МБ.")
                            }
                            return try Data(contentsOf: url, options: .mappedIfSafe)
                        }.value
                        let file = try storeQuickFile(data, name: item.name, mime: item.mimeType)
                        if quickBridge.ready { quickBridge.insertAttachment(file) }
                    } catch { quickError = error.localizedDescription }
                }
            }
        } catch { quickError = error.localizedDescription }
    }
    private func importQuickPhoto(_ photo: PhotosPickerItem) {
        preparingPhoto = true
        Task {
            defer { preparingPhoto = false; quickPhoto = nil }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self) else {
                    throw DoompileError.message("Не удалось прочитать фото.")
                }
                let type = EditorImagePaste.contentType(of: data) ?? photo.supportedContentTypes.first
                let file = try storeQuickFile(data, name: "Фото." + (type?.preferredFilenameExtension ?? "jpg"),
                    mime: type?.preferredMIMEType ?? "image/jpeg")
                if quickBridge.ready { quickBridge.insertAttachment(file) }
            } catch { quickError = error.localizedDescription }
        }
    }
    private func refreshCompactQuickNote() async throws {
        guard quickBridge.ready, var note = quickNote else { return }
        let snapshot = try await quickBridge.snapshot()
        guard quickNote == note else { return }
        note.body = snapshot.body
        note.plainText = snapshot.plainText
        try saveQuickDraft(note)
    }
    private func handleCompactCaptureAction(_ action: String) {
        switch EditorAction(rawValue: action) {
        case .sendCapture: sendQuickDraft()
        case .expandCapture, .drawing: expandQuickComposer()
        case .file: quickBridge.blur(); quickImporter = true
        case .image: quickBridge.blur(); quickPhotoPicker = true
        case .voice: startQuickRecording()
        case .stopVoice, .retryVoice: if recorder.recording || recorder.hasPendingRecording { finishQuickRecording() }
        case .preferencesClosed, nil: break
        }
    }
    private func sendQuickDraft() {
        guard !quickTransitioning, !recorder.starting, !quickImportInProgress else { return }
        quickTransitioning = true
        Task {
            defer { quickTransitioning = false }
            do { try await refreshCompactQuickNote() } catch { quickError = error.localizedDescription; return }
            if recorder.recording || recorder.hasPendingRecording {
                finishQuickRecording()
                guard !recorder.recording, !recorder.hasPendingRecording else { return }
            }
            _ = saveQuickNote(quickNote ?? Note.text(draft.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
    }
    private func saveQuickNote(_ original: Note) -> Bool {
        var note = EditorLifecycle.prepared(original)
        if note.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           note.title == "Голосовая заметка.m4a" { note.title = "Голосовая заметка" }
        if !note.attachments.isEmpty, case .object(var document) = note.body {
            var attrs: [String: JSONValue] = [:]
            if case .object(let existing) = document["attrs"] { attrs = existing }
            attrs["editorVersion"] = .number(1)
            document["attrs"] = .object(attrs)
            note.body = .object(document)
        }
        if EditorLifecycle.shouldSave(note, existing: false), !library.save(note) {
            quickError = library.error
            return false
        }
        quickNote = nil
        quickUsesRichEditor = false
        draft = ""
        focused = false
        UserDefaults.standard.removeObject(forKey: quickComposerKey)
        return true
    }
}

struct NoteCard: View {
    let note: Note
    var uploadStates: [String: AttachmentUploadState] = [:]
    private func transfer(for attachment: Attachment) -> AttachmentUploadState? {
        attachment.url.hasPrefix("local:") ? uploadStates[attachment.id] ?? .queued : nil
    }
    private var excerpt: String {
        var lines = note.plainText.components(separatedBy: .newlines)
        if lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) == note.displayTitle.trimmingCharacters(in: .whitespacesAndNewlines) { lines.removeFirst() }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var image: Attachment? { note.attachments.first { $0.mimeType.hasPrefix("image/") } }
    private var showTitle: Bool {
        guard !note.attachments.isEmpty else { return true }
        return !note.title.isEmpty && !note.attachments.contains { $0.name == note.title }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let image {
                AttachmentImage(attachment: image).frame(maxWidth: .infinity).frame(height: 200).clipped()
                    .overlay(alignment: .bottomTrailing) {
                        if let state = transfer(for: image) {
                            AttachmentTransferBadge(state: state)
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(Palette.card, in: RoundedRectangle(cornerRadius: DesignTokens.radiusControl))
                                .padding(8)
                        }
                    }
            }
            VStack(alignment: .leading, spacing: 8) {
                if showTitle {
                    HStack(spacing: 6) {
                        if note.urgent { DoompileSymbol(systemName: "flame.fill").foregroundStyle(Palette.orange) }
                        Text(note.displayTitle).font(.system(size: 16, weight: .semibold)).lineLimit(2)
                        Spacer(minLength: 0)
                        if note.pinned { DoompileSymbol(systemName: "pin.fill", size: 11).foregroundStyle(Palette.accent) }
                    }
                }
                if let quote = note.source?.quote, !quote.isEmpty {
                    Text(quote).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(3)
                }
                if !excerpt.isEmpty { Text(excerpt).font(.system(size: 14)).foregroundStyle(Palette.muted).lineLimit(5).lineSpacing(3) }
                ForEach(note.attachments.filter { $0.id != image?.id }) { file in
                    CaptureAttachmentSnippet(attachment: file, transfer: transfer(for: file))
                }
                HStack(spacing: 6) {
                    if let source = note.source, let host = URL(string: source.url)?.host {
                        Text(host.replacingOccurrences(of: "www.", with: "")).lineLimit(1)
                        if let time = source.timestampSeconds { Text("· " + Note.timeLabel(time)) }
                    }
                    Spacer(minLength: 4)
                    ForEach(note.tags.prefix(2), id: \.self) { Text("#" + $0).lineLimit(1) }
                }.font(.system(size: 10)).foregroundStyle(Palette.muted).frame(minHeight: image == nil ? 0 : 12)
            }.padding(.horizontal, 15).padding(.vertical, image != nil && !showTitle && excerpt.isEmpty ? 8 : 13)
        }.foregroundStyle(Palette.text).frame(maxWidth: .infinity, alignment: .leading)
            .background(note.urgent ? Palette.urgent : Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(note.urgent ? Palette.orange.opacity(0.22) : Palette.line.opacity(0.75)))
    }
}

struct AttachmentImage: View {
    let attachment: Attachment
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else { Rectangle().fill(Palette.line.opacity(0.3)).overlay(DoompileSymbol(systemName: "photo").foregroundStyle(Palette.muted)) }
        }.task(id: attachment.url) {
            image = nil
            guard let url = try? await AttachmentFiles.resolve(attachment) else { return }
            // Decode a bounded thumbnail away from the UI executor, never the full photo.
            let thumbnail = await Task.detached(priority: .utility) { () -> UIImage? in
                guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
                      let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 900,
                        kCGImageSourceShouldCacheImmediately: true
                      ] as CFDictionary) else { return nil }
                return UIImage(cgImage: cgImage)
            }.value
            guard !Task.isCancelled else { return }
            image = thumbnail
        }
    }
}

struct QuickCaptureEditor {
    let recorder: VoiceRecorder
    let saveDraft: (Note) throws -> Void
}

struct NoteEditor: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @EnvironmentObject private var library: Library
    @State var note: Note
    var focusOnOpen = false
    let capture: QuickCaptureEditor?
    let onSave: (Note) -> Bool
    @State private var text: String
    @State private var photo: PhotosPickerItem?
    @State private var importer = false
    @State private var drawing = false
    @State private var editingTags = false
    @State private var error: String?
    @StateObject private var recorder: VoiceRecorder
    @State private var preview: URL?
    @State private var editorHeight: CGFloat = 280
    @StateObject private var editorBridge = RichEditorBridge()
    @State private var referencedNote: Note?
    @State private var linkPrompt = false
    @State private var linkURL = ""
    @State private var saving = false
    @State private var captureSent = false
    @State private var autosaveTask: Task<Void, Never>?
    @State private var lastSaved: Note?
    @State private var linkEditorToken = UUID()

    init(note: Note, focusOnOpen: Bool = false, capture: QuickCaptureEditor? = nil, onSave: @escaping (Note) -> Bool) {
        var document = capture == nil ? EditorDrafts.load(note) : note
        if capture == nil { document.body = document.editorDocument }
        _note = State(initialValue: document)
        _text = State(initialValue: document.plainText)
        _lastSaved = State(initialValue: focusOnOpen ? nil : EditorLifecycle.prepared(document))
        _recorder = StateObject(wrappedValue: capture?.recorder ?? VoiceRecorder())
        self.focusOnOpen = focusOnOpen
        self.capture = capture
        self.onSave = onSave
    }
    private var editorSurface: some View {
        VStack(spacing: 0) {
            metadata
            RichEditorView(document: $note.body, plainText: $text, height: $editorHeight,
                attachments: $note.attachments, noteID: note.id, notes: library.notes, focusOnLoad: focusOnOpen,
                bridge: editorBridge, onReference: { id in
                    if let reference = library.notes.first(where: { $0.id == id }), reference.id != note.id { referencedNote = reference }
                }, onRequestLink: { href in linkURL = href; editorBridge.blur(); linkPrompt = true }, onAction: handleAction, onPasteImage: storeFile)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(Palette.orange)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 22).padding(.vertical, 8)
            }
        }
        .background(Palette.ink).foregroundStyle(Palette.text)
        // A safe-area inset follows the software keyboard, including interactive dismissal.
        // Unlike a navigation bottomBar, it stays above the keyboard for WKWebView too.
        .safeAreaInset(edge: .bottom, spacing: 0) { touchToolbar }
        .interactiveDismissDisabled()
    }
    private var recordingSurface: some View {
        editorSurface
        .onChange(of: photo) { _, item in
            Task {
                do {
                    if let data = try await item?.loadTransferable(type: Data.self) {
                        let type = EditorImagePaste.contentType(of: data) ?? item?.supportedContentTypes.first
                        let mime = type?.preferredMIMEType ?? "image/jpeg"
                        let ext = type?.preferredFilenameExtension ?? "jpg"
                        try addFile(data, name: "Image.\(ext)", mime: mime)
                    }
                } catch { self.error = error.localizedDescription }
            }
        }
        .onChange(of: editorBridge.ready) { _, _ in syncRecordingSnippet() }
        .onChange(of: recorder.recordingID) { _, _ in syncRecordingSnippet() }
        .onChange(of: recorder.hasPendingRecording) { _, _ in syncRecordingSnippet() }
        .onChange(of: recorder.seconds) { _, _ in updateRecordingSnippet() }
        .onChange(of: phase) { _, value in
            if value != .active && recorder.recording { finishRecording() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { _ in
            if recorder.recording { finishRecording() }
        }
    }
    private var editorPresentation: some View {
        recordingSurface
        .fileImporter(isPresented: $importer, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do {
                for url in try result.get() {
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                    try addFile(Data(contentsOf: url), name: url.lastPathComponent, mime: mime)
                }
            } catch { self.error = error.localizedDescription }
        }
        .sheet(isPresented: $drawing) { DrawingView { data in do { try addFile(data, name: "Рисунок.png", mime: "image/png") } catch { self.error = error.localizedDescription } } }
        .sheet(isPresented: $editingTags) { NoteTagsSheet(tags: $note.tags, available: library.tags) }
        .sheet(item: $referencedNote) { other in
            AnyView(NoteEditor(note: other) { updated in
                if capture == nil { return onSave(updated) }
                return library.save(updated, feedback: false)
            })
        }
        .alert("Ссылка", isPresented: $linkPrompt) {
            TextField("https://…", text: $linkURL).textInputAutocapitalization(.never).keyboardType(.URL)
            Button("Применить") { editorBridge.setLink(linkURL) }
            Button("Отмена", role: .cancel) { editorBridge.focus() }
        } message: { Text("Введи адрес или оставь поле пустым, чтобы убрать ссылку.") }
        .quickLookPreview($preview)
    }
    var body: some View {
        editorPresentation
        .onAppear {
            NoteLinkEditors.register(linkEditorToken) {
                if capture != nil { return await preserveCapture() }
                return await persistForLink()
            }
            if library.notes.contains(where: { $0.id == note.id }) { Telemetry.shared.record(.noteOpened, ["note_id": note.id, "kind": note.kind]) }
            // Persist the incoming quick draft even if its WebKit surface hasn't opened yet.
            saveKnownState()
        }
        .onReceive(library.$notes) { notes in
            guard let saved = lastSaved, let server = notes.first(where: { $0.id == note.id }),
                  capture == nil, !recorder.recording, !recorder.hasPendingRecording else { return }
            guard let acknowledgement = Note.acknowledging(saved: saved, server: server, current: note) else {
                if EditorLifecycle.prepared(note, plainText: text) == saved, server != saved {
                    autosaveTask?.cancel()
                    note = server; note.body = server.editorDocument; text = server.plainText; lastSaved = server
                    editorBridge.replaceDocument(server.editorDocument)
                }
                return
            }
            if note != acknowledgement.note { note = acknowledgement.note }
            lastSaved = server
            if !acknowledgement.replacements.isEmpty { editorBridge.reconcileAttachments(acknowledgement.replacements) }
        }
        .onChange(of: note) { _, _ in scheduleAutosave() }
        .onChange(of: text) { _, _ in scheduleAutosave() }
        .onChange(of: phase) { _, value in if value != .active { saveKnownState() } }
        .onDisappear {
            NoteLinkEditors.unregister(linkEditorToken)
            autosaveTask?.cancel()
            saveKnownState()
            if capture == nil { recorder.cancel() }
        }
    }
    private var voiceCapture: Bool {
        capture != nil && (recorder.starting || recorder.recordingID != nil || note.attachments.contains { $0.mimeType.hasPrefix("audio/") })
    }
    private var metadata: some View {
        HStack(spacing: 2) {
            Button { editorBridge.blur(); editingTags = true } label: {
                HStack(spacing: 5) {
                    DoompileSymbol(systemName: "number")
                    Text(note.tags.isEmpty ? "Теги" : note.tags.prefix(2).joined(separator: " · ")).lineLimit(1)
                }.font(.system(size: 12)).foregroundStyle(Palette.muted).padding(.horizontal, 8).frame(height: 44)
            }.accessibilityLabel("Теги заметки")
            Spacer(minLength: 4)
            Button {
                Task { if await persistForLink(), let url = NoteLinks.shareURL(id: note.id) { UIPasteboard.general.url = url } }
            } label: { DoompileSymbol(systemName: "link").foregroundStyle(Palette.muted).frame(width: 44, height: 44).contentShape(Rectangle()) }
                .accessibilityLabel("Скопировать ссылку на заметку").disabled(saving || !editorBridge.ready || capture != nil)
            Button { withAnimation(TouchMotion.quick) { note.pinned.toggle() } } label: {
                DoompileSymbol(systemName: note.pinned ? "pin.fill" : "pin").foregroundStyle(note.pinned ? Palette.accent : Palette.muted).frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel(note.pinned ? "Открепить" : "Закрепить").accessibilityValue(note.pinned ? "Да" : "Нет")
            Button { withAnimation(TouchMotion.quick) { note.urgent.toggle() } } label: {
                DoompileSymbol(systemName: note.urgent ? "flame.fill" : "flame").foregroundStyle(note.urgent ? Palette.orange : Palette.muted).frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel(note.urgent ? "Убрать из важного" : "Сделать важной").accessibilityValue(note.urgent ? "Да" : "Нет")
            Button {
                if voiceCapture {
                    Task { if await preserveCapture() { dismiss() } }
                } else {
                    save()
                }
            } label: { DoompileSymbol(systemName: "xmark").foregroundStyle(Palette.muted).frame(width: 44, height: 44).contentShape(Rectangle()) }
                .disabled(saving || (capture == nil && recorder.starting))
                .accessibilityLabel(voiceCapture ? "Свернуть редактор" : "Сохранить и закрыть").accessibilityIdentifier("close-editor")
            if voiceCapture {
                Button { save() } label: {
                    DoompileSymbol(systemName: "arrow.up", size: 18).font(.system(size: 18, weight: .semibold))
                        .frame(width: 40, height: 40).background(Palette.lime, in: RoundedRectangle(cornerRadius: 14)).foregroundStyle(Palette.onLime)
                }.disabled(saving || recorder.starting).accessibilityLabel("Сохранить заметку").accessibilityIdentifier("send-expanded-capture")
            }
        }.font(.system(size: 17)).buttonStyle(.plain).padding(.leading, 14).padding(.trailing, 8).padding(.top, 14)
    }
    private var touchToolbar: some View {
        VStack(spacing: 0) {
            if recorder.starting || (capture == nil && recorder.recording) {
                HStack(spacing: 8) {
                    Circle().fill(Palette.orange).frame(width: 6, height: 6)
                    Text(recorder.starting ? "Включаем микрофон…" : "Запись " + Note.timeLabel(recorder.seconds)).font(.system(size: 12, design: .monospaced))
                    Spacer()
                    Button("Остановить") { finishRecording() }.disabled(recorder.starting).font(.system(size: 12, weight: .medium))
                }.foregroundStyle(Palette.orange).padding(.horizontal, 20).padding(.vertical, 9)
            }
            HStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        tool("checklist", "Чеклист", command: "checklist")
                        tool("textformat", "Тип блока", command: "blockType")
                        tool("highlighter", "Цвет текста и выделения", command: "colors")
                        tool("ellipsis", "Ещё форматирование", command: "more")
                        tool("square.stack.3d.up", "Действия с блоком", command: "blockActions")
                        PhotosPicker(selection: $photo, matching: .images) {
                            DoompileSymbol(systemName: "photo").frame(width: 44, height: 46).contentShape(Rectangle())
                        }.accessibilityLabel("Добавить фото")
                        toolButton("paperclip", "Прикрепить файл") { editorBridge.blur(); importer = true }
                        if capture == nil || recorder.recordingID == nil {
                            toolButton(recorder.recording ? "stop.circle.fill" : "mic", recorder.recording ? "Остановить запись" : "Записать голос") { toggleRecording() }
                                .foregroundStyle(recorder.recording ? Palette.orange : Palette.muted).disabled(recorder.starting)
                        }
                        Divider().frame(height: 20).padding(.horizontal, 5)
                        tool("bold", "Жирный", command: "bold")
                        tool("italic", "Курсив", command: "italic")
                        tool("underline", "Подчёркнутый", command: "underline")
                        tool("textformat.size", "Заголовок", command: "heading")
                        tool("list.bullet", "Маркированный список", command: "bulletList")
                        tool("list.number", "Нумерованный список", command: "orderedList")
                        tool("increase.indent", "Увеличить отступ", command: "indent")
                        tool("decrease.indent", "Уменьшить отступ", command: "outdent")
                        tool("text.quote", "Цитата", command: "quote")
                        toolButton("link", "Добавить ссылку") { linkURL = ""; editorBridge.blur(); linkPrompt = true }
                        tool("at", "Ссылка на заметку", command: "mention")
                        tool("tablecells", "Вставить таблицу", command: "table")
                        if editorBridge.activeFormats.contains("table") {
                            tool("rectangle.split.1x2", "Добавить строку", command: "tableRow")
                            tool("rectangle.split.2x1", "Добавить столбец", command: "tableColumn")
                            tool("tablecells.badge.ellipsis", "Удалить таблицу", command: "deleteTable")
                        }
                        toolButton("pencil.tip.crop.circle", "Нарисовать") { editorBridge.blur(); drawing = true }
                        tool("chevron.left.forwardslash.chevron.right", "Блок кода", command: "code")
                        tool("arrow.uturn.backward", "Отменить", command: "undo")
                        tool("arrow.uturn.forward", "Повторить", command: "redo")
                    }.padding(.leading, 10)
                }.accessibilityIdentifier("editor-controls")
                Button { editorBridge.blur() } label: {
                    DoompileSymbol(systemName: "keyboard.chevron.compact.down").frame(width: 40, height: 46).contentShape(Rectangle())
                }.accessibilityLabel("Скрыть клавиатуру").accessibilityIdentifier("dismiss-editor-keyboard").padding(.trailing, 10)

            }.font(.system(size: 18)).foregroundStyle(Palette.muted).buttonStyle(.plain)
                .disabled(!editorBridge.ready || saving)
        }.padding(.vertical, 5).background(Palette.card)
            .overlay(alignment: .top) { Rectangle().fill(Palette.line).frame(height: 0.5) }

    }
    private func toolButton(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { DoompileSymbol(systemName: icon).frame(width: 44, height: 46).contentShape(Rectangle()) }.accessibilityLabel(label)
    }
    private func tool(_ icon: String, _ label: String, command: String) -> some View {
        toolButton(icon, label) { editorBridge.command(command) }
            .foregroundStyle(editorBridge.activeFormats.contains(command) ? Palette.accent : Palette.muted)
            .background(editorBridge.activeFormats.contains(command) ? Palette.limeSoft : .clear, in: RoundedRectangle(cornerRadius: 8))
    }
    private func handleAction(_ action: String) {
        switch EditorAction(rawValue: action) {
        case .file, .image: editorBridge.blur(); importer = true
        case .drawing: editorBridge.blur(); drawing = true
        case .voice: toggleRecording()
        case .stopVoice, .retryVoice:
            if recorder.recording || recorder.hasPendingRecording { finishRecording() }
        case .preferencesClosed, .expandCapture, .sendCapture: break
        case nil:
            if action.hasPrefix("openAttachment:"), let attachment = note.attachments.first(where: { $0.url == String(action.dropFirst("openAttachment:".count)) }) {
                Task { do { preview = try await AttachmentFiles.resolve(attachment) } catch { self.error = error.localizedDescription } }
            }
        }
    }
    private func addFile(_ data: Data, name: String, mime: String) throws {
        let attachment = try storeFile(data, name: name, mime: mime)
        editorBridge.insertAttachment(attachment)
    }
    private func storeFile(_ data: Data, name: String, mime: String) throws -> Attachment {
        guard library.isCurrentAccount else { throw DoompileError.authentication }
        guard data.count <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }
        guard note.attachments.count < NoteLimits.attachments else { throw DoompileError.message("В заметке уже \(NoteLimits.attachments) вложений.") }
        let attachment = try Storage.shared.addFile(data, name: name, mimeType: mime)
        note.attachments.append(attachment)
        if note.kind == "note" { note.kind = mime.hasPrefix("image/") ? "image" : mime.hasPrefix("audio/") ? "audio" : "file" }
        return attachment
    }
    private func toggleRecording() {
        if recorder.recording || recorder.hasPendingRecording {
            if capture == nil { finishRecording() }
            return
        }
        guard note.attachments.count < NoteLimits.attachments else {
            error = "В заметке уже \(NoteLimits.attachments) вложений."
            return
        }
        Task {
            do { try await recorder.start() } catch { self.error = error.localizedDescription }
        }
    }
    private func syncRecordingSnippet() {
        guard editorBridge.ready, let id = recorder.recordingID else { return }
        editorBridge.insertRecording(id)
        updateRecordingSnippet()
    }
    private func updateRecordingSnippet() {
        guard editorBridge.ready, let id = recorder.recordingID else { return }
        editorBridge.recordingState(id: id, seconds: Int(recorder.seconds), retry: recorder.hasPendingRecording)
    }
    private func finishRecording() {
        do {
            guard library.isCurrentAccount else { throw DoompileError.authentication }
            let (id, attachment) = try recorder.attachRecording(to: &note)
            editorBridge.completeRecording(id, attachment: attachment)
            if let capture { try capture.saveDraft(EditorLifecycle.prepared(note, plainText: text)) }
        } catch { self.error = error.localizedDescription }
    }
    private func refreshEditorState() async throws {
        guard editorBridge.ready else { return }
        let before = note.body
        let snapshot = try await editorBridge.snapshot()
        if note.body == before { note.body = snapshot.body; text = snapshot.plainText }
    }
    private func preserveCapture() async -> Bool {
        guard let capture, library.isCurrentAccount, !saving else { return false }
        saving = true
        defer { saving = false }
        do {
            try await refreshEditorState()
            try capture.saveDraft(EditorLifecycle.prepared(note, plainText: text))
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private func persistForLink() async -> Bool {
        guard library.isCurrentAccount else { return false }
        guard !saving, !recorder.starting else { return false }
        saving = true
        defer { saving = false }
        do {
            autosaveTask?.cancel()
            try await refreshEditorState()
            if recorder.recording || recorder.hasPendingRecording {
                finishRecording()
                if recorder.recording || recorder.hasPendingRecording { return false }
            }
            guard library.isCurrentAccount else { return false }
            note = EditorLifecycle.prepared(note, plainText: text)
            if capture != nil {
                guard onSave(note) else {
                    error = "Не удалось сохранить на устройстве. Редактор остаётся открыт — попробуй ещё раз."
                    return false
                }
                captureSent = true
                return true
            }
            let existing = library.notes.contains { $0.id == note.id }
            if !EditorLifecycle.shouldSave(note, existing: existing) { EditorDrafts.clear(note.id); return true }
            try EditorDrafts.save(note)
            if onSave(note) { recordSaved(note); EditorDrafts.clear(note.id); return true }
            error = "Не удалось сохранить на устройстве. Редактор остаётся открыт — попробуй ещё раз."
        } catch { self.error = error.localizedDescription }
        return false
    }
    private func recordSaved(_ value: Note) {
        let stored = library.notes.first(where: { $0.id == value.id }) ?? value
        var current = EditorLifecycle.prepared(note, plainText: text)
        current.revision = stored.revision
        current.updatedAt = stored.updatedAt
        note = current
        lastSaved = stored
    }
    private func scheduleAutosave() {
        autosaveTask?.cancel()
        autosaveTask = Task { @MainActor in
            try? await Task.sleep(for: EditorLifecycle.autosaveDelay)
            guard !Task.isCancelled else { return }
            saveKnownState()
        }
    }
    private func saveKnownState() {
        guard library.isCurrentAccount else { return }
        guard !saving, !captureSent else { return }
        let value = EditorLifecycle.prepared(note, plainText: text)
        if let capture {
            guard value != lastSaved, recorder.recordingID != nil || EditorLifecycle.shouldSave(value, existing: false) || lastSaved != nil else { return }
            do { try capture.saveDraft(value); lastSaved = value } catch { self.error = error.localizedDescription }
            return
        }
        guard !recorder.recording, !recorder.starting, !recorder.hasPendingRecording else { return }
        guard value != lastSaved, EditorLifecycle.shouldSave(value, existing: library.notes.contains { $0.id == note.id }) else { return }
        do {
            try EditorDrafts.save(value)
            if onSave(value) { recordSaved(value); EditorDrafts.clear(value.id) }
            else { error = "Не удалось сохранить заметку. Черновик остаётся на устройстве." }
        } catch { self.error = error.localizedDescription }
    }
    private func save() {
        Task { if await persistForLink() { dismiss() } }
    }

}

struct NoteTagsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var tags: [String]
    let available: [String]
    @State private var query = ""
    @State private var created: [String] = []
    @FocusState private var searching: Bool
    private var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "#")) }
    private var catalog: [String] { Array(Set(available + created + tags)).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending } }
    private var matches: [String] { catalog.filter { term.isEmpty || $0.localizedCaseInsensitiveContains(term) } }
    private var exact: String? { catalog.first { $0.localizedCaseInsensitiveCompare(term) == .orderedSame } }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Теги").font(.system(size: 20, weight: .semibold))
                Spacer()
                Button("Готово") { dismiss() }.accessibilityIdentifier("editor-tags-done").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.accent)
            }.padding(.top, 8)
            HStack(spacing: 8) {
                DoompileSymbol(systemName: "magnifyingglass").foregroundStyle(Palette.muted)
                TextField("Найти или создать тег", text: $query)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().focused($searching)
                    .submitLabel(.done).onSubmit(addQuery).accessibilityIdentifier("editor-tag-search")
                if !query.isEmpty { Button { query = "" } label: { DoompileSymbol(systemName: "xmark.circle.fill").foregroundStyle(Palette.muted) }.accessibilityLabel("Очистить поиск тегов") }
            }.font(.system(size: 16)).padding(12).background(Palette.card, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.line))
            if !tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tags, id: \.self) { tag in
                            Button { toggle(tag) } label: {
                                HStack(spacing: 7) { Text("#" + tag); DoompileSymbol(systemName: "xmark", size: 9).font(.system(size: 9, weight: .semibold)) }
                                    .font(.system(size: 13)).padding(.horizontal, 11).padding(.vertical, 8)
                                    .foregroundStyle(Palette.text).background(Palette.limeSoft, in: Capsule())
                            }.buttonStyle(.plain).accessibilityLabel("Убрать тег " + tag)
                        }
                    }
                }.accessibilityIdentifier("selected-editor-tags")
            }
            ScrollView {
                LazyVStack(spacing: 2) {
                    if !term.isEmpty && exact == nil {
                        Button(action: addQuery) {
                            HStack(spacing: 10) { DoompileSymbol(systemName: "plus"); Text("Создать «\(term)»").lineLimit(2); Spacer() }
                                .foregroundStyle(Palette.accent).padding(.vertical, 14).padding(.horizontal, 8)
                        }.disabled(term.utf16.count > 100 || tags.count >= 100).accessibilityIdentifier("editor-create-tag")
                    }
                    ForEach(matches, id: \.self) { tag in
                        Button { toggle(tag); query = "" } label: {
                            HStack(spacing: 10) {
                                Text("#").foregroundStyle(Palette.muted); Text(tag).lineLimit(2)
                                Spacer(); DoompileSymbol(systemName: tags.contains(tag) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(tags.contains(tag) ? Palette.accent : Palette.line)
                            }.padding(.vertical, 13).padding(.horizontal, 8).contentShape(Rectangle())
                        }.buttonStyle(.plain).foregroundStyle(Palette.text).accessibilityLabel("Тег " + tag)
                            .accessibilityValue(tags.contains(tag) ? "Выбран" : "Не выбран")
                    }
                    if catalog.isEmpty && term.isEmpty {
                        Text("Введи название и нажми «Создать».\nТеги помогут найти заметку позже.")
                            .font(.system(size: 14)).foregroundStyle(Palette.muted).lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16)
                    }
                }
            }.scrollDismissesKeyboard(.interactively)
        }.padding(20).background(Palette.ink).foregroundStyle(Palette.text)
            .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
    private func toggle(_ tag: String) {
        if tags.contains(tag) { tags.removeAll { $0 == tag } }
        else if tags.count < 100 { tags.append(tag); tags.sort() }
    }
    private func addQuery() {
        guard !term.isEmpty, term.utf16.count <= 100, tags.count < 100 else { return }
        let tag = exact ?? term
        guard TagCatalog.create(tag) else { return }
        if !created.contains(tag) { created.append(tag) }
        if !tags.contains(tag) { tags.append(tag); tags.sort() }
        query = ""
        searching = true
    }
}

@MainActor final class VoiceRecorder: NSObject, ObservableObject {
    @Published private(set) var recording = false
    @Published private(set) var starting = false
    @Published private(set) var seconds: Double = 0
    @Published private(set) var recordingID: String?
    @Published private var pendingURL: URL?
    var hasPendingRecording: Bool { pendingURL != nil }
    var elapsed: TimeInterval { recorder?.currentTime ?? seconds }
    private var recorder: AVAudioRecorder?
    private var ticker: Task<Void, Never>?
    private var attempt = UUID()

    func start() async throws {
        guard !recording && !starting && !hasPendingRecording else { return }
        let request = UUID()
        attempt = request
        starting = true
        defer { if attempt == request { starting = false } }
        let granted = await AVAudioApplication.requestRecordPermission()
        // Dismissing while the permission dialog is open must not start a hidden recording.
        guard attempt == request else { return }
        guard granted else { throw DoompileError.message("Разреши доступ к микрофону в настройках iPhone, чтобы записать голосовую заметку.") }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
        do {
            let audio = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
            guard audio.record() else { throw DoompileError.message("Не удалось начать запись.") }
            recorder = audio
            seconds = 0
            recordingID = UUID().uuidString.lowercased()
            recording = true
            Telemetry.shared.record(.recordingStarted)
            ticker = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled, let self, self.recording else { return }
                    self.seconds = self.recorder?.currentTime ?? self.seconds
                }
            }
        } catch {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            Telemetry.shared.failure(.recordingFailed, error)
            throw error
        }
    }
    func attachRecording(to note: inout Note) throws -> (String, Attachment) {
        guard let id = recordingID else { throw DoompileError.message("Запись ещё не началась.") }
        let url: URL
        if let pendingURL { url = pendingURL }
        else { url = try stop(); pendingURL = url }
        guard note.attachments.count < NoteLimits.attachments else {
            throw DoompileError.message("В заметке уже \(NoteLimits.attachments) вложений.")
        }
        let data = try Data(contentsOf: url)
        guard data.count <= 30 * 1024 * 1024 else { throw DoompileError.message("Максимальный размер вложения — 30 МБ.") }
        let attachment = try Storage.shared.addFile(data, name: "Голосовая заметка.m4a", mimeType: "audio/mp4")
        note.attachments.append(attachment)
        note.body = note.body.finishingRecording(id, attachment: attachment)
        if note.kind == "note" { note.kind = "audio" }
        recordingID = nil
        pendingURL = nil
        try? FileManager.default.removeItem(at: url)
        return (id, attachment)
    }
    private func stop() throws -> URL {
        guard let recorder, recording else { throw DoompileError.message("Запись ещё не началась.") }
        seconds = recorder.currentTime
        recorder.stop()
        recording = false
        ticker?.cancel(); ticker = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        self.recorder = nil
        Telemetry.shared.record(.recordingCompleted, ["duration_ms": seconds * 1000])
        return recorder.url
    }
    func cancel() {
        attempt = UUID(); starting = false
        ticker?.cancel(); ticker = nil
        if let recorder {
            recorder.stop()
            try? FileManager.default.removeItem(at: recorder.url)
        }
        if let pendingURL { try? FileManager.default.removeItem(at: pendingURL) }
        pendingURL = nil
        recordingID = nil
        recorder = nil
        if recording { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        recording = false; seconds = 0
    }
}

struct DrawingCanvas: UIViewRepresentable {
    @Binding var canvas: PKCanvasView
    func makeUIView(context: Context) -> PKCanvasView { canvas.drawingPolicy = .anyInput; canvas.backgroundColor = .white; canvas.tool = PKInkingTool(.pen, color: .black, width: 3); return canvas }
    func updateUIView(_ uiView: PKCanvasView, context: Context) {}
}
struct DrawingView: View {
    @Environment(\.dismiss) var dismiss
    @State private var canvas = PKCanvasView()
    let save: (Data) -> Void
    var body: some View {
        NavigationStack {
            DrawingCanvas(canvas: $canvas).ignoresSafeArea(edges: .bottom).navigationTitle("Sketch a thought").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Добавить") {
                        let bounds = canvas.drawing.bounds.insetBy(dx: -25, dy: -25)
                        if !bounds.isEmpty, !bounds.isInfinite, let data = canvas.drawing.image(from: bounds, scale: 2).pngData() { save(data) }
                        dismiss()
                    } }
                }
        }
    }
}

struct EditorCommandSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var document = JSONValue.document("")
    @State private var text = ""
    @State private var height: CGFloat = 600
    @State private var attachments: [Attachment] = []
    @StateObject private var bridge = RichEditorBridge()
    var body: some View {
        NavigationStack {
            RichEditorView(document: $document, plainText: $text, height: $height, attachments: $attachments, notes: [], bridge: bridge, onReference: { _ in }, onRequestLink: { _ in }, onAction: { action in if action == "preferencesClosed" { dismiss() } }, openPreferencesOnLoad: true)
                .navigationTitle("Команды редактора").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
        }
    }
}

struct SettingsView: View {
    @AppStorage(AppearanceMode.storageKey, store: Connection.defaults) private var appearance: AppearanceMode = .system
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var library: Library
    @State private var editorCommands = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Внешний вид") {
                    Picker("Тема", selection: $appearance) {
                        ForEach(AppearanceMode.allCases) { mode in Text(mode.title).tag(mode) }
                    }.pickerStyle(.segmented).accessibilityIdentifier("appearance-picker")
                }
                Section("Редактор") { Button("Команды и алиасы редактора") { editorCommands = true } }
                Section("Аккаунт") { AccountSettingsView() }
                Section("Диагностика") { DiagnosticsView() }
                Section("Сохранение из других приложений") {
                    Text("Включи Doompile в Настройки → Приложения → Safari → Расширения. Открой расширение, чтобы сохранить страницу или выделенный текст.")
                    Text("В YouTube и других приложениях выбери Поделиться → Doompile. Если ссылка содержит таймкод, он сохранится. Его также можно добавить вручную.")
                }.font(.system(size: 14))
                Section("На этом устройстве") {
                    LabeledContent("Заметок на устройстве", value: String(library.notes.count))
                    LabeledContent("Ожидают синхронизации", value: String(library.pending))
                    Text("Заметки сохраняются на устройстве, в том числе без сети. Ожидающие отправки изменения синхронизируются при открытии приложения. Дождись отправки перед удалением приложения.").font(.footnote).foregroundStyle(.secondary)
                }
                Section { Text(BrandCopy.tagline).font(.footnote).foregroundStyle(.secondary) }
            }.navigationTitle("Настройки").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
                .sheet(isPresented: $editorCommands) { EditorCommandSettingsView() }
        }.preferredColorScheme(appearance.colorScheme)
    }
}
