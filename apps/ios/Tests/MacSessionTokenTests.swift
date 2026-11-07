#if os(macOS)
import XCTest
@testable import DoompileCore

final class MacSessionTokenTests: XCTestCase {
    func testSessionSurvivesRestartAndReplacementWithoutKeychain() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MacSessionTokenStore(directory: directory)
        XCTAssertEqual(store.read("account-a"), "")
        try store.save("test-session-one", scope: "account-a")
        XCTAssertEqual(MacSessionTokenStore(directory: directory).read("account-a"), "test-session-one")
        try store.save("test-session-two", scope: "account-a")
        XCTAssertEqual(store.read("account-a"), "test-session-two")
        let folderMode = try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? NSNumber
        let fileMode = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("account-a.token").path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(folderMode?.intValue, 0o700)
        XCTAssertEqual(fileMode?.intValue, 0o600)
    }
    func testAccountsAreIsolatedAndSignOutRemovesOnlyItsSession() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MacSessionTokenStore(directory: directory)
        try store.save("test-a", scope: "account-a")
        try store.save("test-b", scope: "account-b")
        try store.remove("account-a")
        try store.remove("account-a")
        XCTAssertEqual(store.read("account-a"), "")
        XCTAssertEqual(store.read("account-b"), "test-b")
    }
}
#endif
