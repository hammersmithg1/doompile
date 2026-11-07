import AppKit
import SwiftUI

/// Observe SwiftUI's windows without replacing their delegates or close handling.
struct MacDesktopWindow: NSViewRepresentable {
    @Environment(\.openWindow) private var openWindow
    let presence: MacApplicationPresence
    var isMain = false

    func makeNSView(context: Context) -> MacDesktopWindowView { MacDesktopWindowView() }
    func updateNSView(_ view: MacDesktopWindowView, context: Context) {
        view.onWindow = { presence.register($0, isMain: isMain) }
        if let window = view.window { view.onWindow?(window) }
        if isMain {
            let open = openWindow
            presence.requestMainWindow = { open(id: "main") }
        }
    }
}

final class MacDesktopWindowView: NSView {
    var onWindow: ((NSWindow) -> Void)?
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let window { onWindow?(window) }
    }
}
