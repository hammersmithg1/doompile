import Foundation
import XCTest
@testable import DoompileMacSupport

final class MacBehaviorTests: XCTestCase {
    func testTypingInQuickComposerPreservesMediaAndRecordingRecoveryMarker() {
        var note = Note.text("Original")
        let file = Attachment(id: UUID().uuidString.lowercased(), name: "Voice.m4a", mimeType: "audio/mp4", url: "local:" + UUID().uuidString.lowercased(), size: 100)
        note.attachments = [file]
        note.body = note.body.finishingRecording("recording-one", attachment: file)
        let edited = MacQuickDocument.updating(note, text: "New text\nSecond line")
        XCTAssertEqual(edited.id, note.id); XCTAssertEqual(edited.createdAt, note.createdAt)
        XCTAssertEqual(edited.attachments, [file]); XCTAssertEqual(edited.plainText, "New text\nSecond line")
        XCTAssertTrue(edited.body.hasFinishedRecording("recording-one"))
        XCTAssertTrue(EditorLifecycle.shouldSave(MacQuickDocument.updating(edited, text: ""), existing: false))
        XCTAssertFalse(MacQuickDocument.needsRichEditor(edited))
        XCTAssertEqual(MacQuickDocument.referencedFiles(in: edited), [file])
        var afterRemoval = edited
        afterRemoval.body = .document("New text")
        XCTAssertTrue(MacQuickDocument.referencedFiles(in: afterRemoval).isEmpty)
        XCTAssertEqual(afterRemoval.attachments, [file])
    }
    func testTimelineReturnsToCreationDateAfterFlagsChange() {
        var older = Note.text("Older"); older.createdAt = "2026-10-01T12:00:00.000Z"
        var newer = Note.text("Newer"); newer.createdAt = "2026-10-02T12:00:00.000Z"
        older.pinned = true
        XCTAssertEqual(MacFeedSection.make([newer, older]).first?.id, "pinned")
        older.pinned = false; older.urgent = true
        XCTAssertEqual(MacFeedSection.make([newer, older]).flatMap(\.notes).map(\.id), [newer.id])
        older.urgent = false; older.updatedAt = Note.now()
        XCTAssertEqual(MacFeedSection.make([older, newer]).flatMap(\.notes).map(\.id), [newer.id, older.id])
    }
    func testSectionsUseLocalDaysAndStableTieBreaking() {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 3 * 3600)!
        var one = Note.text("One"); one.id = "00000000-0000-0000-0000-000000000001"; one.createdAt = "2026-10-30T22:00:00.000Z"
        var two = one; two.id = "00000000-0000-0000-0000-000000000002"
        let result = MacFeedSection.make([one, two], now: MacDates.date("2026-10-31T00:00:00.000Z")!, calendar: calendar)
        XCTAssertEqual(result.count, 1); XCTAssertEqual(result.first?.title, "Сегодня")
        XCTAssertEqual(result.first?.notes.map(\.id), [two.id, one.id])
    }
    func testCapturePreviewDoesNotRepeatSource() {
        var note = Note.text("Мой комментарий")
        note.source = NoteSource(url: "https://example.com/article", title: "Article", quote: "A quotation")
        XCTAssertEqual(MacPreview.text(for: note), "Мой комментарий")
        XCTAssertTrue(MacPreview.hasContent(note))
    }
    func testStructuredPreviewKeepsChecklistAndReferences() {
        let document = try! JSONDecoder().decode(JSONValue.self, from: Data(#"{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Milk"}]}]}]},{"type":"paragraph","content":[{"type":"noteReference","attrs":{"id":"00000000-0000-0000-0000-000000000001","title":"Ideas"}}]}]}"#.utf8))
        XCTAssertEqual(MacPreview.text(document), "☑ Milk\n@Ideas")
    }
    func testCaptureDraftPreservesRichDocumentAndIdentity() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("doompile-mac-test-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MacCaptureDraftStore(directory: directory)
        XCTAssertNil(try store.load())
        var note = Note.text("Comment"); note.tags = ["Ideas", "Work"]; note.urgent = true; note.pinned = true
        note.source = NoteSource(url: "https://youtube.com/watch?v=example&t=83", quote: "Quote", timestampSeconds: 83)
        note.body = note.editorDocument
        note.attachments = [Attachment(id: UUID().uuidString.lowercased(), name: "Voice.m4a", mimeType: "audio/mp4", url: "local:" + UUID().uuidString.lowercased(), size: 128)]
        try store.save(note)
        XCTAssertEqual(try store.load(), note)
        let recovered = try XCTUnwrap(store.load())
        var edited = recovered; edited.tags.append("Later"); try store.save(edited)
        XCTAssertEqual(try store.load()?.id, note.id)
        XCTAssertEqual(try store.load()?.body, note.body)
        try store.clear(); XCTAssertNil(try store.load()); try store.clear()
    }
    func testCorruptDraftIsReportedAndNotRemoved() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("doompile-mac-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MacCaptureDraftStore(directory: directory), bytes = Data("corrupt draft".utf8)
        try bytes.write(to: store.url)
        XCTAssertThrowsError(try store.load())
        XCTAssertEqual(try Data(contentsOf: store.url), bytes)
        try store.save(Note.text("A new draft"))
        let recovery = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first { $0.lastPathComponent.hasPrefix("mac-quick-capture-recovery-") })
        XCTAssertEqual(try Data(contentsOf: recovery), bytes)
    }
    func testClosePolicyIsTheSharedNativePolicy() {
        XCTAssertFalse(MacPreview.hasContent(Note()))
        XCTAssertTrue(MacPreview.hasContent(Note.text("Draft before editor ready")))
        var table = Note(); table.body = .object(["type": .string("doc"), "content": .array([.object(["type": .string("table")])])])
        XCTAssertTrue(MacPreview.hasContent(table))
        XCTAssertEqual(MacPreview.hasContent(table), EditorLifecycle.shouldSave(table, existing: false))
    }
    func testShortcutPersistenceAndDisableSurviveRestart() throws {
        let suite = "doompile-shortcut-test-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertEqual(CaptureShortcut.load(from: defaults), .standard)
        let custom = CaptureShortcut(keyCode: 45, modifiers: [.control, .option], key: "N")
        try CaptureShortcut.persist(custom, in: defaults)
        XCTAssertEqual(CaptureShortcut.load(from: defaults), custom)
        try CaptureShortcut.persist(nil, in: defaults)
        XCTAssertNil(CaptureShortcut.load(from: defaults))
        try CaptureShortcut.persist(.standard, in: defaults)
        XCTAssertEqual(CaptureShortcut.load(from: defaults), .standard)
    }
    func testInvalidShortcutDoesNotReplaceExistingPreference() throws {
        let suite = "doompile-shortcut-test-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let valid = CaptureShortcut(keyCode: 45, modifiers: [.control, .option], key: "N")
        try CaptureShortcut.persist(valid, in: defaults)
        let invalid = CaptureShortcut(keyCode: 45, modifiers: [.shift], key: "N")
        XCTAssertThrowsError(try CaptureShortcut.persist(invalid, in: defaults))
        XCTAssertEqual(CaptureShortcut.load(from: defaults), valid)
        XCTAssertNotNil(CaptureShortcut(keyCode: 12, modifiers: [.command], key: "Q").validationError)
        XCTAssertNotNil(CaptureShortcut(keyCode: 53, modifiers: [.command, .shift], key: "Esc").validationError)
        XCTAssertNotNil(CaptureShortcut(keyCode: 0, modifiers: .init(rawValue: 1024), key: "A").validationError)
        XCTAssertNil(CaptureShortcut.standard.validationError)
    }
}
