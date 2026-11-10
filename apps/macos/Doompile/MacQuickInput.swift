import AppKit
import SwiftUI

/// Native first keystroke; no web view or network needs to finish loading.
struct MacQuickInput: NSViewRepresentable {
    @Binding var text: String
    @Binding var height: CGFloat
    @Binding var focused: Bool
    var placeholder = "Добавь что-нибудь в кучу…"
    var onSubmit: () -> Void
    var onPasteImage: (Data) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = QuickInputScrollView()
        let input = QuickTextView(frame: NSRect(x: 0, y: 0, width: 300, height: 39))
        input.delegate = context.coordinator
        input.isRichText = false
        input.drawsBackground = false
        input.isAutomaticQuoteSubstitutionEnabled = false
        input.isAutomaticDashSubstitutionEnabled = false
        input.font = .systemFont(ofSize: 13)
        input.textColor = .labelColor
        input.insertionPointColor = .labelColor
        input.textContainerInset = NSSize(width: 0, height: 9)
        input.textContainer?.lineFragmentPadding = 0
        input.textContainer?.widthTracksTextView = true
        input.isVerticallyResizable = true
        input.isHorizontallyResizable = false
        input.minSize = NSSize(width: 0, height: 39)
        input.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        input.autoresizingMask = [.width]
        input.string = text; input.placeholder = placeholder
        input.onPasteImage = { [weak coordinator = context.coordinator] in coordinator?.parent.onPasteImage($0) }
        input.setAccessibilityLabel("Быстрая заметка")
        input.setAccessibilityIdentifier("quick-composer-input")
        scroll.documentView = input
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = false
        scroll.borderType = .noBorder
        scroll.onLayout = { [weak coordinator = context.coordinator] in coordinator?.measure() }
        context.coordinator.input = input
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let input = context.coordinator.input else { return }
        if input.string != text { input.string = text; input.needsDisplay = true }
        input.placeholder = placeholder
        context.coordinator.measure()
        if focused, scroll.window?.firstResponder !== input {
            DispatchQueue.main.async { [weak input] in
                guard let input, context.coordinator.parent.focused, input.window?.isKeyWindow == true else { return }
                input.window?.makeFirstResponder(input)
            }
        }
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MacQuickInput
        weak var input: QuickTextView?
        init(_ parent: MacQuickInput) { self.parent = parent }
        func textDidChange(_ notification: Notification) { guard let input else { return }; parent.text = input.string; input.needsDisplay = true; measure() }
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
        func measure() {
            guard let input, let layout = input.layoutManager, let container = input.textContainer else { return }
            layout.ensureLayout(for: container)
            let desired = max(39, min(136, ceil(layout.usedRect(for: container).height) + 18))
            if abs(parent.height - desired) > 1 { DispatchQueue.main.async { self.parent.height = desired } }
        }
    }
}

final class QuickInputScrollView: NSScrollView {
    var onLayout: (() -> Void)?
    override func layout() {
        super.layout()
        if let input = documentView as? NSTextView, abs(input.frame.width - contentSize.width) > 0.5 { input.setFrameSize(NSSize(width: contentSize.width, height: max(39, input.frame.height))) }
        onLayout?()
    }
}

final class QuickTextView: NSTextView {
    var placeholder = "" { didSet { needsDisplay = true } }
    var onPasteImage: ((Data) -> Void)?
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
        (placeholder as NSString).draw(at: NSPoint(x: textContainerInset.width, y: textContainerInset.height), withAttributes: [.font: font ?? NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.placeholderTextColor])
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
            MacComposerPointer(allowsHold: !canSend && !starting && !busy, enabled: !starting && !busy,
                               onTap: activate, onHold: onStart, onRelease: onHoldRelease)
                .accessibilityHidden(true)
        }
    }
}

private struct MacComposerPointer: NSViewRepresentable {
    let allowsHold: Bool
    let enabled: Bool
    let onTap: () -> Void
    let onHold: () -> Void
    let onRelease: () -> Void

    func makeNSView(context: Context) -> PointerView { PointerView() }
    func updateNSView(_ view: PointerView, context: Context) { view.control = self }

    final class PointerView: NSView {
        var control: MacComposerPointer?
        private var hold: Task<Void, Never>?
        private var held = false
        private var pressed = false

        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func mouseDown(with event: NSEvent) {
            guard control?.enabled == true else { return }
            pressed = true
            held = false
            hold?.cancel()
            guard control?.allowsHold == true else { return }
            hold = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled, let self, control?.allowsHold == true else { return }
                held = true
                control?.onHold()
            }
        }

        override func mouseDragged(with event: NSEvent) {
            guard !held, !bounds.insetBy(dx: -8, dy: -8).contains(convert(event.locationInWindow, from: nil)) else { return }
            hold?.cancel()
            pressed = false
        }

        override func mouseUp(with event: NSEvent) {
            hold?.cancel()
            guard pressed else { return }
            pressed = false
            if held { control?.onRelease() }
            else if control?.enabled == true, bounds.contains(convert(event.locationInWindow, from: nil)) { control?.onTap() }
        }

        override func viewWillMove(toWindow newWindow: NSWindow?) {
            super.viewWillMove(toWindow: newWindow)
            if newWindow == nil { hold?.cancel(); pressed = false }
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
                    MacFileSnippet(attachment: file, onRemove: onRemove.map { remove in { remove(file.id) } })
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("quick-composer-attachment")
                }
            }.padding(.horizontal, 4)
        }
        .frame(height: 46)
    }
}
