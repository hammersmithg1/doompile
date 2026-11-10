import AppKit
import Combine
import Sparkle
import SwiftUI

/// One updater for the whole app, independent of the account and Settings window.
@MainActor final class ApplicationUpdater: ObservableObject {
    @Published private(set) var canCheckForUpdates = false
    @Published private(set) var automaticallyChecksForUpdates = false
    @Published private(set) var automaticallyDownloadsUpdates = false
    @Published private(set) var lastUpdateCheckDate: Date?
    @Published private(set) var unavailableReason: String?

    let version: String
    private var controller: SPUStandardUpdaterController?
    private var started = false

    init(bundle: Bundle = .main, enabled: Bool = true) {
        let info = bundle.infoDictionary ?? [:]
        version = "\(info["CFBundleShortVersionString"] as? String ?? "—") (\(info["CFBundleVersion"] as? String ?? "—"))"
        guard enabled, let feed = info["SUFeedURL"] as? String,
              let url = URLComponents(string: feed), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              let key = info["SUPublicEDKey"] as? String, Data(base64Encoded: key)?.count == 32 else {
            unavailableReason = "В этой сборке канал обновлений ещё не подключён."
            return
        }
        let controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
        self.controller = controller
        let updater = controller.updater
        updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheckForUpdates)
        updater.publisher(for: \.automaticallyChecksForUpdates).assign(to: &$automaticallyChecksForUpdates)
        updater.publisher(for: \.automaticallyDownloadsUpdates).assign(to: &$automaticallyDownloadsUpdates)
        updater.publisher(for: \.lastUpdateCheckDate).assign(to: &$lastUpdateCheckDate)
        start()
    }

    func start() {
        guard !started, let controller else { return }
        started = true
        do { try controller.updater.start() }
        catch { unavailableReason = "Не удалось включить обновления: \(error.localizedDescription)" }
    }

    func checkForUpdates() {
        start()
        if let unavailableReason {
            let alert = NSAlert()
            alert.messageText = "Обновления недоступны"
            alert.informativeText = unavailableReason
            alert.addButton(withTitle: "Понятно")
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        } else if canCheckForUpdates {
            NSApp.activate(ignoringOtherApps: true)
            controller?.checkForUpdates(nil)
        }
    }

    func setAutomaticChecks(_ enabled: Bool) { controller?.updater.automaticallyChecksForUpdates = enabled }
    func setAutomaticDownloads(_ enabled: Bool) { controller?.updater.automaticallyDownloadsUpdates = enabled }
}

struct CheckForUpdatesButton: View {
    @ObservedObject var updater: ApplicationUpdater
    var body: some View {
        Button("Проверить обновления…", action: updater.checkForUpdates)
            .disabled(updater.unavailableReason == nil && !updater.canCheckForUpdates)
    }
}

struct ApplicationUpdateSettings: View {
    @ObservedObject var updater: ApplicationUpdater
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ОБНОВЛЕНИЯ").font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(1.5).foregroundStyle(MacPalette.muted)
            HStack {
                Text("Doompile \(updater.version)").font(.system(size: 12))
                Spacer()
                CheckForUpdatesButton(updater: updater)
            }
            if let reason = updater.unavailableReason {
                Text(reason).font(.system(size: 11)).foregroundStyle(MacPalette.muted)
            } else {
                Toggle("Автоматически проверять обновления", isOn: Binding(
                    get: { updater.automaticallyChecksForUpdates }, set: updater.setAutomaticChecks))
                Toggle("Автоматически загружать и устанавливать обновления", isOn: Binding(
                    get: { updater.automaticallyDownloadsUpdates }, set: updater.setAutomaticDownloads))
                    .disabled(!updater.automaticallyChecksForUpdates)
                Text("Проверка выполняется раз в день. При ручном обновлении приложение предложит загрузить новую версию и перезапустить Doompile.")
                    .font(.system(size: 11)).foregroundStyle(MacPalette.muted).lineSpacing(4)
                if let date = updater.lastUpdateCheckDate {
                    Text("Последняя проверка: \(date.formatted(date: .abbreviated, time: .shortened))")
                        .font(.system(size: 11)).foregroundStyle(MacPalette.muted)
                }
            }
        }
    }
}
