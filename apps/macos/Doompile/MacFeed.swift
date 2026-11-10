import SwiftUI
import AppKit
import AVKit

struct MacUrgentCard: View {
    let note: Note
    let selected: Bool
    var open: () -> Void
    var removeUrgent: () -> Void
    @EnvironmentObject private var library: DesktopLibrary
    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Button(action: open) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(note.displayTitle).font(.system(size: 12, weight: .medium)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                    if let file = note.attachments.first(where: { $0.url.hasPrefix("local:") }) {
                        AttachmentTransferBadge(state: library.uploadStates[file.id] ?? .queued)
                    } else {
                        Text(note.tags.first ?? "В твоей куче").font(.system(size: 9)).foregroundStyle(MacPalette.adaptive(0xA27678, 0xC2979B))
                    }
                }.frame(maxWidth: .infinity, minHeight: 40, alignment: .topLeading).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Button(action: removeUrgent) { DoompileSymbol(systemName: "flame", size: 11).font(.system(size: 11)).foregroundStyle(MacPalette.orange) }.buttonStyle(.plain).help("Убрать из важного").accessibilityLabel("Убрать из важного \(note.displayTitle)")
        }.padding(.horizontal, 12).padding(.vertical, 10).background(MacPalette.urgent, in: RoundedRectangle(cornerRadius: 9)).overlay(RoundedRectangle(cornerRadius: 9).stroke(selected ? MacPalette.orange.opacity(0.35) : .clear))
    }
}

struct MacFeedRow: View {
    let note: Note
    @EnvironmentObject private var library: DesktopLibrary
    var selected: Bool
    var open: () -> Void
    var menu: () -> AnyView
    @State private var hovered = false
    private var excerpt: String { MacPreview.text(for: note) }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 7) {
                if let source = note.editorSource { CapturedSnippet(source: source, onOpen: open) }
                if !excerpt.isEmpty { Text(excerpt).font(.system(size: 13)).lineSpacing(4).lineLimit(8).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle()).onTapGesture(perform: open) }
                if excerpt.isEmpty && note.attachments.isEmpty && note.editorSource == nil { Text(note.displayTitle).font(.system(size: 13)).onTapGesture(perform: open) }
                if !note.attachments.isEmpty {
                    ForEach(Array(note.attachments.prefix(3))) { attachment in
                        MacAttachmentCard(attachment: attachment, transfer: attachment.url.hasPrefix("local:") ? library.uploadStates[attachment.id] ?? .queued : nil)
                    }
                    if note.attachments.count > 3 { Text("Ещё \(note.attachments.count - 3) вложений").font(.system(size: 10)).foregroundStyle(MacPalette.muted) }
                }
                if !note.attachments.isEmpty {
                    Button(action: open) {
                        HStack { Spacer(); Text(MacDates.timeLabel(note.createdAt)).font(.system(size: 9)).foregroundStyle(MacPalette.muted) }
                            .frame(maxWidth: .infinity, minHeight: 18).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel("Открыть заметку")
                }
                if !note.tags.isEmpty { Text(note.tags.map { "# " + $0 }.joined(separator: "   ")).font(.system(size: 10)).foregroundStyle(MacPalette.muted).lineLimit(2) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Text(MacDates.timeLabel(note.createdAt)).font(.system(size: 9)).monospacedDigit().foregroundStyle(MacPalette.muted).padding(.top, 3).onTapGesture(perform: open)
            Menu(content: menu) { DoompileSymbol(systemName: "ellipsis", size: 12).font(.system(size: 12)).frame(width: 17, height: 21) }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().opacity(hovered || selected ? 1 : 0.15).help("Меню заметки").accessibilityLabel("Меню заметки \(note.displayTitle)")
        }.padding(.horizontal, 8).padding(.vertical, 11)
            .background(selected ? MacPalette.adaptive(0xE9E6E2, 0x262528) : hovered ? MacPalette.tool.opacity(0.45) : .clear, in: RoundedRectangle(cornerRadius: 6))
            .overlay(alignment: .bottom) { Rectangle().fill(MacPalette.line.opacity(0.45)).frame(height: 0.5) }
            .padding(.horizontal, -8).onHover { hovered = $0 }
            .accessibilityElement(children: .contain)
            .accessibilityAction(.default, open)
    }
}

