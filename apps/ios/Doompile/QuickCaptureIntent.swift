import AppIntents
import SwiftUI

@MainActor final class QuickCaptureRouter: ObservableObject {
    static let shared = QuickCaptureRouter()
    @Published var pending: UUID?
    func request() { pending = UUID() }
}

/// Exported by Xcode's App Intents metadata extractor, not just an app URL scheme.
struct QuickNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Быстрая заметка"
    static var description = IntentDescription("Открыть новую заметку в Doompile и сразу начать писать.")
    static var openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        QuickCaptureRouter.shared.request()
        return .result()
    }
}

struct DoompileShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: QuickNoteIntent(),
            phrases: ["Новая заметка в \(.applicationName)", "Запиши в \(.applicationName)"],
            shortTitle: "Быстрая заметка",
            systemImageName: "square.and.pencil"
        )
    }
}
