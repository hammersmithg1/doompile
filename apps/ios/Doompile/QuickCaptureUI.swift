import SwiftUI
import UIKit

struct CaptureAttachmentSnippet: View {
    let attachment: Attachment
    var transfer: AttachmentUploadState? = nil
    var remove: (() -> Void)? = nil

    private var fileExtension: String { (attachment.name as NSString).pathExtension.uppercased() }
    private var icon: String {
        if attachment.mimeType.hasPrefix("image/") { return "photo" }
        if attachment.mimeType.hasPrefix("audio/") { return "waveform" }
        if attachment.mimeType.hasPrefix("video/") { return "video" }
        if ["ZIP", "RAR", "7Z", "GZ", "TAR"].contains(fileExtension) { return "doc.zipper" }
        return "doc"
    }
    private var metadata: String {
        let size = ByteCountFormatter.string(fromByteCount: Int64(attachment.size), countStyle: .file)
        let details = transfer == .uploading(nil) && attachment.size == 0 ? "Подготовка…" : size
        var pieces = [fileExtension, details].filter { !$0.isEmpty }
        if case .uploading(let progress?) = transfer { pieces.append("\(Int((progress * 100).rounded()))%") }
        return pieces.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if let transfer { AttachmentTransferBadge(state: transfer, compact: true) }
                else { DoompileSymbol(systemName: icon, size: 17).accessibilityHidden(true) }
            }
            .frame(width: 32, height: 32)
            .background(DesignTokens.tool, in: RoundedRectangle(cornerRadius: DesignTokens.radiusControl))
            .foregroundStyle(Palette.muted)
            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.name).font(.system(size: 13, weight: .medium)).lineLimit(1).truncationMode(.middle)
                Text(metadata).font(.system(size: 11)).lineLimit(1).foregroundStyle(Palette.muted)
            }
            Spacer(minLength: 0)
            if let remove {
                Button(action: remove) {
                    DoompileSymbol(systemName: "xmark", size: 13)
                        .frame(width: 44, height: 44).contentShape(Rectangle()).foregroundStyle(Palette.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Убрать вложение \(attachment.name)")
                .accessibilityIdentifier("quick-remove-attachment")
            }
        }
        .frame(minHeight: 44)
        .padding(.leading, 6).padding(.trailing, remove == nil ? 8 : 0)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay { RoundedRectangle(cornerRadius: DesignTokens.radiusCard).strokeBorder(Palette.line) }
    }
}

/// UIKit retains the originating touch while SwiftUI changes the microphone to Send.
struct QuickVoiceControl: UIViewRepresentable {
    let showsSend: Bool
    let enabled: Bool
    let onActivate: () -> Void
    let onHoldStart: () -> Void
    let onHoldEnd: (Release) -> Void

    enum Release: Equatable { case inside, outside, interrupted }

    func makeUIView(context: Context) -> Control {
        Control(frame: .zero)
    }

    func updateUIView(_ view: Control, context: Context) {
        view.configuration = self
        view.accessibilityLabel = showsSend ? "Сохранить заметку" : "Записать голосовую заметку"
        view.accessibilityIdentifier = showsSend ? "quick-send" : "quick-microphone"
        view.accessibilityTraits = enabled ? [.button] : [.button, .notEnabled]
        if !showsSend {
            view.accessibilityHint = "Коснись для записи или удерживай, чтобы отправить при отпускании"
        } else {
            view.accessibilityHint = nil
        }
    }

    final class Control: UIControl {
        var configuration: QuickVoiceControl?
        private var holdTimer: Timer?
        private var holding = false
        private var trackingPress = false

        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = true
        }

        required init?(coder: NSCoder) { return nil }

        override func beginTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
            guard let configuration, configuration.enabled else { return false }
            trackingPress = true
            if !configuration.showsSend {
                let timer = Timer(timeInterval: 0.35, repeats: false) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, self.trackingPress, self.configuration?.enabled == true,
                              self.configuration?.showsSend == false else { return }
                        self.holding = true
                        self.configuration?.onHoldStart()
                    }
                }
                holdTimer = timer
                RunLoop.main.add(timer, forMode: .common)
            }
            return true
        }

        override func continueTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
            if !bounds.insetBy(dx: -12, dy: -12).contains(touch.location(in: self)) {
                finishPress(.outside)
                return false
            }
            return true
        }

        override func endTracking(_ touch: UITouch?, with event: UIEvent?) {
            if let touch { finishPress(bounds.insetBy(dx: -12, dy: -12).contains(touch.location(in: self)) ? .inside : .outside) }
            else { finishPress(.interrupted) }
            super.endTracking(touch, with: event)
        }

        override func cancelTracking(with event: UIEvent?) {
            finishPress(.interrupted)
            super.cancelTracking(with: event)
        }

        override func accessibilityActivate() -> Bool {
            guard let configuration, configuration.enabled else { return false }
            configuration.onActivate()
            return true
        }

        private func finishPress(_ release: Release) {
            holdTimer?.invalidate()
            holdTimer = nil
            guard trackingPress else { return }
            trackingPress = false
            if holding {
                holding = false
                configuration?.onHoldEnd(release)
            } else if release == .inside && configuration?.enabled == true {
                configuration?.onActivate()
            }
        }
    }
}

extension JSONValue {
    func appendingQuickAttachment(_ attachment: Attachment) -> JSONValue {
        guard case .object(var document) = self, case .array(var content) = document["content"],
              case .object(let template) = JSONValue.document("").includingAttachments([attachment]),
              case .array(let nodes) = template["content"], let media = nodes.last else { return self }
        content.append(media)
        document["content"] = .array(content)
        return .object(document)
    }

    func removingQuickAttachment(url: String) -> JSONValue {
        guard case .object(var node) = self, case .array(let content) = node["content"] else { return self }
        node["content"] = .array(content.compactMap { child in
            guard case .object(let media) = child, case .object(let attrs) = media["attrs"] else {
                return child.removingQuickAttachment(url: url)
            }
            if media["type"] == .string("attachment"), attrs["url"] == .string(url) { return nil }
            if media["type"] == .string("image"), attrs["src"] == .string(url) { return nil }
            return child.removingQuickAttachment(url: url)
        })
        return .object(node)
    }
}
