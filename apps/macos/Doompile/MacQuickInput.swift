import AppKit
import SwiftUI

/// Native first keystroke; no web view or network needs to finish loading.
struct MacQuickInput: NSViewRepresentable {
    static let height: CGFloat = 39
    static let prompt = "Добавь что-нибудь в кучу…"
    private static let lineHeight: CGFloat = 22
    static let maximumHeight = height + 14 * lineHeight

    @Binding var text: String
    @Binding var focused: Bool
    @Binding var contentHeight: CGFloat
    var placeholder = MacQuickInput.prompt
    var onSubmit: () -> Void
    var onPasteImage: (Data) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> QuickInputScrollView {
        let scroll = QuickInputScrollView()
        let input = QuickTextView(frame: NSRect(x: 0, y: 0, width: 300, height: Self.height))
        input.delegate = context.coordinator
        input.isRichText = false
        input.drawsBackground = false
        input.isAutomaticQuoteSubstitutionEnabled = false
        input.isAutomaticDashSubstitutionEnabled = false
        input.font = .systemFont(ofSize: 14)
        input.textColor = .labelColor
        input.insertionPointColor = .labelColor
        input.textContainerInset = NSSize(width: 0, height: 8)
        input.textContainer?.lineFragmentPadding = 0
        input.textContainer?.widthTracksTextView = true
        input.textContainer?.heightTracksTextView = false
        input.isVerticallyResizable = true
        input.isHorizontallyResizable = false
        input.minSize = NSSize(width: 0, height: Self.height)
        input.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        input.autoresizingMask = [.width]
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = Self.lineHeight
        paragraph.maximumLineHeight = Self.lineHeight
        input.defaultParagraphStyle = paragraph
        input.typingAttributes[.paragraphStyle] = paragraph
        input.setPlainText(text)
        input.placeholder = placeholder
        input.onPasteImage = { [weak coordinator = context.coordinator] in coordinator?.parent.onPasteImage($0) }
        input.setAccessibilityLabel("Быстрая заметка")
        input.setAccessibilityIdentifier("quick-composer-input")
        scroll.documentView = input
        scroll.drawsBackground = false
        scroll.scrollerStyle = .overlay
        scroll.hasVerticalScroller = false
        scroll.borderType = .noBorder
        scroll.onHeightChange = { [weak coordinator = context.coordinator] height in
            guard let coordinator, coordinator.parent.contentHeight != height else { return }
            coordinator.parent.contentHeight = height
        }
        context.coordinator.input = input
        return scroll
    }
    func updateNSView(_ scroll: QuickInputScrollView, context: Context) {
        context.coordinator.parent = self
        guard let input = context.coordinator.input else { return }
        if input.string != text {
            input.setPlainText(text)
            scroll.scheduleMeasurement()
        }
        input.placeholder = placeholder
        if focused, scroll.window?.firstResponder !== input {
            DispatchQueue.main.async { [weak input] in
                guard let input, context.coordinator.parent.focused, input.window?.isKeyWindow == true else { return }
                input.window?.makeFirstResponder(input)
            }
        }
    }
    static func dismantleNSView(_ scroll: QuickInputScrollView, coordinator: Coordinator) {
        scroll.onHeightChange = nil
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MacQuickInput
        weak var input: QuickTextView?
        init(_ parent: MacQuickInput) { self.parent = parent }
        func textDidChange(_ notification: Notification) {
            guard let input else { return }
            parent.text = input.string
            input.needsDisplay = true
            (input.enclosingScrollView as? QuickInputScrollView)?.scheduleMeasurement(revealSelection: true)
        }
        func textDidBeginEditing(_ notification: Notification) { DispatchQueue.main.async { self.parent.focused = true } }
        func textDidEndEditing(_ notification: Notification) { DispatchQueue.main.async { self.parent.focused = false } }
        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                guard !textView.hasMarkedText() else { return false }
                let flags = NSApp.currentEvent?.modifierFlags ?? []
                if flags.intersection([.shift, .control, .option]).isEmpty { parent.onSubmit(); return true }
                textView.insertNewlineIgnoringFieldEditor(nil); return true
            }
            return false
        }
    }
}

