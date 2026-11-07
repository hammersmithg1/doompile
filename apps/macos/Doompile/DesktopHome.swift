import SwiftUI
import AppKit

struct DesktopHome: View {
    @EnvironmentObject private var library: DesktopLibrary
    @Environment(\.scenePhase) private var phase
    @Environment(\.controlActiveState) private var activeState
    @Environment(\.undoManager) private var undoManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var quick = MacMainComposer()
    @AppStorage("mac-detail-width") private var detailWidth = 440.0
    @State private var filter = "all"
    @State private var query = ""
    @State private var selected: Note?
    @State private var noteExpanded = false
    @State private var quickFocused = true
    @State private var quickHeight: CGFloat = 39
    @State private var quickFiles = false
    @State private var composerToken = UUID()
    @State private var dragWidth: CGFloat?
    @State private var collapsed: Set<String> = []
    @State private var newTag = ""
    @State private var tagPopover = false
    @State private var navigationError: String?
    @State private var initialAction: String?
    @State private var navigationRequest = UUID()
    @FocusState private var searchFocused: Bool

    private var motion: Animation? { reduceMotion ? nil : .easeInOut(duration: 0.18) }
    private var filtered: [Note] {
        library.notes.filter { note in
            let matches = filter == "all" || (filter == "urgent" && note.urgent) || (filter == "pinned" && note.pinned) || (filter == "media" && (!note.attachments.isEmpty || ["audio", "image", "video", "file"].contains(note.kind))) || (filter.hasPrefix("tag:") && note.tags.contains(String(filter.dropFirst(4))))
            let haystack = "\(note.title) \(note.plainText) \(note.source?.quote ?? "") \(note.source?.articleText ?? "") \(note.tags.joined(separator: " "))"
            return matches && (query.isEmpty || haystack.localizedCaseInsensitiveContains(query))
        }
    }
    private var title: String { ["all": "Все заметки", "urgent": "Важное", "pinned": "Закреплённое", "media": "Медиа"][filter] ?? String(filter.dropFirst(4)) }

