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
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            DoompileSymbol(systemName: icon).font(.system(size: send ? 18 : 15, weight: .regular))
                .frame(width: send ? 39 : 34, height: 37)
                .foregroundStyle(send ? Color(red: 37/255, green: 37/255, blue: 31/255).opacity(disabled ? 0.45 : 1) : MacPalette.muted)
                .background(send ? MacPalette.send.opacity(disabled ? 0.55 : 1) : MacPalette.tool, in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).disabled(disabled).help(label).accessibilityLabel(label)
    }
}

struct MacRecordingSnippet: View {
    let starting: Bool
    let seconds: Int
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(MacPalette.orange).frame(width: 6, height: 6)
            Text(starting ? "Включаем микрофон…" : "Запись \(Note.timeLabel(Double(seconds)))")
            Spacer()
            if !starting {
                Button("■ Стоп", action: onStop).buttonStyle(.plain).accessibilityLabel("Остановить запись")
            }
        }
        .font(.system(size: 11)).foregroundStyle(MacPalette.orange)
        .padding(.horizontal, 10).frame(height: 30)
    }
}

struct MacComposerAttachmentStrip: View {
    let attachments: [Attachment]
    var onRemove: ((String) -> Void)?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(attachments) { file in
                    HStack(alignment: .top, spacing: 3) {
                        MacAttachmentCard(attachment: file)
                        if let onRemove {
                            Button { onRemove(file.id) } label: { DoompileSymbol(systemName: "xmark.circle.fill", size: 12) }
                                .buttonStyle(.plain).foregroundStyle(MacPalette.muted).help("Убрать вложение").accessibilityLabel("Убрать вложение")
                        }
                    }
                }
            }.padding(.horizontal, 4)
        }
    }
}
