import XCTest
@testable import DoompileCore

final class CoreTests: XCTestCase {
    func testServerMoveUsesNewAddressWithExistingAccountScope() {
        let old = "https://old.example.com", current = "https://notes.example.com", custom = "https://custom.example.com"
        let original = Connection.Origins(current: old, previous: nil)
        let moved = Connection.Origins(current: current, previous: old)
        let userID = "11111111-1111-4111-8111-111111111111"
        XCTAssertEqual(moved.networkEndpoint(old), current)
        XCTAssertEqual(moved.networkEndpoint(custom), custom)
        XCTAssertEqual(moved.scope(endpoint: current, userID: userID), original.scope(endpoint: old, userID: userID))
        XCTAssertEqual(moved.scope(endpoint: custom, userID: userID), original.scope(endpoint: custom, userID: userID))
        XCTAssertNotEqual(moved.scope(endpoint: current, userID: userID), moved.scope(endpoint: custom, userID: userID))
    }

    func testManualSourceCardSuppliesMetadataAndTitleWithoutPlainText() throws {
        var note = Note.text("")
        note.body = .object(["type": .string("doc"), "content": .array([.object(["type": .string("sourceSnippet"), "attrs": .object(["url": .string("https://example.com/article"), "title": .string("Article"), "quote": .string("Exact quote")])])])])
        XCTAssertEqual(note.editorSource?.url, "https://example.com/article")
        XCTAssertEqual(note.editorSource?.quote, "Exact quote")
        XCTAssertEqual(note.editorTitle, "Article")
        note.source = NoteSource(url: "https://original.example", title: "Original", quote: "Original capture")
        XCTAssertEqual(note.editorSource, note.source)
    }
    func testEditorMigrationPreservesTitleAndSourceAndIsIdempotent() throws {
        var note = Note.text("Annotation")
        note.title = "Legacy title"
        note.source = NoteSource(url: "https://example.com", title: "Article", quote: "Exact quote", timestampSeconds: 0)
        note.body = note.editorDocument
        let first = note.body
        XCTAssertEqual(note.editorDocument, first)
        XCTAssertEqual(note.editorTitle, "Legacy title")
        let json = String(data: try JSONEncoder().encode(first), encoding: .utf8)!
        XCTAssertTrue(json.contains("sourceSnippet"))
        XCTAssertTrue(json.contains("Legacy title"))
        XCTAssertEqual(note.source?.quote, "Exact quote")
    }
    func testEditorDoesNotRecreateDeletedSnippetOrTitle() {
        var note = Note.text("old")
        note.source = NoteSource(url: "https://example.com", quote: "quote")
        note.body = .object(["type": .string("doc"), "attrs": .object(["editorVersion": .number(1)]), "content": .array([])])
        XCTAssertEqual(note.editorDocument, note.body)
    }
    func testUntitledEditorDoesNotInventHeading() throws {
        let note = Note.text("Content")
        let json = String(data: try JSONEncoder().encode(note.editorDocument), encoding: .utf8)!
        XCTAssertFalse(json.contains("heading"))
        XCTAssertEqual(note.editorTitle, "Content")
    }
    func testRecordingCompletionKeepsItsListItemAndHasDurableMetadata() {
        let attachment = Attachment(id: UUID().uuidString.lowercased(), name: "Voice.m4a", mimeType: "audio/mp4", url: "local:voice", size: 400)
        let body: JSONValue = .object(["type": .string("doc"), "content": .array([.object(["type": .string("bulletList"), "content": .array([.object(["type": .string("listItem"), "content": .array([.object(["type": .string("paragraph")]), .object(["type": .string("recording"), "attrs": .object(["id": .string("rec")])])])])])])])])
        let completed = body.finishingRecording("rec", attachment: attachment)
        XCTAssertTrue(completed.hasFinishedRecording("rec")); XCTAssertEqual(completed.finishingRecording("rec", attachment: attachment), completed)
        guard case .object(let doc) = completed, case .array(let lists) = doc["content"], case .object(let list) = lists[0], case .array(let items) = list["content"], case .object(let item) = items[0], case .array(let children) = item["content"], case .object(let media) = children[1], case .object(let attrs) = media["attrs"] else { return XCTFail("Recording must remain in its list item") }
        XCTAssertEqual(lists.count, 1); XCTAssertEqual(media["type"], .string("attachment")); XCTAssertEqual(attrs["size"], .number(400)); XCTAssertEqual(attrs["recordingId"], .string("rec"))
    }
    func testRecordingCompletionWithoutPlaceholderAppendsInlineAudioAndPreservesText() {
        let attachment = Attachment(id: UUID().uuidString.lowercased(), name: "Voice.m4a", mimeType: "audio/mp4", url: "local:voice", size: 400)
        let body = JSONValue.document("Draft text")
        let completed = body.finishingRecording("rec", attachment: attachment)
        guard case .object(let original) = body, case .array(let originalContent) = original["content"],
              case .object(let document) = completed, case .array(let content) = document["content"],
              case .object(let paragraph) = content.last, case .array(let children) = paragraph["content"],
              case .object(let media) = children.first, case .object(let attrs) = media["attrs"] else {
            return XCTFail("An inline recording attachment must be nested in a paragraph")
        }
        XCTAssertEqual(content.dropLast(), originalContent[...])
        XCTAssertEqual(paragraph["type"], .string("paragraph"))
        XCTAssertEqual(media["type"], .string("attachment"))
        XCTAssertEqual(attrs["id"], .string(attachment.id))
        XCTAssertTrue(completed.hasFinishedRecording("rec"))
    }
    func testYouTubeTimecodes() {
        XCTAssertEqual(Note.timestamp(from: URL(string: "https://youtu.be/abc?t=1h2m3s")!), 3723)
        XCTAssertEqual(Note.timestamp(from: URL(string: "https://youtube.com/watch?v=abc&t=754")!), 754)
        XCTAssertEqual(Note.parseTimestamp("12:34"), 754)
        XCTAssertNil(Note.parseTimestamp("banana"))
        XCTAssertNil(Note.parseTimestamp("-1"))
        XCTAssertNil(Note.parseTimestamp("inf"))
        XCTAssertNil(Note.parseTimestamp("1::2"))
        XCTAssertNil(Note.parseTimestamp("inf:1"))
        XCTAssertEqual(Note.timeLabel(754), "12:34")
    }
    func testCodablePreservesRichDocument() throws {
        let data = Data("{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"bold\",\"marks\":[{\"type\":\"bold\"}]}]}]}".utf8)
        let body = try JSONDecoder().decode(JSONValue.self, from: data)
        var note = Note.text("bold")
        note.body = body
        let copy = try JSONDecoder().decode(Note.self, from: JSONEncoder().encode(note))
        XCTAssertEqual(note.body, copy.body)
        XCTAssertEqual(note.id, copy.id)
        XCTAssertFalse(copy.body.isPlainParagraphDocument)
        XCTAssertTrue(Note.text("Plain\nparagraphs").body.isPlainParagraphDocument)
    }
    func testAppAndShareStoreDoNotOverwriteEachOther() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = Storage(directory: directory)
        let share = Storage(directory: directory)
        let first = Note.text("App")
        let second = Note.text("Share")
        try app.save(first)
        try share.save(second)
        XCTAssertEqual(try app.snapshot().notes.count, 2)
        XCTAssertEqual(try share.snapshot().dirty.count, 2)
    }
    func testSourceAnchorSurvivesNativeMetadataEdits() throws {
        let selector: JSONValue = .object([
            "type": .string("TextQuoteSelector"),
            "exact": .string("the useful fragment"),
            "prefix": .string("before "),
            "suffix": .string(" after"),
        ])
        var original = Note.text("My annotation")
        original.source = NoteSource(url: "https://example.com/article", quote: "the useful fragment", selector: selector)
        var edited = try JSONDecoder().decode(Note.self, from: JSONEncoder().encode(original))
        edited.tags = ["Reading", "Ideas"]
        edited.urgent = true
        let result = try JSONDecoder().decode(Note.self, from: JSONEncoder().encode(edited))
        XCTAssertEqual(result.source?.selector, selector)
        XCTAssertEqual(result.source?.quote, original.source?.quote)
        XCTAssertEqual(result.tags, ["Reading", "Ideas"])
    }
    func testAnEditMadeDuringUploadStaysPending() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = Storage(directory: directory)
        let original = Note.text("Before")
        try store.save(original)
        var newer = original
        newer.plainText = "After"
        newer.updatedAt = "2026-10-29T23:00:00.000Z"
        try store.save(newer)
        var response = original
        response.revision = 1
        try store.accept(response, matching: original)
        let state = try store.snapshot()
        XCTAssertEqual(state.notes[original.id]?.plainText, "After")
        XCTAssertEqual(state.notes[original.id]?.revision, 1)
        XCTAssertTrue(state.dirty.contains(original.id))
    }
    func testConflictPreservesBothCopies() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = Storage(directory: directory)
        let local = Note.text("Phone text")
        try store.save(local)
        var remote = local
        remote.plainText = "Web text"
        remote.revision = 5
        try store.conflict(local: local, server: remote)
        let state = try store.snapshot()
        XCTAssertEqual(state.notes.count, 2)
        XCTAssertEqual(state.notes[local.id]?.plainText, "Web text")
        XCTAssertEqual(state.notes.values.first { $0.id != local.id }?.plainText, "Phone text")
        XCTAssertEqual(state.dirty.count, 1)
    }
    func testUploadedMediaURLsFollowConcurrentEdits() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = Storage(directory: directory)
        var original = Note.text("Before")
        let attachment = Attachment(id: UUID().uuidString.lowercased(), name: "Image.png", mimeType: "image/png", url: "local:abc", size: 10)
        original.attachments = [attachment]
        original.body = .object(["type": .string("doc"), "content": .array([.object(["type": .string("image"), "attrs": .object(["src": .string(attachment.url)])])])])
        try store.save(original)
        var newer = original
        newer.plainText = "A newer caption"
        newer.updatedAt = "2026-10-29T23:00:00.000Z"
        try store.save(newer)
        var server = original
        server.revision = 1
        server.attachments[0].url = "/api/attachments/uploaded-id"
        server.body = original.body.replacingString(attachment.url, with: server.attachments[0].url)
        try store.accept(server, matching: original)
        let state = try store.snapshot()
        XCTAssertEqual(state.notes[original.id]?.plainText, "A newer caption")
        XCTAssertEqual(state.notes[original.id]?.body, server.body)
        XCTAssertTrue(state.dirty.contains(original.id))
    }
    func testSyncLeaseIsExclusive() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = Storage(directory: directory)
        let share = Storage(directory: directory)
        let first = try XCTUnwrap(app.acquireSyncLock())
        XCTAssertNil(share.acquireSyncLock())
        app.releaseSyncLock(first)
        let next = try XCTUnwrap(share.acquireSyncLock())
        share.releaseSyncLock(next)
    }
    func testSuspendedSyncLeaseExpiresAndOldOwnerCannotReleaseNewOwner() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = Storage(directory: directory), share = Storage(directory: directory)
        let start = Date(timeIntervalSince1970: 1000)
        let first = try XCTUnwrap(app.acquireSyncLock(now: start))
        // Holding the lease must not hold a SQLite write transaction while awaiting network.
        let captured = Note.text("Captured by another process")
        try share.save(captured)
        XCTAssertEqual(try app.snapshot().notes[captured.id], captured)
        XCTAssertTrue(app.renewSyncLock(first, now: start.addingTimeInterval(2)))
        XCTAssertNil(share.acquireSyncLock(now: start.addingTimeInterval(7)))
        let next = try XCTUnwrap(share.acquireSyncLock(now: start.addingTimeInterval(9)))
        XCTAssertFalse(app.renewSyncLock(first, now: start.addingTimeInterval(10)))
        app.releaseSyncLock(first)
        XCTAssertTrue(share.renewSyncLock(next, now: start.addingTimeInterval(10)))
        XCTAssertNil(app.acquireSyncLock(now: start.addingTimeInterval(11)))
        share.releaseSyncLock(next)
        XCTAssertNotNil(app.acquireSyncLock(now: start.addingTimeInterval(11)))
    }
    func testStoppedSyncHeartbeatReleasesQueueWithinSeconds() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = Storage(directory: directory), share = Storage(directory: directory)
        let start = Date(timeIntervalSince1970: 1000)
        let first = try XCTUnwrap(app.acquireSyncLock(now: start))
        // A live upload may run longer than the lease; heartbeats keep its ownership.
        for second in 1...20 {
            let now = start.addingTimeInterval(Double(second))
            XCTAssertTrue(app.renewSyncLock(first, now: now))
            XCTAssertNil(share.acquireSyncLock(now: now))
        }
        // Simulate force quit/suspension: no heartbeat, no five-minute exclusion.
        let fresh = try XCTUnwrap(share.acquireSyncLock(now: start.addingTimeInterval(27)))
        XCTAssertFalse(app.renewSyncLock(first, now: start.addingTimeInterval(28)))
        app.releaseSyncLock(first)
        XCTAssertTrue(share.renewSyncLock(fresh, now: start.addingTimeInterval(28)))
        share.releaseSyncLock(fresh)
    }
    func testLegacyVersionNineLeaseDoesNotDelayFirstSyncAfterUpgrade() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let db = try SQLiteNotes(directory: directory)
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertTrue(try db.acquireSyncLease(owner: UUID().uuidString, now: start, duration: 300))
        let app = Storage(directory: directory)
        let owner = try XCTUnwrap(app.acquireSyncLock(now: start.addingTimeInterval(1)))
        app.releaseSyncLock(owner)
    }
    func testSavingAnIdenticalAcknowledgedNoteDoesNotRequeueIt() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = Storage(directory: directory)
        let original = Note.text("Unchanged reading")
        try store.save(original)
        var server = original; server.revision = 1
        try store.accept(server, matching: original)
        try store.save(server)
        XCTAssertTrue(try store.pendingNotes().isEmpty)
        var edited = server; edited.plainText = "Authored edit"
        try store.save(edited)
        XCTAssertEqual(try store.pendingNotes().map(\.id), [edited.id])
    }
    func testKnownUploadAcknowledgementPreservesNewerTyping() throws {
        var saved = Note.text("Saved caption")
        saved.attachments = [Attachment(id: "file-id", name: "photo.png", mimeType: "image/png", url: "local:file-id", size: 12)]
        saved.body = .object(["type": .string("doc"), "content": .array([.object(["type": .string("image"), "attrs": .object(["src": .string("local:file-id")])])])])
        var server = saved
        server.revision = 2
        server.attachments[0].url = "/api/attachments/remote-id"
        server.body = saved.body.replacingString("local:file-id", with: server.attachments[0].url)
        var current = saved
        current.title = "New title"
        current.plainText = "Newer typing"
        current.tags = ["Ideas"]
        current.body = .object(["type": .string("doc"), "content": .array([
            .object(["type": .string("paragraph"), "content": .array([.object(["type": .string("text"), "text": .string("Newer typing")])])]),
            .object(["type": .string("image"), "attrs": .object(["src": .string("local:file-id")])]),
        ])])
        let result = try XCTUnwrap(Note.acknowledging(saved: saved, server: server, current: current))
        XCTAssertEqual(result.note.revision, 2)
        XCTAssertEqual(result.note.title, "New title")
        XCTAssertEqual(result.note.plainText, "Newer typing")
        XCTAssertEqual(result.note.tags, ["Ideas"])
        XCTAssertEqual(result.note.attachments[0].url, server.attachments[0].url)
        XCTAssertEqual(result.note.body, current.body.replacingString("local:file-id", with: server.attachments[0].url))
        XCTAssertEqual(result.replacements, [MediaURLReplacement(from: "local:file-id", to: server.attachments[0].url)])
    }
    func testAcknowledgementDoesNotAdoptDivergentRemoteContent() {
        let saved = Note.text("Mine")
        var remote = saved
        remote.revision = 3
        remote.plainText = "Someone else's edit"
        XCTAssertNil(Note.acknowledging(saved: saved, server: remote, current: saved))
    }
    func testMetadataAcknowledgementMatchesSavedContentWithoutDraft() throws {
        var saved = Note.text("Metadata")
        saved.tags = ["Work"]
        var server = saved
        server.revision = 1
        let result = try XCTUnwrap(Note.acknowledging(saved: saved, server: server, current: saved))
        XCTAssertEqual(result.note, server)
        XCTAssertTrue(result.replacements.isEmpty)
    }
}
