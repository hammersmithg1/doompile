import AppKit
import Combine
import ServiceManagement

@MainActor protocol MacLoginItemService {
    var status: SMAppService.Status { get }
    func register() throws
    func unregister() throws
}

extension SMAppService: MacLoginItemService {}

@MainActor final class MacLoginItem: ObservableObject {
    @Published private(set) var status: SMAppService.Status = .notRegistered
    @Published private(set) var error: String?
    private let service: MacLoginItemService
    var requested: Bool { status == .enabled || status == .requiresApproval }

    init(service: MacLoginItemService = SMAppService.mainApp) {
        self.service = service
        refresh()
    }

    func refresh() { status = service.status }

    func setEnabled(_ enabled: Bool) {
        refresh()
        do {
            if enabled && !requested { try service.register() }
            else if !enabled && requested { try service.unregister() }
            refresh()
            error = nil
        } catch {
            refresh()
            self.error = "Не удалось изменить автозапуск: \(error.localizedDescription)"
        }
    }

    func openSystemSettings() { SMAppService.openSystemSettingsLoginItems() }
}

enum MacLaunchContext {
    static func isBackgroundLaunch(_ event: NSAppleEventDescriptor?) -> Bool {
        guard let event, event.eventID == AEEventID(kAEOpenApplication) else { return false }
        guard let kind = event.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue else { return false }
        return kind == OSType(keyAELaunchedAsLogInItem) || kind == OSType(keyAELaunchedAsServiceItem)
    }
}