final class QuickInputScrollView: NSScrollView {
    var onHeightChange: ((CGFloat) -> Void)?
    private var measurementScheduled = false
    private var revealSelection = false

    override func layout() {
        super.layout()
        scheduleMeasurement()
    }

    func scheduleMeasurement(revealSelection: Bool = false) {
        self.revealSelection = self.revealSelection || revealSelection
        guard !measurementScheduled else { return }
        measurementScheduled = true
        DispatchQueue.main.async { [weak self] in self?.measureContent() }
    }

    private func measureContent() {
        measurementScheduled = false
        guard let input = documentView as? QuickTextView, contentSize.width > 0,
              let layout = input.layoutManager, let container = input.textContainer else { return }
        if abs(input.frame.width - contentSize.width) > 0.5 {
            input.setFrameSize(NSSize(width: contentSize.width, height: input.frame.height))
        }
        layout.ensureLayout(for: container)
        let textBottom = max(layout.usedRect(for: container).maxY, layout.extraLineFragmentRect.maxY)
        let contentHeight = max(MacQuickInput.height, ceil(textBottom + 2 * input.textContainerInset.height))
        if abs(input.frame.height - contentHeight) > 0.5 {
            input.setFrameSize(NSSize(width: contentSize.width, height: contentHeight))
        }
        let viewportHeight = min(MacQuickInput.maximumHeight, contentHeight)
        let scrolls = contentHeight > viewportHeight
        if hasVerticalScroller != scrolls { hasVerticalScroller = scrolls }
        onHeightChange?(viewportHeight)
        if revealSelection {
            revealSelection = false
            input.scrollRangeToVisible(input.selectedRange())
        }
    }
}

final class QuickTextView: NSTextView {
    var placeholder = "" { didSet { needsDisplay = true } }
    var onPasteImage: ((Data) -> Void)?
    func setPlainText(_ value: String) {
        textStorage?.setAttributedString(NSAttributedString(string: value, attributes: typingAttributes))
        needsDisplay = true
    }
    override func paste(_ sender: Any?) {
        let board = NSPasteboard.general
        if let onPasteImage {
            if let png = board.data(forType: .png) { onPasteImage(png); return }
            if let tiff = board.data(forType: .tiff),
               let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                onPasteImage(png)
                return
            }
        }
        super.paste(sender)
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty else { return }
        (placeholder as NSString).draw(at: NSPoint(x: textContainerInset.width, y: textContainerInset.height), withAttributes: [.font: font ?? NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.secondaryLabelColor])
    }
}

/// Keep the draft visible while the offline rich editor loads.
struct MacQuickEditorPreview: View {
    let text: String
    let compact: Bool

    var body: some View {
        Text(text.isEmpty ? MacQuickInput.prompt : text)
            .font(.system(size: compact ? 14 : 15))
            .foregroundStyle(text.isEmpty ? MacPalette.muted : MacPalette.text)
            .lineSpacing(5)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.vertical, compact ? 8 : 20)
            .padding(.horizontal, compact ? 4 : 28)
            .clipped()
            .allowsHitTesting(false)
    }
}

struct MacComposerButton: View {
    var icon: String
    var label: String
    var send = false
    var disabled = false
    var primary = false
    var identifier: String? = nil
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            DoompileSymbol(systemName: icon).font(.system(size: primary || send ? 18 : 15, weight: .regular))
                .frame(width: primary || send ? 39 : 34, height: 37)
                .foregroundStyle(send ? Color(red: 37/255, green: 37/255, blue: 31/255).opacity(disabled ? 0.45 : 1) : MacPalette.muted)
                .background(send ? MacPalette.send.opacity(disabled ? 0.55 : 1) : MacPalette.tool, in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).disabled(disabled).help(label).accessibilityLabel(label).accessibilityIdentifier(identifier ?? icon)
    }
}

/// The pointer target stays mounted when the microphone changes to Send during a hold.
struct MacComposerPrimaryButton: View {
    let canSend: Bool
    let starting: Bool
    let busy: Bool
    let onStart: () -> Void
    let onSend: () -> Void
    let onHoldRelease: () -> Void
    let onVoiceCancel: () -> Void

