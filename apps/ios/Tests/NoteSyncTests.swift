import XCTest
@testable import DoompileCore

final class NoteSyncTests: XCTestCase {
    private func fixture() -> (URL, Storage) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return (directory, Storage(directory: directory))
    }
    private func edited(_ note: Note, _ text: String) throws -> Note {
        var next = note; next.body = .document(text); next.plainText = text
        return try NoteEngine.shared.prepare(next)
    }
    private func acknowledge(_ store: Storage, _ note: Note, revision: Int) throws -> Note {
        var server = note; server.revision = revision
        try store.accept(server, matching: note, acknowledged: store.journal(note.id).map(\.id))
        return server
    }
    func testTwoOfflineDevicesConvergeToOneNote() throws {
        let (_, phone) = fixture(), (_, mac) = fixture()
        let base = try NoteEngine.shared.prepare(Note.text("Shared"))
        try phone.merge([base]); try mac.merge([base])
        let left = try phone.save(edited(base, "Phone Shared"))
        let right = try mac.save(edited(base, "Shared Mac"))
        let union = try NoteEngine.shared.receive(left, server: right)
        try phone.merge([union]); try mac.merge([union])
        XCTAssertEqual(try phone.snapshot().notes.count, 1)
        XCTAssertEqual(try mac.snapshot().notes.count, 1)
        XCTAssertEqual(try phone.snapshot().notes[base.id]?.plainText, "Phone Shared Mac")
        XCTAssertEqual(try mac.snapshot().notes[base.id]?.plainText, "Phone Shared Mac")
        XCTAssertFalse(try phone.journal(base.id).isEmpty)
    }
    func testLostAcknowledgementRetainsExactJournalAcrossRestart() throws {
        let (directory, store) = fixture()
        let first = try store.save(Note.text("Offline first"))
        _ = try store.save(edited(first, "Offline second"))
        let rows = try store.journal(first.id)
        XCTAssertEqual(rows.count, 2)
        let reopened = Storage(directory: directory)
        XCTAssertEqual(try reopened.journal(first.id), rows)
        XCTAssertEqual(try reopened.snapshot().notes[first.id]?.plainText, "Offline second")
    }
    func testAcknowledgementClearsOnlySentChangesAndPreservesTyping() throws {
        let (_, store) = fixture()
        let first = try store.save(Note.text("First"))
        let sent = try store.journal(first.id)
        let newer = try store.save(edited(first, "First newer"))
        var server = first; server.revision = 1
        try store.accept(server, matching: first, acknowledged: sent.map(\.id))
        let local = try XCTUnwrap(store.snapshot().notes[first.id])
        XCTAssertEqual(local.plainText, newer.plainText)
        XCTAssertEqual(local.revision, 1)
        XCTAssertEqual(try store.journal(first.id).count, 1)
        XCTAssertTrue(try store.snapshot().dirty.contains(first.id))
        _ = try acknowledge(store, local, revision: 2)
        XCTAssertTrue(try store.pendingNotes().isEmpty)
        XCTAssertEqual(try store.snapshot().notes.count, 1)
    }
    func testRepeatedStaleEditorSavesNeverFork() throws {
        let (_, store) = fixture()
        var opened = try store.save(Note.text("Shared"))
        opened = try acknowledge(store, opened, revision: 1)
        for revision in 2...12 {
            let edit = try edited(opened, "Shared \(revision)")
            let current = try store.save(edit)
            opened = try acknowledge(store, current, revision: revision)
            try store.merge([opened])
            XCTAssertTrue(try store.pendingNotes().isEmpty)
            XCTAssertEqual(try store.snapshot().notes.count, 1)
        }
        let stale = try edited(opened, "Phone " + opened.plainText)
        let remote = try edited(opened, opened.plainText + " Mac")
        try store.merge([remote]); _ = try store.save(stale)
        XCTAssertTrue(try XCTUnwrap(store.snapshot().notes[opened.id]).plainText.contains("Phone"))
        XCTAssertTrue(try XCTUnwrap(store.snapshot().notes[opened.id]).plainText.contains("Mac"))
        XCTAssertEqual(try store.snapshot().notes.count, 1)
    }
    func testAppAndExtensionMergeIndependentFields() throws {
        let (directory, app) = fixture()
        let share = Storage(directory: directory)
        let base = try app.save(Note.text("Shared"))
        var pin = base; pin.pinned = true
        var tags = base; tags.tags = ["Ideas"]
        _ = try app.save(pin); _ = try share.save(tags)
        let final = try XCTUnwrap(app.snapshot().notes[base.id])
        XCTAssertTrue(final.pinned); XCTAssertEqual(final.tags, ["Ideas"])
        XCTAssertEqual(try app.snapshot().notes.count, 1)
    }
    func testMetadataSaveDoesNotGenerateAnotherEditWhenUnchanged() throws {
        let (_, store) = fixture()
        let original = try store.save(Note.text("Shared"))
        let server = try acknowledge(store, original, revision: 1)
        _ = try store.save(server)
        XCTAssertTrue(try store.pendingNotes().isEmpty)
        var pinned = server; pinned.pinned = true
        let saved = try store.save(pinned)
        XCTAssertEqual(try store.journal(saved.id).count, 1)
        XCTAssertTrue(saved.pinned)
    }
    func testPullAndCursorCommitWithoutClearingOfflineChanges() throws {
        let (directory, store) = fixture()
        let base = try store.save(Note.text("Shared"))
        let remote = try edited(base, "Shared remote")
        try store.merge([remote], cursor: 42)
        XCTAssertEqual(try Storage(directory: directory).cursor(), 42)
        XCTAssertFalse(try store.journal(base.id).isEmpty)
        XCTAssertEqual(try store.snapshot().notes[base.id]?.plainText, "Shared remote")
    }
    func testUpgradeRetainsLegacyPendingSnapshotAndOriginalFile() throws {
        let (directory, store) = fixture()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var note = Note.text("Old pending"); note.revision = 8
        var state = DiskState(); state.notes[note.id] = note; state.dirty = [note.id]
        let bytes = try JSONEncoder().encode(state)
        let backup = directory.appendingPathComponent("notes.json"); try bytes.write(to: backup)
        XCTAssertEqual(try store.pendingNotes().count, 1)
        XCTAssertEqual(try XCTUnwrap(store.journal(note.id).first?.legacy).note, note)
        XCTAssertEqual(try Data(contentsOf: backup), bytes)
    }
}
