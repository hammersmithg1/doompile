import XCTest

@MainActor final class ComposerTests: XCTestCase {
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
        XCTAssertTrue(mic.waitForExistence(timeout: 8))
        capture("mac-global-idle-dark", in: panel)

        mic.click()
        let stop = element(panel, "quick-composer-stop")
        XCTAssertTrue(stop.waitForExistence(timeout: 8))
        capture("mac-global-recording-dark", in: panel)
        stop.click()
        wait("exists == false", for: stop)
        XCTAssertTrue(element(panel, "quick-composer-attachment").exists)
        capture("mac-global-recorded-draft-dark", in: panel)

        let input = element(panel, "quick-composer-input")
        input.click()
        input.typeText("Quick review draft")
        let send = element(panel, "quick-composer-send")
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
