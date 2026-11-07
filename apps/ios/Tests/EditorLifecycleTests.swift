import XCTest
@testable import DoompileCore
final class EditorLifecycleTests: XCTestCase {
    func testSharedCloseContract() throws {
        struct Case: Decodable { let name: String; let plainText: String; let body: JSONValue; let attachments: [Attachment]; let source: NoteSource?; let expected: Bool }
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: root.appendingPathComponent("packages/core/test-fixtures/editor-lifecycle.json")))
        for item in cases {
            var note = Note(); note.plainText = item.plainText; note.body = item.body; note.attachments = item.attachments; note.source = item.source
            XCTAssertEqual(EditorLifecycle.shouldSave(note, existing: false), item.expected, item.name)
            XCTAssertTrue(EditorLifecycle.shouldSave(note, existing: true), "Existing empty edits are saved")
        }
    }
    func testReadingAnUnchangedNoteDoesNotTurnAcknowledgementsIntoEdits() {
        var stored = Note.text("Read only")
        stored.revision = 2
        var opened = stored
        opened.revision = 1
        opened.updatedAt = "2026-11-03T05:00:00.000Z"
        XCTAssertTrue(EditorLifecycle.matchesStored(opened, stored))
        opened.pinned = true
        XCTAssertFalse(EditorLifecycle.matchesStored(opened, stored))
        opened.pinned = false
        opened.body = .document("Actual edit")
        XCTAssertFalse(EditorLifecycle.matchesStored(opened, stored))
    }
    func testFlagChangesDoNotMoveCreationPosition() {
        var old = Note.text("Old"); old.createdAt = "2026-10-01T00:00:00.000Z"; old.updatedAt = "2026-10-31T00:00:00.000Z"
        var newer = Note.text("Newer"); newer.createdAt = "2026-10-02T00:00:00.000Z"
        old.pinned = true; old.urgent = true
        XCTAssertEqual([old,newer].sorted(by: Note.newestFirst).map(\.id),[newer.id,old.id])
        old.pinned = false; old.urgent = false; old.updatedAt = Note.now()
        XCTAssertEqual([old,newer].sorted(by: Note.newestFirst).map(\.id),[newer.id,old.id])
    }
}
