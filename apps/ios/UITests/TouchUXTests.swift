import XCTest

final class TouchUXTests: XCTestCase {
    private var app: XCUIApplication!
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment["DOOMPILE_UI_TESTING"] = "1"
        app.launch()
        XCTAssertTrue(app.textFields["quick-input"].waitForExistence(timeout: 10))
    }
    private func screenshot(_ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func backgroundBrightness() -> Double {
        guard let image = app.screenshot().image.cgImage,
              let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 1 }
        let x = image.width / 2, y = image.height / 5
        let offset = y * image.bytesPerRow + x * (image.bitsPerPixel / 8)
        return Double(Int(bytes[offset]) + Int(bytes[offset + 1]) + Int(bytes[offset + 2])) / (255 * 3)
    }
    private func noteRow(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'note-' AND label CONTAINS %@", title)).firstMatch
    }
    private func swipeAction(_ name: String, for title: String) -> XCUIElement {
        let identifier = String(noteRow(title).identifier.dropFirst("note-".count))
        return app.buttons["swipe-action-" + name + "-" + identifier]
    }
    private func createNote(_ text: String) {
        let input = app.textFields["quick-input"]
        input.tap(); input.typeText(text)
        app.buttons["Сохранить заметку"].tap()
        XCTAssertTrue(noteRow(text).waitForExistence(timeout: 5), app.debugDescription)
    }
    private func openSidebar(over row: XCUIElement? = nil) {
        let frame = app.frame
        let x = row.map { ($0.frame.minX + 1 - frame.minX) / frame.width } ?? 0.015
        let y = row.map { ($0.frame.midY - frame.minY) / frame.height } ?? 0.4
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: y))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(app.textFields["sidebar-search"].waitForExistence(timeout: 5))
    }
    func testQuickKeyboardDismissesWhenTappingFeed() {
        let input = app.textFields["quick-input"]
        input.tap(); input.typeText("Touch draft")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.38)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        screenshot("home-no-header")
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        XCTAssertEqual(input.value as? String, "Touch draft", "Unfocus must preserve the draft")
    }
    func testExpandedDraftFocusesAndToolbarFollowsKeyboard() {
        app.buttons["expand-editor"].tap()
        XCTAssertTrue(app.buttons["close-editor"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "New notes focus without another tap")
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        editor.typeText("One document\nSecond line")
        let keyboard = app.keyboards.firstMatch.frame
        let controls = app.buttons["dismiss-editor-keyboard"].frame
        XCTAssertLessThanOrEqual(controls.maxY, keyboard.minY + 1)
        // XCTest's Keyboard frame excludes the system predictive text row (~44 pt).
        screenshot("editor-keyboard")
        XCTAssertLessThan(keyboard.minY - controls.maxY, 60)
        app.buttons["dismiss-editor-keyboard"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        let scroll = app.scrollViews["editor-controls"]
        for _ in 0..<4 {
            if app.buttons["Вставить таблицу"].isHittable { break }
            scroll.swipeLeft()
        }
        XCTAssertTrue(app.buttons["Вставить таблицу"].isHittable)
        screenshot("editor-controls-scrolled")
        app.buttons["close-editor"].tap()
        XCTAssertTrue(noteRow("One document").waitForExistence(timeout: 5), app.debugDescription)
        noteRow("One document").tap()
        XCTAssertTrue(app.buttons["close-editor"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Existing notes open in reading mode")
        app.buttons["close-editor"].tap()
    }
    func testSidebarGestureSearchAndSettings() {
        createNote("Sidebar searchable note")
        openSidebar()
        screenshot("sidebar")
        let search = app.textFields["sidebar-search"]
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), app.debugDescription)
        search.typeText("Sidebar searchable")
        XCTAssertEqual(search.value as? String, "Sidebar searchable")
        search.typeText("\n")
        let hiddenSearch = expectation(for: NSPredicate(format: "hittable == false"), evaluatedWith: search)
        wait(for: [hiddenSearch], timeout: 3)
        XCTAssertTrue(noteRow("Sidebar searchable note").exists)
        openSidebar()
        app.buttons["sidebar-settings"].tap()
        XCTAssertTrue(app.navigationBars["Настройки"].waitForExistence(timeout: 3))
        app.buttons["Готово"].tap()
        openSidebar()
        app.buttons["nav-Все заметки"].tap()
    }
    func testSwipeLeftOffersNoteActionsWithoutOpeningEditor() {
        createNote("Swipe actions note")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'note-' AND label CONTAINS 'Swipe actions note'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        row.swipeLeft()
        XCTAssertTrue(app.buttons["Удалить"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Сделать важной"].exists)
        XCTAssertTrue(app.buttons["Закрепить"].exists)
        XCTAssertFalse(app.buttons["close-editor"].exists)
        screenshot("note-swipe-actions")
        app.buttons["Сделать важной"].tap()
        XCTAssertTrue(app.buttons["feed-section-urgent"].waitForExistence(timeout: 3))
    }
    private func startQuickRecording() {
        addUIInterruptionMonitor(withDescription: "Microphone permission") { alert in
            let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "Разрешить", "OK", "ОК"])).firstMatch
            if allow.exists { allow.tap(); return true }
            let ok = alert.buttons["OK"]
            if ok.exists { ok.tap(); return true }
            return false
        }
        app.buttons["quick-microphone"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.alerts.firstMatch.waitForExistence(timeout: 2) {
            let allow = springboard.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "Разрешить", "OK", "ОК"])).firstMatch
            if allow.exists { allow.tap() } else { springboard.alerts.buttons["OK"].tap() }
        }
        XCTAssertTrue(app.buttons["quick-stop-recording"].waitForExistence(timeout: 5))
    }
    func testQuickMicrophoneStartsInlineAndSendsAudio() {
        startQuickRecording()
        XCTAssertFalse(app.buttons["close-editor"].exists, "Microphone must never open the editor")
        screenshot("quick-inline-recording")
        app.buttons["Сохранить заметку"].tap()
        XCTAssertTrue(noteRow("Голосовая заметка").waitForExistence(timeout: 5))
    }
    func testVoiceCaptureSurvivesExpandAndCollapseAndStopsWithoutSending() {
        startQuickRecording()
        let input = app.textFields["quick-input"]
        input.tap(); input.typeText("Voice draft")
        app.buttons["expand-editor"].tap()
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        XCTAssertTrue(app.webViews.buttons["Остановить запись"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue((editor.value as? String ?? "").contains("Voice draft"))
        editor.typeText("\nExpanded edit")
        app.buttons["close-editor"].tap()
        let stop = app.buttons["quick-stop-recording"]
        XCTAssertTrue(stop.waitForExistence(timeout: 5), app.debugDescription)
        stop.tap()
        XCTAssertTrue(stop.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Голосовая заметка.m4a"].firstMatch.exists)
        XCTAssertFalse(noteRow("Voice draft").exists)
        app.buttons["Сохранить заметку"].tap()
        let row = noteRow("Voice draft")
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(row.label.contains("Expanded edit"))
        XCTAssertTrue(row.label.contains("Голосовая заметка.m4a"))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'note-'")).count, 1)
    }
    func testEntireShortEditorPageEntersEditingAndNoDuplicateSaveControl() {
        createNote("Short note")
        noteRow("Short note").tap()
        XCTAssertTrue(app.buttons["close-editor"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertFalse(app.buttons["save-editor"].exists)
        let web = app.webViews.firstMatch
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.82)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.webViews.textViews.firstMatch.typeText(" extended")
        app.buttons["close-editor"].tap()
        XCTAssertTrue(noteRow("Short note extended").waitForExistence(timeout: 5))
    }
    func testSidebarCreatesPersistentTagWithoutEmptyNote() {
        openSidebar()
        app.buttons["sidebar-create-tag"].tap()
        let alert = app.alerts["Новый тег"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        alert.textFields.firstMatch.typeText("Research")
        alert.buttons["Создать"].tap()
        XCTAssertTrue(app.buttons["nav-Research"].waitForExistence(timeout: 3))
        app.launchEnvironment["DOOMPILE_UI_KEEP_TAGS"] = "1"
        app.terminate(); app.launch()
        openSidebar()
        XCTAssertTrue(app.buttons["nav-Research"].exists)
        screenshot("sidebar-created-tag")
    }
    func testAppearanceChoicesAndPersistence() {
        openSidebar(); app.buttons["sidebar-settings"].tap()
        XCTAssertTrue(app.navigationBars["Настройки"].waitForExistence(timeout: 3))
        for title in ["Системная", "Светлая", "Тёмная"] { XCTAssertTrue(app.buttons[title].exists) }
        app.buttons["Тёмная"].tap()
        let dark = expectation(for: NSPredicate { [weak self] _, _ in
            guard let self else { return false }; return self.backgroundBrightness() < 0.3
        }, evaluatedWith: app)
        wait(for: [dark], timeout: 5)
        screenshot("appearance-dark-settings")
        app.buttons["Готово"].tap()
        screenshot("appearance-dark-home")
        app.launchEnvironment["DOOMPILE_TEST_APPEARANCE"] = "preserve"
        app.terminate(); app.launch()
        openSidebar(); app.buttons["sidebar-settings"].tap()
        XCTAssertTrue(app.buttons["Тёмная"].isSelected)
        app.buttons["Системная"].tap()
        XCTAssertTrue(app.buttons["Системная"].isSelected)
        app.buttons["Готово"].tap()
        let dismissed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.navigationBars["Настройки"])
        wait(for: [dismissed], timeout: 5)
        app.buttons["expand-editor"].tap()
        XCTAssertTrue(app.buttons["close-editor"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews.textViews.firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8), app.debugDescription)
        screenshot("appearance-system-editor")
    }
    func testPinAndUrgentMoveOneStableRowBetweenSections() {
        createNote("Move this note")
        var row = noteRow("Move this note")
        let identifier = row.identifier
        row.swipeLeft(); app.buttons["Закрепить"].tap()
        XCTAssertTrue(app.buttons["feed-section-pinned"].waitForExistence(timeout: 3))
        XCTAssertEqual(noteRow("Move this note").identifier, identifier)
        row = noteRow("Move this note")
        row.swipeLeft(); app.buttons["Сделать важной"].tap()
        XCTAssertTrue(app.buttons["feed-section-urgent"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.buttons.matching(identifier: identifier).count, 1)
        screenshot("note-moved-to-urgent")
    }
    func testDrawerRepeatedGesturesDoNotDuplicateNavigation() {
        for _ in 0..<3 {
            openSidebar()
            XCTAssertEqual(app.textFields.matching(identifier: "sidebar-search").count, 1)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.45)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.45)))
            let hidden = expectation(for: NSPredicate(format: "hittable == false"), evaluatedWith: app.textFields["sidebar-search"])
            wait(for: [hidden], timeout: 3)
            XCTAssertFalse(app.alerts["Новый тег"].exists, "Dragging across a button must cancel its tap")
        }
    }
    func testQuickCaptureEntryFocusesNewEditor() {
        app.open(URL(string: "doompile://quick-note")!)
        XCTAssertTrue(app.buttons["close-editor"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.webViews.textViews.firstMatch.typeText("Action capture")
        app.buttons["close-editor"].tap()
        XCTAssertTrue(noteRow("Action capture").waitForExistence(timeout: 5))
    }

    @objc func testShortcutCatalogListsQuickNote() {
        let shortcuts = XCUIApplication(bundleIdentifier: "com.apple.shortcuts")
        let quickNote = shortcuts.staticTexts["Быстрая заметка"]
        // A fresh simulator indexes App Intents asynchronously. Refresh the
        // system catalog while waiting, and still require the actual tile.
        let deadline = Date().addingTimeInterval(45)
        repeat {
            shortcuts.terminate()
            shortcuts.launch()
            XCTAssertTrue(shortcuts.wait(for: .runningForeground, timeout: 8))
            for _ in 0..<3 {
                let proceed = shortcuts.buttons.matching(NSPredicate(format: "label IN %@", ["Continue", "Продолжить"])).firstMatch
                if proceed.waitForExistence(timeout: 2) { proceed.tap() } else { break }
            }
            if quickNote.exists { break }
            let folders = shortcuts.navigationBars.buttons.matching(NSPredicate(format: "label IN %@", ["Shortcuts", "Команды"])).firstMatch
            if folders.exists && folders.isHittable { folders.tap() }
            let catalog = shortcuts.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Doompile")).firstMatch
            if catalog.waitForExistence(timeout: 8) && catalog.isHittable {
                catalog.tap()
                break
            }
        } while Date() < deadline
        XCTAssertTrue(quickNote.waitForExistence(timeout: 8), shortcuts.debugDescription)
        let image = XCTAttachment(screenshot: shortcuts.screenshot()); image.name = "system-shortcuts"; image.lifetime = .keepAlways; add(image)
        // System visibility is tested here. Running the tile is a device check:
        // iOS 26.2 Simulator also rejects Apple's unmodified Trails sample with
        // LNActionForAutoShortcutPhraseFetchError "Couldn't find AppShortcutsProvider".
    }

    func testSharedSlashChecklistAndBlockActions() {
        app.buttons["expand-editor"].tap()
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        editor.typeText("/todo\nTask one")
        // WKWebView exposes HTML checkboxes as switches on newer iOS releases.
        let checkbox = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Task item checkbox")).firstMatch
        XCTAssertTrue(checkbox.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual((editor.value as? String ?? "").components(separatedBy: "Task one").count - 1, 1, "Enter selects the command once")
        app.buttons["dismiss-editor-keyboard"].tap()
        let actions = app.buttons["Действия с блоком"]
        XCTAssertTrue(actions.waitForExistence(timeout: 3), app.debugDescription)
        actions.tap()
        let duplicate = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Дублировать блок")).firstMatch
        XCTAssertTrue(duplicate.waitForExistence(timeout: 3), app.debugDescription)
        screenshot("editor-block-actions")
        duplicate.tap()
        XCTAssertEqual((editor.value as? String ?? "").components(separatedBy: "Task one").count - 1, 2)
        app.buttons["close-editor"].tap()
        XCTAssertTrue(noteRow("Task one").waitForExistence(timeout: 5))
    }

    func testSharedEditorAliasSettingsOpenFromNativeSettings() {
        openSidebar(); app.buttons["sidebar-settings"].tap()
        XCTAssertTrue(app.navigationBars["Настройки"].waitForExistence(timeout: 5))
        app.buttons["Команды и алиасы редактора"].tap()
        XCTAssertTrue(app.webViews.staticTexts["Команды редактора"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.webViews.textFields.firstMatch.exists)
        screenshot("editor-alias-settings")
        app.navigationBars["Команды редактора"].buttons["Готово"].tap()
        XCTAssertTrue(app.navigationBars["Настройки"].waitForExistence(timeout: 3))
    }

    func testExpandedQuickDraftSurvivesCloseWithoutFurtherTyping() {
        let input = app.textFields["quick-input"]
        input.tap(); input.typeText("Draft before expanding")
        app.buttons["expand-editor"].tap()
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        XCTAssertTrue((editor.value as? String ?? "").contains("Draft before expanding"), app.debugDescription)
        app.buttons["close-editor"].tap()
        XCTAssertTrue(noteRow("Draft before expanding").waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'note-'")).count, 1)
        XCTAssertFalse((app.textFields["quick-input"].value as? String ?? "").contains("Draft before expanding"))
        noteRow("Draft before expanding").tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertTrue((editor.value as? String ?? "").contains("Draft before expanding"))
    }

    func testUnpinAndRemoveUrgencyRestoreCreationOrder() {
        createNote("Older timeline note")
        createNote("Newer timeline note")
        func assertOrder() {
            XCTAssertLessThan(noteRow("Newer timeline note").frame.minY, noteRow("Older timeline note").frame.minY)
        }
        assertOrder()
        noteRow("Older timeline note").swipeLeft()
        swipeAction("pin", for: "Older timeline note").tap()
        noteRow("Older timeline note").swipeLeft()
        swipeAction("pin", for: "Older timeline note").tap()
        assertOrder()
        noteRow("Older timeline note").swipeLeft()
        swipeAction("urgent", for: "Older timeline note").tap()
        noteRow("Older timeline note").swipeLeft()
        swipeAction("urgent", for: "Older timeline note").tap()
        assertOrder()
        screenshot("creation-order-restored")
    }
    func testEditorTagsSearchCreateSelectAndRemove() {
        app.buttons["expand-editor"].tap()
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        editor.typeText("Tagged note")
        app.buttons["Теги заметки"].tap()
        let search = app.textFields["editor-tag-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap(); search.typeText("Research")
        app.buttons["editor-create-tag"].tap()
        XCTAssertTrue(app.buttons["Убрать тег Research"].waitForExistence(timeout: 3))
        search.tap(); search.typeText("Idea\n")
        XCTAssertTrue(app.buttons["Убрать тег Idea"].waitForExistence(timeout: 3))
        app.buttons["Убрать тег Research"].tap()
        search.tap(); search.typeText("res")
        XCTAssertTrue(app.buttons["Тег Research"].waitForExistence(timeout: 3))
        app.buttons["Тег Research"].tap()
        screenshot("editor-tags")
        app.buttons["editor-tags-done"].tap()
        app.buttons["close-editor"].tap()
        noteRow("Tagged note").tap()
        app.buttons["Теги заметки"].tap()
        XCTAssertTrue(app.buttons["Убрать тег Research"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Убрать тег Idea"].exists)
    }
    func testNoteSwipeClosesAndReopensBothDirections() {
        createNote("Repeat swipe note")
        for _ in 0..<3 {
            let row = noteRow("Repeat swipe note")
            row.swipeLeft()
            let pin = swipeAction("pin", for: "Repeat swipe note")
            XCTAssertTrue(pin.waitForExistence(timeout: 2))
            screenshot("swipe-open")
            let y = row.frame.midY / app.frame.height
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: y)).press(forDuration: 0.03, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: y)))
            screenshot("swipe-after-close")
            XCTAssertTrue(pin.waitForNonExistence(timeout: 3), "Closed swipe actions must leave the accessibility tree")
            XCTAssertFalse(app.buttons["close-editor"].exists)
            XCTAssertFalse(app.textFields["sidebar-search"].isHittable)
        }
        noteRow("Repeat swipe note").tap()
        XCTAssertTrue(app.buttons["close-editor"].waitForExistence(timeout: 3), "A closed card must open normally after repeated swipes")
    }
    func testVerticalScrollingSurvivesRepeatedRowSwipesAndAppActivation() {
        app.terminate()
        app.launchEnvironment["DOOMPILE_UI_SCROLL_FIXTURE"] = "1"
        app.launch()
        XCTAssertTrue(app.scrollViews["note-feed"].waitForExistence(timeout: 10))
        func visibleRow() -> XCUIElement {
            let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'note-' AND label CONTAINS 'Scroll fixture'")).allElementsBoundByIndex
            let row = rows.first { $0.isHittable && $0.frame.midY > app.frame.height * 0.25 && $0.frame.midY < app.frame.height * 0.7 }
            XCTAssertNotNil(row, app.debugDescription)
            return row ?? app.buttons.firstMatch
        }
        func dragVertically(x: CGFloat, up: Bool) {
            let row = visibleRow(), before = row.frame.minY
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: up ? 0.7 : 0.3))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: x + 0.015, dy: up ? 0.3 : 0.7))
            start.press(forDuration: 0.02, thenDragTo: end)
            XCTAssertTrue(!row.exists || abs(row.frame.minY - before) > 40, "Vertical movement must scroll the feed even when it starts on a swipeable row or the drawer edge")
            XCTAssertFalse(app.buttons["close-editor"].exists)
        }
        openSidebar(over: visibleRow())
        XCTAssertFalse(app.buttons["close-editor"].exists)
        app.buttons["nav-Все заметки"].tap()
        let hiddenSearch = expectation(for: NSPredicate(format: "hittable == false"), evaluatedWith: app.textFields["sidebar-search"])
        wait(for: [hiddenSearch], timeout: 3)
        for x in [CGFloat(0.3), CGFloat(0.7), CGFloat(0.015)] {
            dragVertically(x: x, up: true)
            let row = visibleRow()
            row.swipeLeft()
            let noteID = String(row.identifier.dropFirst("note-".count))
            XCTAssertTrue(app.buttons["swipe-action-pin-" + noteID].waitForExistence(timeout: 3))
            let y = row.frame.midY / app.frame.height
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: y)).press(forDuration: 0.03, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: y)))
            XCTAssertTrue(app.buttons["swipe-action-pin-" + noteID].waitForNonExistence(timeout: 3))
            dragVertically(x: x, up: false)
        }
        XCUIDevice.shared.press(.home)
        app.activate()
        dragVertically(x: 0.5, up: true)
        screenshot("feed-scroll-after-mixed-swipes")
    }
    func testDateSectionsCollapseAndStayCollapsedAfterRelaunch() {
        app.terminate()
        app.launchEnvironment["DOOMPILE_UI_SCROLL_FIXTURE"] = "1"
        app.launch()
        let section = app.buttons["feed-section-day:2026-10-30"]
        XCTAssertTrue(section.waitForExistence(timeout: 10))
        XCTAssertTrue(section.label.contains("24"))
        XCTAssertEqual(section.value as? String, "Развёрнуто")
        section.tap()
        XCTAssertEqual(section.value as? String, "Свёрнуто")
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'note-' AND label CONTAINS 'Scroll fixture'"))
        XCTAssertEqual(rows.count, 0)
        app.terminate()
        app.launchEnvironment["DOOMPILE_UI_KEEP_COLLAPSED"] = "1"
        app.launch()
        XCTAssertTrue(section.waitForExistence(timeout: 10))
        XCTAssertEqual(section.value as? String, "Свёрнуто")
        XCTAssertEqual(rows.count, 0)
        section.tap()
        XCTAssertEqual(section.value as? String, "Развёрнуто")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 3))
        screenshot("date-section-expanded-after-relaunch")
    }
    func testExpandedNoteAutosavesAndSurvivesLeavingApp() {
        app.buttons["expand-editor"].tap()
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        editor.typeText("Autosaved expanded note")
        XCUIDevice.shared.press(.home)
        app.activate()
        app.buttons["close-editor"].tap()
        XCTAssertTrue(noteRow("Autosaved expanded note").waitForExistence(timeout: 5))
    }

    func testSaveActionAppearsInSystemShareSheet() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.open(URL(string: "https://example.com")!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 8))
        if safari.otherElements["TipView"].waitForExistence(timeout: 2) {
            let dismissTip = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@ OR label BEGINSWITH %@", "Закрыть", "Close", "Dismiss")).firstMatch
            if dismissTip.waitForExistence(timeout: 2) && dismissTip.isHittable { dismissTip.tap() }
        }
        let loadedPage = safari.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier CONTAINS %@", "TabDocument?", "IsPageLoaded=true")).firstMatch
        XCTAssertTrue(loadedPage.waitForExistence(timeout: 15), safari.debugDescription)
        let share = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Поделиться", "Share")).firstMatch
        for _ in 0..<3 {
            if share.exists && share.isHittable { break }
            let more = safari.buttons.matching(NSPredicate(format: "label IN %@", ["Еще", "Ещё", "More"])).firstMatch
            XCTAssertTrue(more.waitForExistence(timeout: 5), safari.debugDescription)
            more.tap()
            if share.waitForExistence(timeout: 3) && share.isHittable { break }
        }
        XCTAssertTrue(share.waitForExistence(timeout: 5) && share.isHittable, safari.debugDescription)
        share.tap()

        let action = safari.cells.matching(NSPredicate(format: "label == %@", "Сохранить в Doompile")).firstMatch
        // Safari can group actions behind a separate More cell below the app row.
        let moreActions = safari.cells.matching(NSPredicate(
            format: "identifier == %@ AND label IN %@", "actionGroupCell", ["Еще", "Ещё", "More"]
        )).firstMatch
        if !action.exists && moreActions.waitForExistence(timeout: 5) && moreActions.isHittable {
            moreActions.tap()
        }
        for _ in 0..<4 { if action.exists && action.isHittable { break }; safari.swipeUp() }
        let actionReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            action.exists && action.isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [actionReady], timeout: 10), .completed, safari.debugDescription)
        let image = XCTAttachment(screenshot: safari.screenshot()); image.name = "system-save-action"; image.lifetime = .keepAlways; add(image)
        action.tap()
        XCTAssertTrue(safari.buttons["capture-save"].waitForExistence(timeout: 8), safari.debugDescription)
        let imageAfter = XCTAttachment(screenshot: safari.screenshot()); imageAfter.name = "save-action-capture"; imageAfter.lifetime = .keepAlways; add(imageAfter)
        safari.buttons["capture-close"].tap()
    }

}
