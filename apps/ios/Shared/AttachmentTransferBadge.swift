import SwiftUI

enum AttachmentUploadState: Equatable, Sendable {
    case queued
    case uploading(Double?)
    case failed

    var label: String {
        switch self {
        case .queued: return "Ожидает отправки"
        case .uploading(nil): return "Загружается"
        case .uploading(let progress?): return "Загружается · \(Int((progress * 100).rounded()))%"
        case .failed: return "Не удалось загрузить"
        }
    }
}

struct AttachmentTransferBadge: View {
    let state: AttachmentUploadState
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 5) {
            Group {
                switch state {
                case .queued:
                    DoompileSymbol(systemName: "arrow.up", size: 10)
                case .failed:
                    Image(systemName: "exclamationmark.circle").font(.system(size: 11))
                case .uploading(let progress?):
                    ZStack {
                        Circle().strokeBorder(lineWidth: 1.5).opacity(0.25)
                        Circle().trim(from: 0, to: progress)
                            .stroke(style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }.padding(1)
                case .uploading(nil):
                    if reduceMotion {
                        DoompileSymbol(systemName: "arrow.up", size: 10)
                    } else {
                        ProgressView().controlSize(.mini)
                    }
                }
            }.frame(width: 13, height: 13).accessibilityHidden(true)
            if !compact { Text(state.label).font(.caption2).monospacedDigit().lineLimit(1) }
        }
        .foregroundStyle(state == .failed ? DesignTokens.danger : DesignTokens.muted)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.label)
        .accessibilityIdentifier("attachment-transfer-state")
    }
}
