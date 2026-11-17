import AppKit
import XCTest

@MainActor final class ComposerTests: XCTestCase {
    private final class SyncResponse: @unchecked Sendable {
        let ready = DispatchSemaphore(value: 0)
        var data: Data?
        var status: Int?
    }
    private func syncFixture(_ method: String = "GET", path: String = "/api/review/sync") throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18743" + path)!, timeoutInterval: 5)
        request.httpMethod = method
        let result = SyncResponse()
        URLSession.shared.dataTask(with: request) { data, response, _ in
            result.data = data; result.status = (response as? HTTPURLResponse)?.statusCode
            result.ready.signal()
        }.resume()
        guard result.ready.wait(timeout: .now() + 6) == .success,
              result.status == 200, let data = result.data else { throw URLError(.badServerResponse) }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func waitForSync(_ predicate: ([String: Any]) -> Bool) throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(20)
        repeat {
            let state = try syncFixture()
            if predicate(state) { return state }
            Thread.sleep(forTimeInterval: 0.15)
        } while Date() < deadline
        XCTFail("The isolated sync fixture did not reach the expected state")
        throw URLError(.timedOut)
    }
    func testOfflineEditsMergeAndHistoryRestoresSameNote() throws {
        _ = try syncFixture("POST", path: "/api/review/sync")
        defer { _ = try? syncFixture("POST", path: "/api/review/reset") }
        let originalID = try XCTUnwrap(try syncFixture()["originalID"] as? String)
        let app = launch()
        let window = app.windows.firstMatch
        let feed = app.scrollViews["Лента заметок"]
        let row = feed.staticTexts["Sync review"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.click()
        let editor = app.webViews["Редактор заметки"].textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        editor.click()
        app.typeKey(.downArrow, modifierFlags: .command)
        var expected = "Sync review"
        for suffix in [" one", " two", " three"] {
            editor.typeText(suffix); expected += suffix
            _ = try waitForSync { state in
                let notes = state["notes"] as? [[String: Any]] ?? []
                return notes.count == 1 && notes.first?["plainText"] as? String == expected
            }
        }
        capture("mac-sync-own-autosaves-editor", in: window)
        _ = try syncFixture("POST", path: "/api/review/offline")
        editor.typeText(" local"); expected += " local"
        capture("mac-sync-offline-editor", in: window)
        app.terminate(); app.launch()
        let cached = app.scrollViews["Лента заметок"].staticTexts[expected]
        XCTAssertTrue(cached.waitForExistence(timeout: 10)); cached.click()
        XCTAssertTrue(editor.waitForExistence(timeout: 8)); editor.click()
        app.typeKey(.downArrow, modifierFlags: .command)
        capture("mac-sync-offline-after-restart", in: app.windows.firstMatch)
        _ = try syncFixture("POST", path: "/api/review/remote")
        _ = try syncFixture("POST", path: "/api/review/online")
        editor.typeText(" newer"); expected += " newer"
        let merged = "Remote " + expected
        _ = try waitForSync { state in
            let notes = state["notes"] as? [[String: Any]] ?? []
            return notes.count == 1 && notes.first?["id"] as? String == originalID && notes.first?["plainText"] as? String == merged
        }
        capture("mac-sync-merged-one-note", in: window)
        let marker = try syncFixture("POST", path: "/api/review/marker")
        let markerRevision = try XCTUnwrap(marker["revision"] as? Int)
        editor.typeText(" final")
        _ = try waitForSync { state in
            let notes = state["notes"] as? [[String: Any]] ?? []
            return notes.count == 1 && (notes.first?["plainText"] as? String)?.contains(" final") == true
        }
        app.buttons["История версий"].click()
        let version = app.buttons["history-version-\(markerRevision)"]
        XCTAssertTrue(version.waitForExistence(timeout: 10))
        if !version.isHittable { app.scrollViews["Сохранённые версии"].scroll(byDeltaX: 0, deltaY: -300) }
        version.click()
        capture("mac-sync-history-preview", in: window)
        app.buttons["Восстановить версию"].click()
        _ = try waitForSync { state in
            let notes = state["notes"] as? [[String: Any]] ?? []
            return notes.count == 1 && notes.first?["id"] as? String == originalID && notes.first?["plainText"] as? String == merged
        }
        XCTAssertEqual(try syncFixture()["conflicts"] as? Int, 0)
        capture("mac-sync-history-restored-one-note", in: window)
    }
    private func launch(dark: Bool = false, global: Bool = false, attachment: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = [
            "DOOMPILE_MAC_UI_TESTING": "1",
            "DOOMPILE_MAC_UI_ROOT": FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path,
            "DOOMPILE_MAC_UI_ENDPOINT": "http://127.0.0.1:18743",
            "DOOMPILE_TEST_APPEARANCE": dark ? "dark" : "light",
            "DOOMPILE_MAC_CAPTURE_GLOBAL": global ? "1" : "0",
            "DOOMPILE_MAC_CAPTURE_ATTACHMENT": attachment ? "1" : "0",
            "DOOMPILE_MAC_VOICE_FIXTURE": "1",
        ]
        app.launch()
        return app
    }

    private func element(_ scope: XCUIElement, _ id: String) -> XCUIElement {
        scope.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func capture(_ name: String, in element: XCUIElement) {
        let attachment = XCTAttachment(screenshot: element.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func wait(_ format: String, for element: XCUIElement, timeout: TimeInterval = 8) {
        let condition = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [condition], timeout: timeout), .completed, format)
    }

    private func waitForLayout(_ condition: @escaping () -> Bool) {
        let layout = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [layout], timeout: 8), .completed)
    }

    private func paste(_ text: String, in app: XCUIApplication) {
        NSPasteboard.general.clearContents()
        XCTAssertTrue(NSPasteboard.general.setString(text, forType: .string))
        app.typeKey("v", modifierFlags: .command)
    }

    func testMainComposerGrowthAndCollapse() {
        let app = launch()
        let window = app.windows.firstMatch
        let feed = app.scrollViews["Лента заметок"]
        let input = element(window, "quick-composer-input")
        let expand = element(window, "quick-composer-expand")
        let collapse = element(window, "quick-composer-collapse")
        let send = element(window, "quick-composer-send")
        let saved = feed.popUpButtons["Меню заметки Main growth review"]
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        let idleHeight = feed.frame.height
        capture("mac-main-growth-idle-light", in: window)

        input.click()
        input.typeText("Main growth review")
        XCTAssertEqual(feed.frame.height, idleHeight, accuracy: 1)
        paste(String(repeating: " wrapped text", count: 24), in: app)
        waitForLayout { feed.frame.height < idleHeight - 20 }
        capture("mac-main-growth-wrapped-light", in: window)

        app.typeKey("a", modifierFlags: .command)
        let lines = ["Main growth review"] + (2...15).map { "Line \($0)" }
        paste(lines.joined(separator: "\n"), in: app)
        wait("value CONTAINS 'Line 15'", for: input)
        waitForLayout { feed.frame.height < idleHeight - 300 }
        let cappedHeight = feed.frame.height
        XCTAssertEqual(idleHeight - cappedHeight, 308, accuracy: 4)
        capture("mac-main-growth-15-lines-light", in: window)

        paste("\nLine 16\nEnd of draft", in: app)
        wait("value CONTAINS 'End of draft'", for: input)
        XCTAssertEqual(feed.frame.height, cappedHeight, accuracy: 2)
        capture("mac-main-growth-scroll-end-light", in: window)
        app.typeKey(.upArrow, modifierFlags: .command)
        capture("mac-main-growth-scroll-start-light", in: window)

        expand.click()
        XCTAssertTrue(collapse.waitForExistence(timeout: 8))
        wait("enabled == true", for: send)
        capture("mac-main-growth-expanded-light", in: window)
        collapse.click()
        XCTAssertTrue(expand.waitForExistence(timeout: 8))
        waitForLayout { abs(feed.frame.height - cappedHeight) < 5 }
        XCTAssertFalse(saved.exists)
        capture("mac-main-growth-collapsed-light", in: window)

        expand.click()
        XCTAssertTrue(collapse.waitForExistence(timeout: 8))
        wait("enabled == true", for: send)
        send.click()
        XCTAssertTrue(saved.waitForExistence(timeout: 8))
        XCTAssertEqual(feed.frame.height, idleHeight, accuracy: 1)
        capture("mac-main-growth-sent-light", in: window)
    }

    func testGlobalComposerGrowthAndCollapse() {
        let app = launch(dark: true, global: true, attachment: true)
        let panel = element(app, "quick-capture-panel")
        XCTAssertTrue(panel.waitForExistence(timeout: 8))
        let input = element(panel, "quick-composer-input")
        let expand = element(panel, "quick-composer-expand")
        let collapse = element(panel, "quick-composer-collapse")
        let send = element(panel, "quick-composer-send")
        let file = element(panel, "quick-composer-attachment")
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        XCTAssertTrue(file.exists)
        let idleHeight = panel.frame.height
        capture("mac-global-growth-attachment-dark", in: panel)

        input.click()
        input.typeText("Global growth review")
        app.typeKey(.return, modifierFlags: .shift)
        input.typeText("Second line")
        waitForLayout { panel.frame.height > idleHeight + 18 }
        XCTAssertEqual(panel.frame.height - idleHeight, 22, accuracy: 4)
        capture("mac-global-growth-multiline-dark", in: panel)

        paste("\n" + (3...15).map { "Line \($0)" }.joined(separator: "\n"), in: app)
        waitForLayout { panel.frame.height > idleHeight + 300 }
        let cappedHeight = panel.frame.height
        XCTAssertEqual(cappedHeight - idleHeight, 308, accuracy: 4)
        paste("\nLine 16\nEnd of global draft", in: app)
        wait("value CONTAINS 'End of global draft'", for: input)
        XCTAssertEqual(panel.frame.height, cappedHeight, accuracy: 2)
        capture("mac-global-growth-scroll-end-dark", in: panel)

        expand.click()
        XCTAssertTrue(collapse.waitForExistence(timeout: 8))
        wait("enabled == true", for: send)
        capture("mac-global-growth-expanded-dark", in: panel)
        collapse.click()
        XCTAssertTrue(expand.waitForExistence(timeout: 8))
        waitForLayout { abs(panel.frame.height - cappedHeight) < 5 }
        XCTAssertTrue(file.exists)
        capture("mac-global-growth-collapsed-dark", in: panel)
        send.click()
        wait("exists == false", for: panel)
        let feed = app.scrollViews["Лента заметок"]
        XCTAssertTrue(feed.popUpButtons["Меню заметки Global growth review"].waitForExistence(timeout: 8))
        waitForLayout { feed.staticTexts["review-archive.zip"].exists || feed.buttons["Открыть review-archive.zip"].exists }
        capture("mac-global-growth-sent-dark", in: app.windows.firstMatch)
    }

    func testMainComposerAndUpload() {
        let app = launch(attachment: true)
        let input = element(app, "quick-composer-input")
        let clip = element(app, "quick-composer-attach")
        let expand = element(app, "quick-composer-expand")
        let send = element(app, "quick-composer-send")
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        XCTAssertTrue(send.waitForExistence(timeout: 8))
        XCTAssertTrue(clip.exists && expand.exists)
        XCTAssertLessThan(clip.frame.midX, input.frame.midX)
        XCTAssertLessThan(input.frame.midX, expand.frame.midX)
        XCTAssertLessThan(expand.frame.midX, send.frame.midX)
        capture("mac-main-attachment-draft-light", in: app.windows.firstMatch)
        send.click()

        let transfer = element(app, "attachment-transfer-state")
        XCTAssertTrue(transfer.waitForExistence(timeout: 8))
        wait("label BEGINSWITH 'Загружается'", for: transfer)
        capture("mac-main-uploading-light", in: app.windows.firstMatch)
        input.click()
        input.typeText("Second note while uploading")
        XCTAssertTrue(send.waitForExistence(timeout: 8))
        send.click()
        XCTAssertTrue(app.staticTexts["Second note while uploading"].waitForExistence(timeout: 8))
        wait("exists == false", for: transfer, timeout: 20)
        capture("mac-main-uploaded-light", in: app.windows.firstMatch)
    }

    func testGlobalComposerText() {
        let app = launch(dark: true, global: true)
        let panel = element(app, "quick-capture-panel")
        XCTAssertTrue(panel.waitForExistence(timeout: 8))
        let mic = element(panel, "quick-composer-mic")
        let send = element(panel, "quick-composer-send")
        XCTAssertTrue(mic.waitForExistence(timeout: 8))
        capture("mac-global-idle-dark", in: panel)

        mic.click()
        let stop = element(panel, "quick-composer-stop")
        XCTAssertTrue(stop.waitForExistence(timeout: 8))
        capture("mac-global-recording-dark", in: panel)
        let expand = element(panel, "quick-composer-expand")
        let collapse = element(panel, "quick-composer-collapse")
        expand.click()
        XCTAssertTrue(collapse.waitForExistence(timeout: 8))
        wait("enabled == true", for: send)
        capture("mac-global-recording-expanded-dark", in: panel)
        collapse.click()
        XCTAssertTrue(stop.waitForExistence(timeout: 8))
        capture("mac-global-recording-collapsed-dark", in: panel)
        stop.click()
        wait("exists == false", for: stop)
        XCTAssertTrue(element(panel, "quick-composer-attachment").exists)
        capture("mac-global-recorded-draft-dark", in: panel)

        let input = element(panel, "quick-composer-input")
        input.click()
        input.typeText("Quick review draft")
        XCTAssertTrue(send.waitForExistence(timeout: 8))
        XCTAssertFalse(mic.exists)
        capture("mac-global-typed-dark", in: panel)
        send.click()
        wait("exists == false", for: panel)
        XCTAssertTrue(app.staticTexts["Quick review draft"].waitForExistence(timeout: 8))
    }

    func testMainComposerVoice() {
        let app = launch(dark: true)
        let window = app.windows.firstMatch
        let mic = element(app, "quick-composer-mic")
        XCTAssertTrue(mic.waitForExistence(timeout: 8))
        capture("mac-main-idle-dark", in: window)
        let send = element(app, "quick-composer-send")
        let stop = element(app, "quick-composer-stop")

        mic.click()
        XCTAssertTrue(stop.waitForExistence(timeout: 8))
        XCTAssertTrue(send.exists)
        capture("mac-main-recording-dark", in: window)
        stop.click()
        wait("exists == false", for: stop)
        XCTAssertTrue(send.exists)
        capture("mac-main-recorded-draft-dark", in: window)
        send.click()
        XCTAssertTrue(mic.waitForExistence(timeout: 8))

        mic.click()
        XCTAssertTrue(stop.waitForExistence(timeout: 8))
        send.click()
        XCTAssertTrue(mic.waitForExistence(timeout: 8))

        let origin = window.coordinate(withNormalizedOffset: .zero)
        let hold = origin.withOffset(CGVector(dx: mic.frame.midX - window.frame.minX, dy: mic.frame.midY - window.frame.minY))
        hold.click(forDuration: 0.85, thenDragTo: hold)
        XCTAssertTrue(mic.waitForExistence(timeout: 8))
        XCTAssertFalse(stop.exists)
        capture("mac-main-voice-sent-dark", in: window)
        let feed = app.scrollViews["Лента заметок"]
        let recordings = feed.buttons.matching(NSPredicate(format: "label == %@", "Слушать Голосовая заметка.m4a"))
        let allSaved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 3"), object: recordings)
        XCTAssertEqual(XCTWaiter.wait(for: [allSaved], timeout: 35), .completed)

        hold.click(forDuration: 0.85, thenDragTo: hold.withOffset(CGVector(dx: -180, dy: -45)))
        let remove = app.buttons["Убрать Голосовая заметка.m4a"]
        XCTAssertTrue(remove.waitForExistence(timeout: 8))
        XCTAssertEqual(recordings.count, 3)
        capture("mac-main-hold-kept-as-draft-dark", in: window)
        remove.click()
        XCTAssertTrue(mic.waitForExistence(timeout: 8))
    }
}
