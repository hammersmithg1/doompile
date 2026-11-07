import AppKit

enum MacBackgroundPreferences {
    static let minimizeToDockKey = "mac-minimize-to-dock-v1"
    static let showMenuBarIconKey = "mac-show-menu-bar-icon-v1"
}

/// Only desktop windows affect the Dock. The nonactivating capture panel is
/// deliberately never registered, so invoking it preserves background mode.
@MainActor final class MacApplicationPresence {
    private let defaults: UserDefaults
    private let notifications: NotificationCenter
    private let applyPolicy: @MainActor (NSApplication.ActivationPolicy) -> Void
    private let activate: @MainActor () -> Void
    private let desktopWindows = NSHashTable<NSWindow>.weakObjects()
    private let openWindows = NSHashTable<NSWindow>.weakObjects()
    private weak var mainWindow: NSWindow?
    private var observers: [NSObjectProtocol] = []
    private var policy: NSApplication.ActivationPolicy?
    private var started = false
    private var backgroundLaunch = false
    var requestMainWindow: (() -> Void)?

    init(defaults: UserDefaults, notifications: NotificationCenter = .default,
         applyPolicy: @escaping @MainActor (NSApplication.ActivationPolicy) -> Void = { _ = NSApp.setActivationPolicy($0) },
         activate: @escaping @MainActor () -> Void = { NSApp.activate(ignoringOtherApps: true) }) {
        self.defaults = defaults
        self.notifications = notifications
        self.applyPolicy = applyPolicy
        self.activate = activate
    }

    func start(inBackground: Bool = false) {
        guard !started else { return }
        started = true
        backgroundLaunch = inBackground
        if inBackground {
            openWindows.removeAllObjects()
            for window in desktopWindows.allObjects { hideInitialWindow(window) }
        }
        observe(NSWindow.didBecomeKeyNotification) { owner, notification in
            guard let window = notification.object as? NSWindow, owner.desktopWindows.contains(window) else { return }
            if owner.backgroundLaunch { owner.hideInitialWindow(window); return }
            owner.openWindows.add(window)
            owner.refresh()
        }
        observe(NSWindow.willCloseNotification) { owner, notification in
            guard let window = notification.object as? NSWindow, owner.desktopWindows.contains(window) else { return }
            owner.openWindows.remove(window)
            owner.refresh()
        }
        observe(UserDefaults.didChangeNotification) { owner, _ in owner.refresh() }
        refresh()
    }

    func register(_ window: NSWindow, isMain: Bool) {
        if isMain { mainWindow = window }
        guard !desktopWindows.contains(window) else { return }
        desktopWindows.add(window)
        if backgroundLaunch { hideInitialWindow(window) }
        else { openWindows.add(window) }
        refresh()
    }

    func refresh() {
        guard started else { return }
        let keepInDock = defaults.bool(forKey: MacBackgroundPreferences.minimizeToDockKey)
        setPolicy(keepInDock || !openWindows.allObjects.isEmpty ? .regular : .accessory)
    }

    @discardableResult func openMainWindow() -> Bool {
        backgroundLaunch = false
        guard requestMainWindow != nil || mainWindow != nil else { return false }
        showDesktopWindow {
            if let requestMainWindow { requestMainWindow() }
            else if let mainWindow {
                if mainWindow.isMiniaturized { mainWindow.deminiaturize(nil) }
                mainWindow.makeKeyAndOrderFront(nil)
            }
        }
        return true
    }

    func showDesktopWindow(_ open: () -> Void) {
        backgroundLaunch = false
        setPolicy(.regular)
        open()
        activate()
    }

    func revealMainWindow() {
        guard !openMainWindow() else { return }
        // No SwiftUI content may have been created during a login launch. A
        // normal reopen event lets SwiftUI create its main scene in that case.
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: NSWorkspace.OpenConfiguration())
    }

    private func hideInitialWindow(_ window: NSWindow) {
        // SwiftUI may order its default window after the launch notification.
        // Keep it hidden until an explicit Finder/menu/shortcut request opens it.
        DispatchQueue.main.async { [weak self, weak window] in
            guard self?.backgroundLaunch == true else { return }
            window?.orderOut(nil)
        }
    }

    private func setPolicy(_ value: NSApplication.ActivationPolicy) {
        guard policy != value else { return }
        applyPolicy(value)
        policy = value
    }

    private func observe(_ name: Notification.Name, handler: @escaping (MacApplicationPresence, Notification) -> Void) {
        observers.append(notifications.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
            MainActor.assumeIsolated { if let self { handler(self, notification) } }
        })
    }

    deinit { for observer in observers { notifications.removeObserver(observer) } }
}
