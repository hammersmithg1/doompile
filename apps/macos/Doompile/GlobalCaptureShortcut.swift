import AppKit
import Carbon
import SwiftUI

@MainActor final class GlobalCaptureShortcut: ObservableObject {
    @Published private(set) var shortcut: CaptureShortcut? = CaptureShortcut.load()
    @Published private(set) var error: String?
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var registrationID: UInt32 = 0
    private var suspended = false
    var onInvoke: (() -> Void)?

    init() {
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            guard GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id) == noErr else { return OSStatus(eventNotHandledErr) }
            return MainActor.assumeIsolated {
                let owner = Unmanaged<GlobalCaptureShortcut>.fromOpaque(context).takeUnretainedValue()
                guard id.signature == 0x444F4F4D, id.id == owner.registrationID, !owner.suspended else { return OSStatus(eventNotHandledErr) }
                owner.onInvoke?()
                return noErr
            }
        }, 1, &type, Unmanaged.passUnretained(self).toOpaque(), &handler)
        if status != noErr { error = "Не удалось подключить горячую клавишу (\(status))." }
        else { resume() }
    }

    func assign(_ value: CaptureShortcut?) -> Bool {
        if let problem = value?.validationError { error = problem; return false }
        do {
            // Register first. A conflicting choice must never discard the old binding.
            if value != shortcut || hotKey == nil { try register(value) }
            try CaptureShortcut.persist(value)
            shortcut = value
            error = nil
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func setRecording(_ recording: Bool) {
        suspended = recording
        if recording { if let hotKey { UnregisterEventHotKey(hotKey) }; hotKey = nil }
        else { resume() }
    }
    private func resume() {
        guard !suspended, hotKey == nil else { return }
        do { try register(shortcut); error = nil }
        catch { self.error = error.localizedDescription }
    }
    private func register(_ value: CaptureShortcut?) throws {
        guard let value else { if let hotKey { UnregisterEventHotKey(hotKey) }; hotKey = nil; return }
        if systemUses(value) { throw DoompileError.message("\(value.label) используется macOS. Выбери другое сочетание.") }
        let nextID = registrationID &+ 1
        var reference: EventHotKeyRef?
        let status = RegisterEventHotKey(value.keyCode, value.modifiers.carbon, EventHotKeyID(signature: 0x444F4F4D, id: nextID), GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &reference)
        guard status == noErr, let reference else { throw DoompileError.message("Сочетание \(value.label) занято или недоступно (\(status)). Попробуй другое.") }
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = reference; registrationID = nextID
    }
    private func systemUses(_ value: CaptureShortcut) -> Bool {
        var hotKeys: Unmanaged<CFArray>?
        guard CopySymbolicHotKeys(&hotKeys) == noErr, let values = hotKeys?.takeRetainedValue() as? [[String: Any]] else { return false }
        return values.contains {
            ($0[kHISymbolicHotKeyEnabled as String] as? Bool) == true &&
            ($0[kHISymbolicHotKeyCode as String] as? NSNumber)?.uint32Value == value.keyCode &&
            ($0[kHISymbolicHotKeyModifiers as String] as? NSNumber)?.uint32Value == value.modifiers.carbon
        }
    }
    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
    }
}

extension CaptureShortcut.Modifiers {
    init(_ flags: NSEvent.ModifierFlags) {
        self = []
        if flags.contains(.command) { insert(.command) }
        if flags.contains(.option) { insert(.option) }
        if flags.contains(.control) { insert(.control) }
        if flags.contains(.shift) { insert(.shift) }
    }
    var carbon: UInt32 {
        (contains(.command) ? UInt32(cmdKey) : 0) | (contains(.option) ? UInt32(optionKey) : 0) | (contains(.control) ? UInt32(controlKey) : 0) | (contains(.shift) ? UInt32(shiftKey) : 0)
    }
}

struct CaptureShortcutRecorder: NSViewRepresentable {
    @ObservedObject var shortcut: GlobalCaptureShortcut
    func makeNSView(context: Context) -> CaptureRecorderControl { CaptureRecorderControl() }
    func updateNSView(_ view: CaptureRecorderControl, context: Context) {
        view.label = shortcut.shortcut?.label ?? "Назначить сочетание"
        view.onRecord = { shortcut.setRecording($0) }
        view.onShortcut = { shortcut.assign($0) }
    }
    static func dismantleNSView(_ view: CaptureRecorderControl, coordinator: ()) { view.stop() }
}

final class CaptureRecorderControl: NSView {
    var label = "Назначить сочетание" { didSet { needsDisplay = true; setAccessibilityValue(label) } }
    var onRecord: ((Bool) -> Void)?
    var onShortcut: ((CaptureShortcut?) -> Bool)?
    private var recording = false
    override var acceptsFirstResponder: Bool { true }
    override var intrinsicContentSize: NSSize { NSSize(width: 210, height: 34) }
    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true); setAccessibilityRole(.button)
        setAccessibilityLabel("Горячая клавиша быстрой заметки")
        toolTip = "Нажми и введи сочетание. Escape — отмена, Delete — отключить."
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func mouseDown(with event: NSEvent) { begin() }
    override func accessibilityPerformPress() -> Bool { begin(); return true }
    private func begin() { window?.makeFirstResponder(self); recording = true; onRecord?(true); needsDisplay = true }
    func stop() { guard recording else { return }; recording = false; onRecord?(false); needsDisplay = true }
    override func resignFirstResponder() -> Bool { stop(); return true }
    override func keyDown(with event: NSEvent) {
        if !recording { if [36, 49].contains(event.keyCode) { begin() } else { super.keyDown(with: event) }; return }
        if event.keyCode == 53 { stop(); return }
        let flags = CaptureShortcut.Modifiers(event.modifierFlags)
        if [51, 117].contains(event.keyCode), flags.isEmpty { if onShortcut?(nil) == true { stop() }; return }
        guard !event.isARepeat else { return }
        let special: [UInt16: String] = [49: "Пробел", 122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12"]
        let label = special[event.keyCode] ?? event.charactersIgnoringModifiers?.uppercased() ?? ""
        let value = CaptureShortcut(keyCode: UInt32(event.keyCode), modifiers: flags, key: label)
        if onShortcut?(value) == true { stop() }
    }
    override func draw(_ dirtyRect: NSRect) {
        let rect = bounds.insetBy(dx: 1, dy: 1)
        let shape = NSBezierPath(roundedRect: rect, xRadius: 7, yRadius: 7)
        NSColor.controlBackgroundColor.setFill(); shape.fill()
        (recording ? NSColor.keyboardFocusIndicatorColor : NSColor.separatorColor).setStroke(); shape.lineWidth = recording ? 2 : 1; shape.stroke()
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        let value = recording ? "Нажми сочетание…" : label
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: NSColor.labelColor, .paragraphStyle: paragraph]
        (value as NSString).draw(in: NSRect(x: 8, y: (bounds.height - 17) / 2, width: bounds.width - 16, height: 18), withAttributes: attributes)
    }
}