struct MacFileSnippet: View {
    let attachment: Attachment
    var transfer: AttachmentUploadState? = nil
    var onRemove: (() -> Void)? = nil
    var onOpen: (() -> Void)? = nil
    var opensDraft = false
    @StateObject private var audio = MacInlineAudio()
    @State private var previewError: String?
    @State private var openingDraft = false

    private var playsDraft: Bool { opensDraft && attachment.mimeType.hasPrefix("audio/") }
    private var openAction: (() -> Void)? { onOpen ?? (opensDraft ? previewDraft : nil) }
    private var openLabel: String {
        if playsDraft { return audio.playing ? "Пауза" : "Слушать \(attachment.name)" }
        return "Открыть \(attachment.name)"
    }

    private var icon: String {
        if playsDraft { return audio.playing ? "pause.fill" : "play.fill" }
        if attachment.mimeType.hasPrefix("image/") { return "photo" }
        if attachment.mimeType.hasPrefix("audio/") { return "waveform" }
        if attachment.mimeType == "application/zip" { return "doc.zipper" }
        if attachment.mimeType == "application/pdf" { return "doc.text" }
        if attachment.mimeType.hasPrefix("video/") { return "video" }
        return "doc"
    }

    private var metadata: String {
        let fileExtension = (attachment.name as NSString).pathExtension.uppercased()
        let size = ByteCountFormatter.string(fromByteCount: Int64(attachment.size), countStyle: .file)
        return fileExtension.isEmpty ? size : "\(fileExtension) · \(size)"
    }

    var body: some View {
        HStack(spacing: 6) {
            if let openAction {
                Button(action: openAction) {
                    HStack(spacing: 6) {
                        details
                        if !opensDraft {
                            DoompileSymbol(systemName: "arrow.up.right", size: 11).foregroundStyle(MacPalette.muted)
                                .frame(width: 24, height: 32)
                        }
                    }
                }.buttonStyle(.plain).help(openLabel).accessibilityLabel(openLabel)
            } else {
                details
            }
            if let onRemove {
                Button(action: onRemove) {
                    DoompileSymbol(systemName: "xmark", size: 11).foregroundStyle(MacPalette.muted)
                        .frame(width: 28, height: 32).contentShape(Rectangle())
                }.buttonStyle(.plain).help("Убрать вложение").accessibilityLabel("Убрать \(attachment.name)")
            }
        }
        .padding(6)
        .background(MacPalette.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(MacPalette.line))
        .onDisappear { audio.pause() }
    }

    private var details: some View {
        HStack(spacing: 8) {
            Group {
                if let transfer { AttachmentTransferBadge(state: transfer, compact: true) }
                else if openingDraft || audio.loading { ProgressView().controlSize(.mini) }
                else { DoompileSymbol(systemName: icon, size: 16).foregroundStyle(MacPalette.muted) }
            }
            .frame(width: 32, height: 32)
            .background(MacPalette.tool, in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.name).font(.system(size: 13, weight: .medium)).lineLimit(1).truncationMode(.middle)
                Text(transfer?.label ?? previewError ?? audio.error ?? metadata).font(.system(size: 11))
                    .foregroundStyle(transfer == .failed ? MacPalette.orange : MacPalette.muted).monospacedDigit().lineLimit(1)
                    .accessibilityHidden(transfer != nil)
            }
            .frame(minWidth: 88, maxWidth: 192, alignment: .leading)
        }
    }

    private func previewDraft() {
        Task {
            if playsDraft { await audio.toggle(attachment); return }
            guard !openingDraft else { return }
            openingDraft = true
            defer { openingDraft = false }
            do {
                let file = try await AttachmentFiles.resolve(attachment)
                guard NSWorkspace.shared.open(file) else { throw DoompileError.message("Не удалось открыть вложение.") }
                previewError = nil
            } catch {
                previewError = "Не удалось открыть вложение"
            }
        }
    }
}

