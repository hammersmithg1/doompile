import XCTest
@testable import DoompileCore

final class NoteContractTests: XCTestCase {
    func testLegacyCaptureAttachmentsAreRecoveredWithoutDuplicates() throws {
        let image = Attachment(id: UUID().uuidString.lowercased(), name: "photo.png", mimeType: "image/png", url: "local:photo", size: 100)
        let pdf = Attachment(id: UUID().uuidString.lowercased(), name: "document.pdf", mimeType: "application/pdf", url: "local:pdf", size: 200)
        let body = JSONValue.document("Comment")
        let recovered = body.includingAttachments([image, pdf])
        XCTAssertEqual(recovered.includingAttachments([image, pdf]), recovered)
        guard case .object(let doc) = recovered, case .array(let content) = doc["content"] else { return XCTFail("Missing document") }
        XCTAssertEqual(content.count, 3)
        XCTAssertEqual(content.first, {
            guard case .object(let original) = body, case .array(let nodes) = original["content"] else { return JSONValue.null }
            return nodes[0]
        }())
        var deletedDocument = doc
        deletedDocument["content"] = .array([content[0]])
        let deleted = JSONValue.object(deletedDocument)
        XCTAssertEqual(deleted.includingAttachments([image, pdf]), deleted, "Do not restore media the user subsequently deleted")
        let uploaded = recovered.replacingString(image.url, with: "/api/attachments/" + image.id)
        var remote = image; remote.url = "/api/attachments/" + image.id
        XCTAssertEqual(uploaded.includingAttachments([remote, pdf]), uploaded)
    }

    func testSameWireLimitsAsTypeScript() throws {
        struct Fixture: Decodable {
            let name: String
            let title: String?
            let titleLength: Int?
            let tags: [String]?
            let tagLength: Int?
            let attachmentCount: Int
            let valid: Bool
        }
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let cases = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: root.appendingPathComponent("packages/core/test-fixtures/note-contract.json")))
        for item in cases {
            var note = Note()
            note.title = item.titleLength.map { String(repeating: "x", count: $0) } ?? item.title ?? ""
            note.tags = item.tagLength.map { [String(repeating: "x", count: $0)] } ?? item.tags ?? []
            note.attachments = (0..<item.attachmentCount).map { _ in
                let id = UUID().uuidString.lowercased()
                return Attachment(id: id, name: "file", mimeType: "application/octet-stream", url: "/api/attachments/" + id, size: 1)
            }
            if item.valid { XCTAssertNoThrow(try NoteValidation.validate(note), item.name) }
            else { XCTAssertThrowsError(try NoteValidation.validate(note), item.name) }
        }
    }
    func testNormalizationKeepsAuthoredTextAndFutureBlocks() {
        var note = Note.text(String(repeating: "x", count: NoteLimits.title + 1))
        note.title = note.plainText
        note.body = .object(["type": .string("doc"), "content": .array([.object(["type": .string("futureWidget"), "attrs": .object(["value": .number(42)])])])])
        note.tags = [" idea ", "idea"]
        let value = NoteValidation.normalized(note)
        XCTAssertEqual(value.title.utf16.count, NoteLimits.title)
        XCTAssertEqual(value.plainText, note.plainText)
        XCTAssertEqual(value.body, note.body)
        XCTAssertEqual(value.tags, ["idea"])
    }
    func testTitleTruncationKeepsUnicodeValid() throws {
        var note = Note.text("Original text")
        note.title = String(repeating: "a", count: NoteLimits.title - 1) + "😀"
        let normalized = NoteValidation.normalized(note)
        XCTAssertEqual(normalized.title.utf16.count, NoteLimits.title - 1)
        XCTAssertEqual(normalized.plainText, note.plainText)
        XCTAssertNoThrow(try JSONDecoder().decode(Note.self, from: JSONEncoder().encode(normalized)))
    }

}
