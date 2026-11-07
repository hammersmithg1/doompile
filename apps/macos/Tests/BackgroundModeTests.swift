import AppKit
import ServiceManagement
import XCTest
@testable import DoompileMacSupport

final class BackgroundModeTests: XCTestCase {
    func testAllFourBackgroundCombinationsPersistIndependently() async throws {
        try await MainActor.run {
            let fixture = try PresenceFixture()
            defer { fixture.cleanUp() }
            fixture.presence.start()
            XCTAssertEqual(fixture.policies.last, .accessory)
            XCTAssertFalse(fixture.defaults.bool(forKey: MacBackgroundPreferences.showMenuBarIconKey))
            for dock in [false, true] {
                for menu in [false, true] {
                    fixture.defaults.set(dock, forKey: MacBackgroundPreferences.minimizeToDockKey)
                    fixture.defaults.set(menu, forKey: MacBackgroundPreferences.showMenuBarIconKey)
                    fixture.presence.refresh()
                    XCTAssertEqual(fixture.policies.last, dock ? .regular : .accessory)
                    let restored = try XCTUnwrap(UserDefaults(suiteName: fixture.suite))
                    XCTAssertEqual(restored.bool(forKey: MacBackgroundPreferences.minimizeToDockKey), dock)
                    XCTAssertEqual(restored.bool(forKey: MacBackgroundPreferences.showMenuBarIconKey), menu)
                }
            }
        }
    }

    func testOnlyClosingTheLastDesktopWindowHidesDockAndCaptureDoesNotRestoreIt() async throws {
        try await MainActor.run {
            let fixture = try PresenceFixture()
            defer { fixture.cleanUp() }
            let main = fixture.window(), settings = fixture.window()
            let panel = NSPanel(contentRect: .zero, styleMask: .nonactivatingPanel, backing: .buffered, defer: true)
            fixture.presence.register(main, isMain: true)
            fixture.presence.register(settings, isMain: false)
            fixture.presence.start()
            XCTAssertEqual(fixture.policies, [.regular])
            fixture.notifications.post(name: NSWindow.willCloseNotification, object: main)
            XCTAssertEqual(fixture.policies, [.regular])
            fixture.notifications.post(name: NSWindow.willCloseNotification, object: settings)
            XCTAssertEqual(fixture.policies, [.regular, .accessory])
            fixture.notifications.post(name: NSWindow.didBecomeKeyNotification, object: panel)
            fixture.notifications.post(name: NSWindow.willCloseNotification, object: panel)
            fixture.presence.register(main, isMain: true) // A SwiftUI update must not reopen a closed window.
            XCTAssertEqual(fixture.policies, [.regular, .accessory])
            fixture.notifications.post(name: NSWindow.didBecomeKeyNotification, object: main)
            XCTAssertEqual(fixture.policies.last, .regular)
            fixture.notifications.post(name: NSWindow.willCloseNotification, object: main)
            XCTAssertEqual(fixture.policies.last, .accessory)
        }
    }

    func testDockPreferenceAppliesAfterClosingWhileOpenWindowsRetainNormalMenus() async throws {
        try await MainActor.run {
            let fixture = try PresenceFixture()
            defer { fixture.cleanUp() }
            fixture.defaults.set(true, forKey: MacBackgroundPreferences.minimizeToDockKey)
            let main = fixture.window()
            fixture.presence.register(main, isMain: true)
            fixture.presence.start()
            fixture.notifications.post(name: NSWindow.willCloseNotification, object: main)
            XCTAssertEqual(fixture.policies, [.regular])
            fixture.defaults.set(false, forKey: MacBackgroundPreferences.minimizeToDockKey)
            fixture.presence.refresh()
            XCTAssertEqual(fixture.policies.last, .accessory)
            fixture.notifications.post(name: NSWindow.didBecomeKeyNotification, object: main)
            fixture.defaults.set(true, forKey: MacBackgroundPreferences.minimizeToDockKey)
            fixture.presence.refresh()
            fixture.defaults.set(false, forKey: MacBackgroundPreferences.minimizeToDockKey)
            fixture.presence.refresh()
            XCTAssertEqual(fixture.policies.last, .regular)
        }
    }

    func testLoginLaunchDoesNotCountRestoredWindowsAndExplicitReopenRestoresDesktop() async throws {
        try await MainActor.run {
            let fixture = try PresenceFixture()
            defer { fixture.cleanUp() }
            let main = fixture.window(), lateWindow = fixture.window()
            fixture.presence.register(main, isMain: true)
            fixture.presence.start(inBackground: true)
            fixture.presence.register(lateWindow, isMain: true)
            fixture.notifications.post(name: NSWindow.didBecomeKeyNotification, object: main)
            XCTAssertEqual(fixture.policies, [.accessory])
            var requested = false
            let notifications = fixture.notifications
            fixture.presence.requestMainWindow = {
                requested = true
                notifications.post(name: NSWindow.didBecomeKeyNotification, object: main)
            }
            XCTAssertTrue(fixture.presence.openMainWindow())
            XCTAssertTrue(requested)
            XCTAssertEqual(fixture.policies, [.accessory, .regular])
            fixture.notifications.post(name: NSWindow.willCloseNotification, object: main)
            XCTAssertEqual(fixture.policies.last, .accessory)
        }
    }

