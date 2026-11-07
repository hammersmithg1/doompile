import Foundation
import MetricKit

/// The OS delivers crash/hang reports after the process can run again, sometimes the next day.
/// Keep only binary UUIDs and offsets for dSYM symbolication; never persist the raw diagnostic.
final class NativeDiagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = NativeDiagnostics()
    private var started = false
    func start() {
        guard !started else { return }
        started = true
        MXMetricManager.shared.add(self)
    }
    static func frames(_ data: Data) -> String {
        guard let root = try? JSONSerialization.jsonObject(with: data) else { return "" }
        var frames: [String] = [], budget = 5000
        func visit(_ node: Any, depth: Int) {
            guard budget > 0, depth < 80, frames.count < 12 else { return }; budget -= 1
            if let value = node as? [String: Any] {
                if let uuid = value["binaryUUID"] as? String, UUID(uuidString: uuid) != nil,
                   let offset = value["offsetIntoBinaryTextSegment"], let number = UInt64(String(describing: offset)) {
                    frames.append("native:" + uuid.lowercased() + ":" + String(number, radix: 16))
                }
                for key in value.keys.sorted() { visit(value[key]!, depth: depth + 1) }
            } else if let nodes = node as? [Any] { for value in nodes { visit(value, depth: depth + 1) } }
        }
        visit(root, depth: 0)
        return frames.joined(separator: "\n")
    }
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let telemetry = Telemetry.shared
        for payload in payloads {
            for crash in payload.crashDiagnostics ?? [] {
                telemetry.record(.runtimeCrash, ["count": 1, "stack": Self.frames(crash.callStackTree.jsonRepresentation()), "diagnostic_build": crash.metaData.applicationBuildVersion])
            }
            for hang in payload.hangDiagnostics ?? [] {
                telemetry.record(.runtimeHang, ["count": 1, "stack": Self.frames(hang.callStackTree.jsonRepresentation()), "duration_ms": hang.hangDuration.converted(to: .milliseconds).value, "diagnostic_build": hang.metaData.applicationBuildVersion])
            }
        }
        Task { await telemetry.flush() }
    }
}
