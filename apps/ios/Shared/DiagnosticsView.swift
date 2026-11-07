import SwiftUI

struct DiagnosticsView: View {
    @State private var sending = Telemetry.shared.enabled
    @State private var exportURL: URL?
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("Отправлять диагностику и события использования", isOn: $sending)
                .onChange(of: sending) { value in Telemetry.shared.setEnabled(value) }
            Button("Подготовить диагностический дамп") {
                do { exportURL = try Telemetry.shared.export(); error = nil }
                catch { self.error = "Не удалось подготовить диагностику." }
            }.accessibilityIdentifier("diagnostics-export")
            if let url = exportURL { ShareLink("Поделиться диагностикой", item: url).accessibilityIdentifier("diagnostics-share") }
            Text("События и ошибки за последние 7 дней сохраняются на устройстве даже без интернета. Дамп не содержит текстов заметок, поисковых запросов и ключей доступа.").font(.footnote).foregroundStyle(.secondary)
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        }.onAppear { Telemetry.shared.record(.screenViewed, ["screen": "settings"]) }
    }
}
