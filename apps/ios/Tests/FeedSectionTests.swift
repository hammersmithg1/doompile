import XCTest
@testable import DoompileCore

final class FeedSectionTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar
    }
    func testCreationDayMatchesLocalWebDaysAndSurvivesEdits() {
        let now = ISO8601DateFormatter().date(from: "2026-11-03T10:00:00Z")!
        var yesterday = Note.text("Yesterday")
        yesterday.createdAt = "2026-11-02T15:59:59.000Z"
        yesterday.updatedAt = Note.now()
        var today = Note.text("Today after local midnight")
        today.createdAt = "2026-11-02T16:00:00.000Z"
        var earlier = Note.text("Earlier")
        earlier.createdAt = "2026-10-30T00:00:00Z"
        let sections = FeedSection.make([yesterday, earlier, today], now: now, calendar: calendar)
        XCTAssertEqual(sections.map(\.id), ["day:2026-11-3", "day:2026-11-2", "day:2026-10-30"])
        XCTAssertEqual(sections.map(\.title), ["Сегодня", "Вчера", "30 октября"])
        XCTAssertEqual(sections[1].notes.map(\.id), [yesterday.id])
    }
    func testImportantAndPinnedNotesAppearOnceBeforeTheirDaySections() {
        var urgent = Note.text("Urgent"); urgent.urgent = true; urgent.pinned = true
        var pinned = Note.text("Pinned"); pinned.pinned = true
        let normal = Note.text("Normal")
        var deleted = Note.text("Deleted"); deleted.deletedAt = Note.now()
        let all = FeedSection.make([normal, deleted, pinned, urgent], includingUrgent: true)
        XCTAssertEqual(all.prefix(2).map(\.id), ["urgent", "pinned"])
        XCTAssertEqual(all.flatMap(\.notes).map(\.id), [urgent.id, pinned.id, normal.id])
        XCTAssertEqual(FeedSection.make([urgent, pinned]).flatMap(\.notes).map(\.id), [pinned.id], "Mac keeps its existing separate urgent shelf")
    }
}
