import XCTest
@testable import DoompileCore

final class AppearanceTests: XCTestCase {
    func testSystemFollowsOSAndExplicitChoicesOverrideIt() {
        XCTAssertNil(AppearanceMode.system.colorScheme)
        XCTAssertEqual(AppearanceMode.light.colorScheme, .light)
        XCTAssertEqual(AppearanceMode.dark.colorScheme, .dark)
        XCTAssertEqual(AppearanceMode.allCases.map(\.title), ["Системная", "Светлая", "Тёмная"])
    }
    func testTagCanExistBeforeAnyNoteAndSurvivesReload() {
        let name = "doompile-tag-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        XCTAssertTrue(TagCatalog.create("  Research  ", defaults: defaults))
        XCTAssertTrue(TagCatalog.create("Research", defaults: defaults))
        XCTAssertFalse(TagCatalog.create(" \n ", defaults: defaults))
        XCTAssertFalse(TagCatalog.create(String(repeating: "a", count: 101), defaults: defaults))
        XCTAssertEqual(TagCatalog.all(noteTags: [], defaults: UserDefaults(suiteName: name)!), ["Research"])
        XCTAssertEqual(Set(TagCatalog.all(noteTags: ["Work", "Research"], defaults: defaults)), ["Research", "Work"])
    }
}