struct MacAttachmentCard: View {
    let attachment: Attachment
    var transfer: AttachmentUploadState? = nil
    @State private var file: URL?
    @State private var image: NSImage?
    @State private var player: AVPlayer?
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        Group {
            if let transfer {
                MacFileSnippet(attachment: attachment, transfer: transfer)
            } else if attachment.mimeType.hasPrefix("audio/") {
                MacAudioCard(attachment: attachment)
            } else if attachment.mimeType.hasPrefix("image/"), let image {
                Button(action: open) { Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: 360, maxHeight: 260).clipShape(RoundedRectangle(cornerRadius: 8)) }.buttonStyle(.plain).accessibilityLabel("Открыть \(attachment.name)")
            } else if attachment.mimeType.hasPrefix("video/"), let player {
                VideoPlayer(player: player).frame(width: 250, height: 155).clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                HStack(spacing: 8) {
                    MacFileSnippet(attachment: attachment, onOpen: loading ? nil : open)
                    if loading { ProgressView().controlSize(.mini).accessibilityLabel("Загрузка вложения") }
                    if let error { Text(error).font(.system(size: 11)).foregroundStyle(MacPalette.orange).lineLimit(2) }
                }
            }
        }
        .task(id: attachment.url) {
            guard attachment.mimeType.hasPrefix("image/") || attachment.mimeType.hasPrefix("video/") else { return }
            do { let url = try await AttachmentFiles.resolve(attachment); file = url; if attachment.mimeType.hasPrefix("image/") { image = NSImage(contentsOf: url) } else { player = AVPlayer(url: url) } }
            catch { self.error = "Не удалось загрузить" }
        }
        .onDisappear { player?.pause() }
    }
    private func open() {
        Task { @MainActor in
            loading = true; defer { loading = false }
            do { let url: URL; if let file { url = file } else { url = try await AttachmentFiles.resolve(attachment); file = url }; NSWorkspace.shared.open(url) }
            catch { self.error = error.localizedDescription }
        }
    }
}

@MainActor final class MacInlineAudio: ObservableObject {
    @Published var playing = false
    @Published var loading = false
    @Published var seconds = 0.0
    @Published var duration = 0.0
    @Published var error: String?
    private var player: AVPlayer?
    private var observer: Any?
    func toggle(_ attachment: Attachment) async {
        guard !loading else { return }
        if let player { if playing { pause() } else { if duration > 0 && seconds >= duration - 0.1 { await player.seek(to: .zero) }; player.play(); playing = true }; return }
        loading = true; defer { loading = false }
        do {
            let file = try await AttachmentFiles.resolve(attachment)
            let asset = AVURLAsset(url: file)
            let length = try await asset.load(.duration).seconds
            duration = length.isFinite ? max(0, length) : 0
            let player = AVPlayer(playerItem: AVPlayerItem(asset: asset)); self.player = player
            observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] time in
                Task { @MainActor in guard let self else { return }; if time.seconds.isFinite { self.seconds = max(0, time.seconds) }; self.playing = player.timeControlStatus == .playing }
            }
            player.play(); playing = true; error = nil
        } catch { self.error = "Не удалось загрузить аудио" }
    }
    func seek(_ value: Double) { seconds = value; player?.seek(to: CMTime(seconds: value, preferredTimescale: 600)) }
    func pause() { player?.pause(); playing = false }
    deinit { if let observer { player?.removeTimeObserver(observer) }; player?.pause() }
}

struct MacAudioCard: View {
    let attachment: Attachment
    @StateObject private var audio = MacInlineAudio()
    var body: some View {
        HStack(spacing: 9) {
            Button { Task { await audio.toggle(attachment) } } label: {
                Group { if audio.loading { ProgressView().controlSize(.small) } else { DoompileSymbol(systemName: audio.playing ? "pause.fill" : "play.fill", size: 11).font(.system(size: 11)) } }.frame(width: 29, height: 29).background(MacPalette.tool, in: Circle())
            }.buttonStyle(.plain).help(audio.playing ? "Пауза" : "Слушать \(attachment.name)").accessibilityLabel(audio.playing ? "Пауза" : "Слушать \(attachment.name)")
            VStack(alignment: .leading, spacing: 2) {
                Text(audio.error ?? attachment.name).font(.system(size: 10)).foregroundStyle(MacPalette.muted).lineLimit(1)
                Slider(value: Binding(get: { min(audio.seconds, max(1, audio.duration)) }, set: audio.seek), in: 0...max(1, audio.duration)).disabled(audio.duration <= 0).controlSize(.mini).tint(MacPalette.muted).accessibilityLabel("Перемотать \(attachment.name)")
            }
            Text(Note.timeLabel(audio.playing ? audio.seconds : audio.duration)).font(.system(size: 10)).monospacedDigit().foregroundStyle(MacPalette.muted)
        }.padding(8).frame(maxWidth: 330).background(MacPalette.surface, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(MacPalette.line))
            .onDisappear { audio.pause() }
    }
}
