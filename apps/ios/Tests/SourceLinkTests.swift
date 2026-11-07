import XCTest
@testable import DoompileCore
final class SourceLinkTests: XCTestCase {
    struct Fixture: Decodable { let name: String; let source: NoteSource; let expected: String }
    func testCrossPlatformSourceLinkFixtures() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../packages/core/test-fixtures/source-links.json").standardizedFileURL
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: file))
        for fixture in fixtures { XCTAssertEqual(fixture.source.navigationURL?.absoluteString ?? "", fixture.expected, fixture.name) }
    }
    func testExistingCaptureGetsContextWithoutRewritingItsStoredSource() throws {
        var note = Note.text("Comment")
        var source = NoteSource(url: "https://example.com/article")
        source.quote = "The quotation"
        source.selector = .object(["type": .string("TextQuoteSelector"), "exact": .string("The quotation"), "prefix": .string("Before"), "suffix": .string("After")])
        note.source = source
        note.body = .object(["type": .string("doc"), "attrs": .object(["editorVersion": .number(1), "captureVersion": .number(2)]), "content": .array([.object(["type": .string("sourceSnippet"), "attrs": .object(["url": .string(source.url), "quote": .string("The quotation")])])])])
        guard case .object(let doc) = note.editorDocument, case .array(let nodes) = doc["content"], case .object(let node) = nodes.first, case .object(let attrs) = node["attrs"] else { return XCTFail("Expected source") }
        XCTAssertEqual(attrs["quotePrefix"], .string("Before")); XCTAssertEqual(attrs["quoteSuffix"], .string("After"))
        XCTAssertEqual(note.source?.url, "https://example.com/article")
        XCTAssertTrue(note.sourceURL?.absoluteString.contains(":~:text=") == true)
    }
}
