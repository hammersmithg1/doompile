import XCTest
@testable import DoompileCore
final class NoteLinkTests: XCTestCase {
    struct Fixture: Decodable { let name: String; let url: String; let expected: String? }
    func testCrossPlatformLinks() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../packages/core/test-fixtures/note-links.json").standardizedFileURL
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: file))
        let origins = [URL(string: "https://notes.example.test")!, URL(string: "http://localhost:3000")!]
        for fixture in fixtures {
            XCTAssertEqual(NoteLinks.noteID(in: try XCTUnwrap(URL(string: fixture.url)), allowedOrigins: origins), fixture.expected, fixture.name)
        }
    }
    func testWebLinksRequireTheConfiguredOrigin() throws {
        let id = "a6ad6431-ad38-4533-92a0-c337487ef00b"
        let base = URL(string: "https://notes.example.test")!
        for value in ["https://other.example/notes/" + id, "https://notes.example.test:444/notes/" + id, "http://notes.example.test/notes/" + id] {
            XCTAssertNil(NoteLinks.noteID(in: URL(string: value)!, allowedOrigins: [base]))
        }
        XCTAssertEqual(NoteLinks.webURL(id: id, origin: base.absoluteString)?.absoluteString, base.absoluteString + "/notes/" + id)
        XCTAssertEqual(NoteLinks.appURL(id: id)?.absoluteString, "doompile://note/" + id)
        XCTAssertNil(NoteLinks.webURL(id: id, origin: "https://user:password@notes.example.test"))
        XCTAssertNil(NoteLinks.webURL(id: "../other", origin: base.absoluteString))
    }
    @MainActor func testOpenLinkWaitsForEditorsWithoutReplacingAnUnsavedNote() async {
        let a = UUID(), b = UUID()
        var writes = 0
        NoteLinkEditors.register(a) { writes += 1; return true }
        NoteLinkEditors.register(b) { writes += 1; return true }
        let saved = await NoteLinkEditors.prepare()
        XCTAssertTrue(saved); XCTAssertEqual(writes, 2)
        NoteLinkEditors.unregister(a); NoteLinkEditors.unregister(b)
        NoteLinkEditors.register(a) { false }
        let rejected = await NoteLinkEditors.prepare()
        XCTAssertFalse(rejected)
        NoteLinkEditors.unregister(a)
    }
}