    func testRestoredSettingsStayInBackgroundUntilExplicitlyOpened() async throws {
        try await MainActor.run {
            let fixture = try PresenceFixture()
            defer { fixture.cleanUp() }
            let main = fixture.window(), settings = fixture.window()
            fixture.presence.start(inBackground: true)
            fixture.presence.register(main, isMain: true)
            fixture.presence.register(settings, isMain: false)
            fixture.notifications.post(name: NSWindow.didBecomeKeyNotification, object: settings)
            XCTAssertEqual(fixture.policies, [.accessory])
            fixture.presence.showDesktopWindow {
                fixture.notifications.post(name: NSWindow.didBecomeKeyNotification, object: settings)
            }
            XCTAssertEqual(fixture.policies, [.accessory, .regular])
            fixture.notifications.post(name: NSWindow.willCloseNotification, object: settings)
            XCTAssertEqual(fixture.policies.last, .accessory)
        }
    }

    func testLoginLaunchDetectionDistinguishesManualLaunchAndReopen() async {
        await MainActor.run {
            func event(_ eventID: AEEventID = AEEventID(kAEOpenApplication), kind: OSType? = nil) -> NSAppleEventDescriptor {
                let event = NSAppleEventDescriptor.appleEvent(withEventClass: AEEventClass(kCoreEventClass), eventID: eventID,
                    targetDescriptor: nil, returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
                if let kind { event.setParam(NSAppleEventDescriptor(enumCode: kind), forKeyword: AEKeyword(keyAEPropData)) }
                return event
            }
            XCTAssertFalse(MacLaunchContext.isBackgroundLaunch(nil))
            XCTAssertFalse(MacLaunchContext.isBackgroundLaunch(event()))
            XCTAssertTrue(MacLaunchContext.isBackgroundLaunch(event(kind: OSType(keyAELaunchedAsLogInItem))))
            XCTAssertTrue(MacLaunchContext.isBackgroundLaunch(event(kind: OSType(keyAELaunchedAsServiceItem))))
            XCTAssertFalse(MacLaunchContext.isBackgroundLaunch(event(AEEventID(kAEReopenApplication), kind: OSType(keyAELaunchedAsLogInItem))))
        }
    }

    func testLoginItemUsesActualSystemStateIncludingApprovalAndExternalChanges() async {
        await MainActor.run {
            let service = LoginItemServiceStub()
            let item = MacLoginItem(service: service)
            XCTAssertFalse(item.requested)
            service.registrationStatus = .requiresApproval
            item.setEnabled(true)
            XCTAssertTrue(item.requested)
            XCTAssertEqual(item.status, .requiresApproval)
            XCTAssertEqual(service.registerCalls, 1)
            item.setEnabled(false)
            XCTAssertFalse(item.requested)
            XCTAssertEqual(service.unregisterCalls, 1)
            service.status = .enabled
            item.refresh()
            XCTAssertTrue(item.requested)
            service.status = .notRegistered
            item.refresh()
            XCTAssertFalse(item.requested)
        }
    }

    func testRegistrationFailuresNeverPretendAutostartChanged() async {
        await MainActor.run {
            let service = LoginItemServiceStub()
            let item = MacLoginItem(service: service)
            service.failure = NSError(domain: "LoginItemTest", code: 1)
            item.setEnabled(true)
            XCTAssertFalse(item.requested)
            XCTAssertNotNil(item.error)
            service.failure = nil
            item.setEnabled(true)
            XCTAssertTrue(item.requested)
            XCTAssertNil(item.error)
            service.failure = NSError(domain: "LoginItemTest", code: 2)
            item.setEnabled(false)
            XCTAssertTrue(item.requested)
            XCTAssertNotNil(item.error)
        }
    }
}

@MainActor private final class PresenceFixture {
    let suite = "doompile-background-test-" + UUID().uuidString
    let defaults: UserDefaults
    let notifications = NotificationCenter()
    var policies: [NSApplication.ActivationPolicy] = []
    lazy var presence = MacApplicationPresence(defaults: defaults, notifications: notifications,
        applyPolicy: { [weak self] in self?.policies.append($0) }, activate: {})

    init() throws {
        _ = NSApplication.shared
        defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    }
    func window() -> NSWindow {
        let window = NSWindow(contentRect: .zero, styleMask: .titled, backing: .buffered, defer: true)
        window.isReleasedWhenClosed = false
        return window
    }
    func cleanUp() { defaults.removePersistentDomain(forName: suite) }
}

@MainActor private final class LoginItemServiceStub: MacLoginItemService {
    var status: SMAppService.Status = .notRegistered
    var registrationStatus: SMAppService.Status = .enabled
    var failure: Error?
    private(set) var registerCalls = 0
    private(set) var unregisterCalls = 0
    func register() throws {
        registerCalls += 1
        if let failure { throw failure }
        status = registrationStatus
    }
    func unregister() throws {
        unregisterCalls += 1
        if let failure { throw failure }
        status = .notRegistered
    }
}