    private func activate() {
        if canSend { onSend() } else { onStart() }
    }

    var body: some View {
        MacComposerButton(
            icon: canSend ? "arrow.up" : "mic",
            label: canSend ? "Отправить заметку" : "Записать голосовую заметку",
            send: canSend, disabled: busy || starting, primary: true,
            identifier: canSend ? "quick-composer-send" : "quick-composer-mic",
            action: activate
        )
        .overlay {
            MacComposerPointer(startsVoice: !canSend, enabled: !starting && !busy, onSend: onSend,
                               onStart: onStart, onHoldRelease: onHoldRelease, onVoiceCancel: onVoiceCancel)
                .accessibilityHidden(true)
        }
    }
}

private struct MacComposerPointer: NSViewRepresentable {
    let startsVoice: Bool
    let enabled: Bool
    let onSend: () -> Void
    let onStart: () -> Void
    let onHoldRelease: () -> Void
    let onVoiceCancel: () -> Void

    func makeNSView(context: Context) -> PointerView { PointerView() }
    func updateNSView(_ view: PointerView, context: Context) { view.control = self }

    final class PointerView: NSView {
        private enum Press {
            case voice(time: TimeInterval, bounds: NSRect)
            case send
        }

        var control: MacComposerPointer?
        private var press: Press?

        override var mouseDownCanMoveWindow: Bool { false }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func mouseDown(with event: NSEvent) {
            guard let control, control.enabled, let window else { return }
            if control.startsVoice {
                // The recording snippet can resize the global panel while pressed.
                let originalBounds = window.convertToScreen(convert(bounds, to: nil)).insetBy(dx: -12, dy: -12)
                press = .voice(time: event.timestamp, bounds: originalBounds)
                control.onStart()
            } else {
                press = .send
            }
        }

        override func mouseUp(with event: NSEvent) {
            defer { press = nil }
            guard let press, let control, let window else { return }
            switch press {
            case let .voice(time, originalBounds):
                let release = window.convertPoint(toScreen: event.locationInWindow)
                if !originalBounds.contains(release) { control.onVoiceCancel() }
                else if event.timestamp - time >= 0.35 { control.onHoldRelease() }
            case .send:
                if control.enabled, bounds.contains(convert(event.locationInWindow, from: nil)) { control.onSend() }
            }
        }

        override func viewWillMove(toWindow newWindow: NSWindow?) {
            super.viewWillMove(toWindow: newWindow)
            if newWindow == nil { press = nil }
        }
    }
}

struct MacRecordingSnippet: View {
    let starting: Bool
    let seconds: Int
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: 9) {
            DoompileSymbol(systemName: "mic", size: 16).foregroundStyle(MacPalette.orange)
                .frame(width: 32, height: 32)
                .background(MacPalette.tool, in: RoundedRectangle(cornerRadius: 8))
            Text(starting ? "Включаем микрофон…" : "Запись · \(Note.timeLabel(Double(seconds)))")
                .font(.system(size: 12, weight: .medium)).monospacedDigit()
            if !starting {
                Button(action: onStop) {
                    DoompileSymbol(systemName: "stop.fill", size: 14)
                        .frame(width: 30, height: 32)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).foregroundStyle(MacPalette.orange)
                    .help("Остановить запись").accessibilityLabel("Остановить запись")
                    .accessibilityIdentifier("quick-composer-stop")
            }
        }
        .padding(6)
        .background(MacPalette.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(MacPalette.line))
    }
}

struct MacComposerAttachmentStrip: View {
    let attachments: [Attachment]
    var starting = false
    var recording = false
    var seconds = 0
    var onRemove: ((String) -> Void)?
    var onStop: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if starting || recording { MacRecordingSnippet(starting: starting, seconds: seconds, onStop: onStop) }
                ForEach(attachments) { file in
                    MacFileSnippet(attachment: file, onRemove: onRemove.map { remove in { remove(file.id) } }, opensDraft: true)
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("quick-composer-attachment")
                }
            }.padding(.horizontal, 4)
        }
        .frame(height: 46)
    }
}
