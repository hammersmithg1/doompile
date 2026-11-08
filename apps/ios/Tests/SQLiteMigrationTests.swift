import XCTest
import UniformTypeIdentifiers
@testable import DoompileCore

final class SQLiteMigrationTests: XCTestCase {
    func testLegacyMigrationPreservesQueueFilesAndOriginalBackup() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var pending = Note.text("Pending")
        let clean = Note.text("Synced")
        let file = Attachment(id: UUID().uuidString.lowercased(), name: "old.txt", mimeType: "text/plain", url: "local:old", size: 3)
        pending.attachments = [file]
        var legacy = DiskState()
        legacy.notes = [pending.id:pending, clean.id:clean]; legacy.dirty = [pending.id]
        legacy.files = [file.id: LocalFile(filename:"old.txt",mimeType:"text/plain")]
        let original = try JSONEncoder().encode(legacy)
        let backup = directory.appendingPathComponent("notes.json")
        try original.write(to: backup)
        let store = Storage(directory: directory)
        let state = try store.snapshot()
        XCTAssertEqual(state.notes,legacy.notes)
        XCTAssertEqual(state.dirty,legacy.dirty)
        XCTAssertEqual(store.fileURL(file)?.lastPathComponent,"old.txt")
        let next = Note.text("New database write")
        try store.save(next)
        XCTAssertEqual(try Data(contentsOf:backup),original,"Migration retains the untouched original as a backup")
        XCTAssertEqual(try Storage(directory:directory).snapshot().notes.count,3)
    }
    func testThousandsOfSyncedNotesAreNotDecodedAgainForEachSave() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:directory)}
        var legacy = DiskState()
        for index in 0..<2000 { let note=Note.text("Note \(index)"); legacy.notes[note.id]=note }
        try JSONEncoder().encode(legacy).write(to:directory.appendingPathComponent("notes.json"))
        let store=Storage(directory:directory)
        XCTAssertTrue(try store.pendingNotes().isEmpty)
        XCTAssertEqual(store.decodedSnapshotNotes,0,"Capture-only sync does not load the collection")
        XCTAssertEqual(try store.snapshot().notes.count,2000)
        XCTAssertEqual(store.decodedSnapshotNotes,2000)
        let note=Note.text("One new note")
        try store.save(note)
        XCTAssertEqual(try store.snapshot().notes.count,2001)
        XCTAssertEqual(store.decodedSnapshotNotes,2001,"Only the changed row is read after the initial load")
        let other=Storage(directory:directory)
        var edited=note; edited.plainText="Other process edit"
        try other.save(edited)
        XCTAssertEqual(try store.snapshot().notes[note.id]?.plainText,edited.plainText)
        XCTAssertEqual(store.decodedSnapshotNotes,2002,"Another connection invalidates only the changed row")
    }
    func testUploadCheckpointRetainsTypingAndMakesLostPutResponseRetryStable() throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store=Storage(directory:directory)
        defer{try? FileManager.default.removeItem(at:directory)}
        var note=Note.text("Before")
        let local=try store.addFile(Data("abc".utf8),name:"file.txt",mimeType:"text/plain")
        note.attachments=[local]
        try store.save(note)
        var newer=note; newer.plainText="Typing during upload"; try store.save(newer)
        var uploaded=note; uploaded.attachments[0].url="/api/attachments/"+local.id
        let checkpoint=try store.checkpointUploads(uploaded,matching:note)
        XCTAssertEqual(checkpoint.plainText,newer.plainText)
        XCTAssertEqual(checkpoint.attachments[0].url,uploaded.attachments[0].url)
        let reopened=try Storage(directory:directory).snapshot()
        XCTAssertEqual(reopened.notes[note.id],checkpoint)
        XCTAssertTrue(reopened.dirty.contains(note.id))
        var server=checkpoint; server.revision=1
        try store.accept(server,matching:checkpoint)
        XCTAssertFalse(try store.snapshot().dirty.contains(note.id))
    }
    func testLocalMediaReadsStoredMIMEBeforeAttachmentIsAddedToNote() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = Storage(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bytes = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV4sAAAAASUVORK5CYII="))
        let attachment = try store.addFile(bytes, name: "pasted.png", mimeType: "image/png")
        let file = try XCTUnwrap(store.localFile(id: attachment.id))
        XCTAssertEqual(file.mimeType, "image/png")
        XCTAssertEqual(try Data(contentsOf: file.url), bytes)
        XCTAssertEqual(EditorImagePaste.contentType(of: bytes)?.preferredMIMEType, "image/png")
    }
}