    var body: some View {
        GeometryReader { geometry in
            let inspectorWidth = noteExpanded ? geometry.size.width : min(CGFloat(detailWidth), max(280, geometry.size.width - 558))
            HStack(spacing: 0) {
                HStack(spacing: 0) {
                    sidebar.frame(width: 250)
                    Rectangle().fill(MacPalette.line).frame(width: 1)
                    feed.frame(maxWidth: .infinity)
                }
                .frame(width: noteExpanded ? 0 : geometry.size.width - (selected == nil ? 0 : inspectorWidth), height: geometry.size.height)
                .clipped().opacity(noteExpanded ? 0 : 1).allowsHitTesting(!noteExpanded).accessibilityHidden(noteExpanded)
                if let selected {
                    NoteWorkspace(initial: selected, existing: library.notes.contains { $0.id == selected.id }, expanded: noteExpanded, onExpand: { withAnimation(motion) { noteExpanded.toggle() } }, onSelect: { open($0) }, onClose: close, initialAction: initialAction)
                        .id(selected.id)
                        .frame(width: inspectorWidth, height: geometry.size.height)
                        .overlay(alignment: .leading) { if !noteExpanded { resizeHandle(total: geometry.size.width) } }
                        .transition(.move(edge: noteExpanded ? .bottom : .trailing).combined(with: .opacity))
                }
            }.frame(width: geometry.size.width, height: geometry.size.height)
        }
        .background(MacPalette.background).foregroundStyle(MacPalette.text)
        .onReceive(NotificationCenter.default.publisher(for: .doompileNewNote)) { _ in if activeState == .key { compose() } }
        .onReceive(NotificationCenter.default.publisher(for: .doompileSearch)) { _ in if activeState == .key { withAnimation(motion) { noteExpanded = false }; searchFocused = true } }
        .onReceive(NotificationCenter.default.publisher(for: .doompileSave)) { _ in
            if activeState == .key { if quickFocused || selected == nil { saveQuick() } else { NotificationCenter.default.post(name: .doompileSaveWorkspace, object: nil) } }
        }
        .onChange(of: phase) { _, value in if value == .active { library.reload(); Task { await library.sync() } } }
        .onChange(of: selected?.id) { _, id in if let id, library.notes.contains(where: { $0.id == id }) { Telemetry.shared.record(.noteOpened, ["note_id": id]) } }
        .onChange(of: filter) { _, value in Telemetry.shared.record(.screenViewed, ["screen": "feed", "filter": value.hasPrefix("tag:") ? "tag" : value == "media" ? "files" : value]) }
        .task(id: query) {
            guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(800))
            if !Task.isCancelled { Telemetry.shared.record(.searchPerformed, ["query_length": query.utf16.count, "results": filtered.count]) }
        }
        .onAppear { NoteLinkEditors.register(composerToken) { do { try quick.persist(); return true } catch { quick.error = error.localizedDescription; return false } } }
        .onDisappear { NoteLinkEditors.unregister(composerToken); quick.finishAndPersist() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in quick.finishAndPersist() }
        .fileImporter(isPresented: $quickFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do { for url in try result.get() { try quick.addFile(url) } } catch { quick.error = error.localizedDescription }
        }
        .onOpenURL(perform: handleLink)
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { if let url = $0.webpageURL { handleLink(url) } }
        .alert("Не удалось открыть заметку", isPresented: Binding(get: { navigationError != nil }, set: { if !$0 { navigationError = nil } })) { Button("Понятно", role: .cancel) {} } message: { Text(navigationError ?? "") }
        .task {
            quickFocused = true
            await library.sync()
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 2) {
                DoompileWordmark(height: 29)
                DoompileHalo(width: 34)
            }.padding(.horizontal, 12).padding(.top, 38)
            Text(BrandCopy.motto).font(.system(size: 12)).foregroundStyle(MacPalette.muted).padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 29)
            HStack(spacing: 8) {
                DoompileSymbol(systemName: "magnifyingglass", size: 11).font(.system(size: 11))
                TextField("Найти в куче…", text: $query).textFieldStyle(.plain).focused($searchFocused).accessibilityLabel("Поиск заметок")
                if query.isEmpty { Text("⌘ K").font(.system(size: 9)).fixedSize() }
                else { Button { query = "" } label: { DoompileSymbol(systemName: "xmark.circle.fill") }.buttonStyle(.plain).accessibilityLabel("Очистить поиск") }
            }.font(.system(size: 12)).foregroundStyle(MacPalette.muted).padding(.horizontal, 10).frame(height: 34).background(MacPalette.tool.opacity(0.85), in: RoundedRectangle(cornerRadius: 7)).padding(.bottom, 22)
            VStack(spacing: 4) {
                navigation("all", title: "Все заметки", icon: "square.3.layers.3d", count: library.notes.count)
                navigation("urgent", title: "Важное", icon: "flame", count: library.notes.filter(\.urgent).count)
                navigation("pinned", title: "Закреплённое", icon: "pin", count: library.notes.filter(\.pinned).count)
                navigation("media", title: "Медиа", icon: "photo", count: library.notes.filter { !$0.attachments.isEmpty || ["audio", "image", "video", "file"].contains($0.kind) }.count)
            }
            HStack {
                Text("ТЕГИ").font(.system(size: 9, weight: .medium)).tracking(1.7)
                Spacer()
                Button { tagPopover = true } label: { DoompileSymbol(systemName: "plus", size: 13).font(.system(size: 13)) }.buttonStyle(.plain).help("Новый тег").accessibilityLabel("Новый тег")
                    .popover(isPresented: $tagPopover) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Новый тег").font(.headline)
                            TextField("Например, Идеи", text: $newTag).textFieldStyle(.roundedBorder).onSubmit(createTag)
                            Text("У заметки может быть несколько тегов.").font(.caption).foregroundStyle(.secondary)
                            Button("Создать тег", action: createTag).buttonStyle(.borderedProminent).disabled(newTag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }.padding(18).frame(width: 280)
                    }
            }.foregroundStyle(MacPalette.muted).padding(.horizontal, 12).padding(.top, 29).padding(.bottom, 14)
            ScrollView {
                VStack(spacing: 3) {
                    ForEach(library.tags, id: \.self) { tag in navigation("tag:" + tag, title: tag, icon: "tag", count: library.notes.filter { $0.tags.contains(tag) }.count) }
                    if library.tags.isEmpty { Text("Теги появятся здесь.").font(.system(size: 11)).foregroundStyle(MacPalette.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.top, 5) }
                }
            }
            if EditorDrafts.last() != nil {
                Button { if let draft = EditorDrafts.last() { open(draft) } } label: { DoompileLabel("Продолжить черновик", systemImage: "pencil.line").font(.system(size: 11)) }.buttonStyle(.plain).foregroundStyle(MacPalette.muted).padding(12)
            }
            HStack(alignment: .center, spacing: 12) {
                Image("dp-cat").resizable().aspectRatio(contentMode: .fit).frame(width: 75, height: 95).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 7) {
                    Text(BrandCopy.cat).font(.system(size: 12, weight: .semibold)).lineSpacing(3)
                    Text(BrandCopy.aside).font(.system(size: 10)).foregroundStyle(MacPalette.muted).lineSpacing(3)
                }
                Spacer(minLength: 0)
            }.padding(18).frame(maxWidth: .infinity, minHeight: 138).background(MacPalette.adaptive(0xF3EFE6, 0x202022), in: RoundedRectangle(cornerRadius: 12))
            HStack {
                SettingsLink { DoompileLabel("Настройки", systemImage: "gearshape").font(.system(size: 11)) }.buttonStyle(.plain)
                Spacer()
                Button { Task { await library.sync() } } label: { DoompileSymbol(systemName: library.syncing ? "arrow.triangle.2.circlepath" : library.error != nil ? "icloud.slash" : "checkmark.icloud", size: 12).font(.system(size: 12)) }.buttonStyle(.plain).help(library.error ?? (library.pending > 0 ? "\(library.pending) ждут синхронизации" : "Всё сохранено"))
            }.foregroundStyle(MacPalette.muted).padding(.horizontal, 10).padding(.top, 19).padding(.bottom, 16)
        }.padding(.horizontal, 18).background(LinearGradient(colors: [MacPalette.sidebar, MacPalette.background], startPoint: .topLeading, endPoint: .bottomTrailing))
    }
    private func navigation(_ value: String, title: String, icon: String, count: Int) -> some View {
        Button { filter = value; query = "" } label: {
            HStack(spacing: 10) {
                DoompileSymbol(systemName: icon, size: 15).font(.system(size: 15)).frame(width: 18).foregroundStyle(value == "urgent" ? MacPalette.orange : MacPalette.text)
                Text(title); Spacer(); Text(String(count)).font(.system(size: 11)).foregroundStyle(MacPalette.muted)
            }.font(.system(size: 13)).padding(.horizontal, 12).frame(height: 37).background(filter == value ? MacPalette.softLime : .clear, in: RoundedRectangle(cornerRadius: 7))
        }.buttonStyle(.plain)
    }

    private var feed: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if filter != "all" || !query.isEmpty { Text(query.isEmpty ? title : "Поиск: \(query)").font(.system(size: 13, weight: .semibold)).padding(.bottom, 17) }
                    let urgent = filtered.filter(\.urgent)
                    if !urgent.isEmpty {
                        sectionHeading("urgent", title: "Важно", count: urgent.count, icon: "flame")
                        if !collapsed.contains("urgent") {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160, maximum: 240), spacing: 8)], alignment: .leading, spacing: 8) {
                                ForEach(urgent) { note in MacUrgentCard(note: note, selected: selected?.id == note.id, open: { open(note) }, removeUrgent: { Task { if await prepareNavigation() { library.toggle(note, urgent: true) } } }).contextMenu { noteMenu(note) } }
                            }.padding(.bottom, 22)
                        }
                    }
                    ForEach(MacFeedSection.make(filtered)) { group in
                        sectionHeading(group.id, title: group.title, count: group.notes.count, icon: group.id == "pinned" ? "pin" : nil)
                        if !collapsed.contains(group.id) {
                            ForEach(group.notes) { note in
                                MacFeedRow(note: note, selected: selected?.id == note.id, open: { open(note) }, menu: { AnyView(Group { noteMenu(note) }) })
                                    .contextMenu { noteMenu(note) }
                            }
                        }
                    }
                    if filtered.isEmpty { emptyState }
                }.padding(.horizontal, 26).padding(.top, 23).padding(.bottom, 18)
            }.accessibilityLabel("Лента заметок")
            composer
        }
    }
    private func sectionHeading(_ id: String, title: String, count: Int, icon: String?) -> some View {
        Button { withAnimation(motion) { if !collapsed.insert(id).inserted { collapsed.remove(id) } } } label: {
            HStack(spacing: 7) {
                DoompileSymbol(systemName: "chevron.right", size: 8).font(.system(size: 8)).rotationEffect(.degrees(collapsed.contains(id) ? 0 : 90)).foregroundStyle(MacPalette.muted)
                if let icon { DoompileSymbol(systemName: icon, size: 12).font(.system(size: 12)).foregroundStyle(id == "urgent" ? MacPalette.orange : MacPalette.muted) }
                Text(title).font(.system(size: 12, weight: .semibold))
                Text(String(count)).font(.system(size: 9)).foregroundStyle(MacPalette.muted).padding(.horizontal, 4).background(MacPalette.tool, in: RoundedRectangle(cornerRadius: 3))
                Spacer()
            }.padding(.top, 5).padding(.bottom, 10).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel("\(title), \(count)").accessibilityValue(collapsed.contains(id) ? "Свёрнуто" : "Развёрнуто")
    }
    private var composer: some View {
        VStack(spacing: 7) {
            if let error = quick.error { Text(error).font(.system(size: 11)).foregroundStyle(MacPalette.orange).textSelection(.enabled) }
            if quick.voice.recording || quick.startingVoice {
                HStack(spacing: 8) { Circle().fill(MacPalette.orange).frame(width: 6, height: 6); Text(quick.startingVoice ? "Включаем микрофон…" : "Запись \(Note.timeLabel(Double(quick.voice.seconds)))").font(.system(size: 11)); Spacer(); if quick.voice.recording { Button("■ Стоп") { Task { await quick.toggleVoice() } }.buttonStyle(.plain).font(.system(size: 11)) } }.foregroundStyle(MacPalette.orange).padding(.horizontal, 10).padding(.vertical, 7)
            }
            if !quick.note.attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(quick.note.attachments) { file in
                            HStack(alignment: .top, spacing: 3) { MacAttachmentCard(attachment: file); Button { quick.removeFile(file.id) } label: { DoompileSymbol(systemName: "xmark.circle.fill", size: 12).font(.system(size: 12)).foregroundStyle(MacPalette.muted) }.buttonStyle(.plain).help("Убрать вложение") }
                        }
                    }
                }.frame(maxHeight: 165)
            }
            HStack(alignment: .bottom, spacing: 5) {
                MacQuickInput(text: Binding(get: { quick.note.plainText }, set: quick.updateText), height: $quickHeight, focused: $quickFocused, onSubmit: saveQuick).frame(height: quickHeight).padding(.leading, 8)
                MacComposerButton(icon: quick.voice.recording ? "stop.fill" : "mic", label: quick.voice.recording ? "Остановить запись" : "Записать голосовую заметку", disabled: quick.startingVoice) { Task { await quick.toggleVoice() } }
                MacComposerButton(icon: "paperclip", label: "Прикрепить файл") { quickFiles = true }
                MacComposerButton(icon: "arrow.up.left.and.arrow.down.right", label: "Развернуть редактор") { compose() }
                MacComposerButton(icon: "arrow.up", label: "Сохранить заметку", send: true, disabled: quick.startingVoice || (!quick.voice.recording && !MacPreview.hasContent(quick.note)), action: saveQuick)
            }.padding(6).background(MacPalette.surface, in: RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(quickFocused ? MacPalette.adaptive(0xC9C5C0, 0x69646F) : MacPalette.line)).shadow(color: .black.opacity(0.025), radius: 6, y: 2)
        }.padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 12)
    }
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 17) {
            Image("dp-void").resizable().aspectRatio(contentMode: .fit).frame(width: 160, height: 160).accessibilityHidden(true)
            Text(library.notes.isEmpty ? BrandCopy.motto : query.isEmpty ? "Здесь пока тихо." : UICopy.searchEmpty).font(.system(size: 29, weight: .bold)).tracking(-0.8)
            Text(library.notes.isEmpty ? UICopy.emptyBody : UICopy.searchHint).font(.system(size: 12)).foregroundStyle(MacPalette.muted).lineSpacing(6)
            Button { quickFocused = true } label: { DoompileLabel("Сохранить первую находку", systemImage: "plus").font(.system(size: 12, weight: .medium)).padding(.horizontal, 14).padding(.vertical, 10).foregroundStyle(Color.black).background(MacPalette.send, in: RoundedRectangle(cornerRadius: 8)) }.buttonStyle(.plain)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 55)
    }
    private func resizeHandle(total: CGFloat) -> some View {
        Rectangle().fill(MacPalette.line).frame(width: 1).frame(width: 8).contentShape(Rectangle())
            .onHover { if $0 { NSCursor.resizeLeftRight.set() } else { NSCursor.arrow.set() } }
            .gesture(DragGesture(minimumDistance: 1).onChanged { value in
                if dragWidth == nil { dragWidth = detailWidth }
                detailWidth = max(280, min(total - 558, (dragWidth ?? detailWidth) - value.translation.width))
            }.onEnded { _ in dragWidth = nil })
            .accessibilityLabel("Ширина заметки").accessibilityValue("\(Int(detailWidth))")
            .accessibilityAdjustableAction { direction in detailWidth = max(280, min(total - 558, detailWidth + (direction == .increment ? 24 : -24))) }
    }
    @ViewBuilder private func noteMenu(_ note: Note) -> some View {
        if let url = NoteLinks.shareURL(id: note.id) { Button("Скопировать ссылку") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(url.absoluteString, forType: .string) } }
        Button(note.pinned ? "Открепить" : "Закрепить") { Task { if await prepareNavigation() { library.toggle(note) } } }
        Button(note.urgent ? "Убрать из важного" : "Сделать важной") { Task { if await prepareNavigation() { library.toggle(note, urgent: true) } } }
        Divider()
        Button("Удалить", role: .destructive) {
            Task { @MainActor in
                guard await prepareNavigation() else { return }
                let latest = library.notes.first { $0.id == note.id } ?? note
                library.remove(latest)
                if selected?.id == note.id { close() }
                undoManager?.registerUndo(withTarget: library) { target in Task { @MainActor in var restored = latest; restored.revision = (try? Storage.shared.snapshot().notes[note.id]?.revision) ?? latest.revision; restored.deletedAt = nil; _ = target.save(restored) } }
                undoManager?.setActionName("Удалить заметку")
            }
        }
    }
    private func prepareNavigation() async -> Bool {
        guard await NoteLinkEditors.prepare() else { navigationError = "Не удалось сохранить текущую заметку. Проверь сообщение в редакторе."; return false }
        return true
    }
    private func open(_ note: Note) {
        guard selected?.id != note.id else { return }
        let request = UUID(); navigationRequest = request
        Task { @MainActor in
            guard await prepareNavigation(), navigationRequest == request else { return }
            let latest = library.notes.first { $0.id == note.id } ?? note
            initialAction = nil; quickFocused = false
            withAnimation(motion) { selected = EditorDrafts.load(latest) }
        }
    }
    private func compose(action: String? = nil) {
        let request = UUID(); navigationRequest = request
        Task { @MainActor in
            guard await prepareNavigation(), navigationRequest == request else { return }
            var note: Note
            do { note = try quick.takeNote() } catch { quick.error = error.localizedDescription; return }
            if !MacPreview.hasContent(note) { note.createdAt = Note.now() }
            if filter.hasPrefix("tag:") { note.tags = [String(filter.dropFirst(4))] }
            do { if MacPreview.hasContent(note) { try EditorDrafts.save(note) } }
            catch { navigationError = error.localizedDescription; return }
            do { try quick.clear() } catch { quick.error = error.localizedDescription; return }
            initialAction = action; quickFocused = false
            withAnimation(motion) { selected = note; noteExpanded = true }
        }
    }
    private func close() { withAnimation(motion) { selected = nil; noteExpanded = false }; quickFocused = true }
    private func saveQuick() {
        do {
            var note = try quick.takeNote()
            guard MacPreview.hasContent(note) else { return }
            if filter.hasPrefix("tag:") { note.tags = [String(filter.dropFirst(4))] }
            if library.save(note) != nil { try quick.clear(); quickHeight = 39; quickFocused = true }
        } catch { quick.error = error.localizedDescription }
    }
    private func createTag() {
        let tag = newTag.trimmingCharacters(in: .whitespacesAndNewlines)
        guard TagCatalog.create(tag) else { return }
        library.reload(); filter = "tag:" + tag; newTag = ""; tagPopover = false
    }
    private func handleLink(_ url: URL) {
        if url.scheme == "doompile", ["compose", "quick-note"].contains(url.host ?? "") { compose(); return }
        guard let id = NoteLinks.noteID(in: url, allowedOrigins: NoteLinks.acceptedOrigins) else { return }
        Task { @MainActor in
            guard await prepareNavigation() else { return }
            library.reload()
            if !library.notes.contains(where: { $0.id == id }) { await library.sync() }
            if let note = library.notes.first(where: { $0.id == id }) { open(note) }
            else { navigationError = library.error ?? "Заметка не найдена или удалена." }
        }
    }
}
