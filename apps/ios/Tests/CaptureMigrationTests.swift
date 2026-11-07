import XCTest
@testable import DoompileCore

final class CaptureMigrationTests: XCTestCase {
    func testLegacyCaptureKeepsOneSourceAndPreservesCommentAndPDF() throws {
        let quote: JSONValue = .object(["type": .string("blockquote"), "content": .array([.object(["type": .string("paragraph"), "content": .array([.object(["type": .string("text"), "text": .string("Exact quotation")])])])])])
        let heading: JSONValue = .object(["type": .string("heading"), "content": .array([.object(["type": .string("text"), "text": .string("Page title")])])])
        let source: JSONValue = .object(["type": .string("sourceSnippet"), "attrs": .object(["url": .string("https://example.com"), "title": .string("Page title"), "quote": .string("Exact quotation")])])
        let comment: JSONValue = .object(["type": .string("paragraph"), "content": .array([.object(["type": .string("text"), "text": .string("My comment")])])])
        let file: JSONValue = .object(["type": .string("attachment"), "attrs": .object(["url": .string("/api/attachments/example"), "name": .string("Saved.pdf")])])
        for versioned in [false, true] {
            var note = Note.text("My comment")
            note.title = "Page title"
            var metadata = NoteSource(url: "https://example.com")
            metadata.title = "Page title"; metadata.quote = "Exact quotation"; note.source = metadata
            let prefix = versioned ? [source, heading] : []
            var doc: [String: JSONValue] = ["type": .string("doc"), "content": .array(prefix + [quote, comment, file])]
            if versioned { doc["attrs"] = .object(["editorVersion": .number(1)]) }
            note.body = .object(doc)
            let migrated = note.editorDocument
            guard case .object(let result) = migrated, case .array(let nodes) = result["content"] else { return XCTFail("Expected document") }
            XCTAssertEqual(nodes, [source, comment, file])
            note.body = migrated
            XCTAssertEqual(note.editorDocument, migrated)
        }
    }
}
