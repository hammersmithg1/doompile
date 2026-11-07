import XCTest
@testable import DoompileCore

final class TelemetryTests: XCTestCase {
    func testNativeCrashFramesKeepOnlyBinaryIdentityAndOffset() throws {
        let uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        let raw: [String: Any] = ["callStacks": [["binaryUUID": uuid, "offsetIntoBinaryTextSegment": 32, "binaryName": "private note", "path": "/Users/private", "exception": "secret"]]]
        let frames = NativeDiagnostics.frames(try JSONSerialization.data(withJSONObject: raw))
        XCTAssertEqual(frames, "native:" + uuid + ":20")
        XCTAssertEqual(TelemetryPrivacy.frames(frames), frames)
        XCTAssertFalse(frames.contains("private")); XCTAssertFalse(frames.contains("secret"))
    }
    func testSamePrivacyFixturesAsJavaScript() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixtures = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("packages/core/test-fixtures/telemetry.json"))) as! [[String: Any]]
        for fixture in fixtures {
            let name = TelemetryEventName(rawValue: fixture["event"] as! String)!
            let actual = TelemetryPrivacy.properties(name, fixture["input"] as! [String: Any]) as NSDictionary
            XCTAssertEqual(actual, fixture["expected"] as! NSDictionary, fixture["name"] as! String)
        }
    }
    func testTracePropagationRejectsZeroIDs() {
        let root = TelemetryTrace(), child = TelemetryTrace(parent: root)
        XCTAssertEqual(child.traceID, root.traceID); XCTAssertEqual(child.parentSpanID, root.spanID); XCTAssertNotEqual(child.spanID, root.spanID)
        XCTAssertEqual(TelemetryTrace(header: child.header)?.spanID, child.spanID)
        XCTAssertNil(TelemetryTrace(header: "00-" + String(repeating: "0", count: 32) + "-" + root.spanID + "-01"))
    }
    func testAppAndExtensionJournalSurvivesRestartBoundsAndAcknowledgements() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = try TelemetryJournal(directory: directory, limit: 3), share = try TelemetryJournal(directory: directory, limit: 3)
        func event(_ offset: Int) -> [String: Any] { ["id": UUID().uuidString.lowercased(), "timestamp": Telemetry.timestamp(Date().addingTimeInterval(Double(offset))), "name": "app.started"] }
        try app.append(event(0), pending: true); try share.append(event(1), pending: true)
        XCTAssertEqual(try app.stats()["count"], 2)
        let sent = try app.events(pendingOnly: true)
        try share.append(event(2), pending: true)
        try app.acknowledge(sent.map { $0["id"] as! String })
        XCTAssertEqual(try share.stats()["pending"], 1)
        try share.append(event(3), pending: true); try share.append(event(4), pending: true); try share.append(event(5), pending: true)
        let restarted = try TelemetryJournal(directory: directory, limit: 3)
        XCTAssertEqual(try restarted.stats()["count"], 3); XCTAssertEqual(try restarted.stats()["dropped"], 1)
        try restarted.clearPending()
        XCTAssertEqual(try app.events().count, 3); XCTAssertEqual(try app.events(pendingOnly: true).count, 0)
    }
}
