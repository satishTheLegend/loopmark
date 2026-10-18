import XCTest

final class NativeFlows: XCTestCase {
    @MainActor
    func testMicrophoneDenialNeverStartsRecording() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "app.loopmark.craft")
        app.launch()
        XCTAssertTrue(app.staticTexts["Native UI fixtures ready"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.buttons["Record fixture"].waitForExistence(timeout: 30))
        app.buttons["Record fixture"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "PERMISSION_DENIED")).firstMatch.waitForExistence(timeout: 10), app.debugDescription)
    }
    @MainActor
    func testNativeSystemSheetsCancelWithoutErrors() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "app.loopmark.craft")
        app.launch()
        XCTAssertTrue(app.staticTexts["Native UI fixtures ready"].waitForExistence(timeout: 60))
        let share = app.buttons["Share fixture"]
        XCTAssertTrue(share.waitForExistence(timeout: 30))
        share.tap()
        let dismiss = app.otherElements["PopoverDismissRegion"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 10), app.debugDescription)
        dismiss.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "\"action\":\"share\",\"status\":\"cancelled\"")).firstMatch.waitForExistence(timeout: 10))
        app.buttons["Choose fixture"].tap()
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10), app.debugDescription)
        cancel.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "\"action\":\"picker\",\"status\":\"cancelled\"")).firstMatch.waitForExistence(timeout: 10))
        app.buttons["Photo fixture"].tap()
        XCTAssertTrue(dismiss.waitForExistence(timeout: 10), app.debugDescription)
        dismiss.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "\"action\":\"photo\",\"status\":\"cancelled\"")).firstMatch.waitForExistence(timeout: 10))
    }
}

final class ProductFlows: XCTestCase {
    @MainActor
    private func tap(_ button: XCUIElement, app: XCUIApplication) {
        XCTAssertTrue(button.waitForExistence(timeout: 30), app.debugDescription)
        for _ in 0..<5 { if button.isHittable { break }; app.swipeUp() }
        button.tap()
    }
    @MainActor
    func testProductionCheckpointAndNativePermissions() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "app.loopmark.craft")
        app.launch()
        XCTAssertTrue(app.buttons["New project"].waitForExistence(timeout: 30), app.debugDescription)
        let existingProject = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "Pick up iOS native QA scarf")).firstMatch
        if existingProject.exists {
            tap(existingProject, app: app)
        } else {
            tap(app.buttons["New project"], app: app)
            let name = app.textFields.firstMatch
            XCTAssertTrue(name.waitForExistence(timeout: 10), app.debugDescription)
            name.tap()
            if let existing = name.value as? String, existing != name.placeholderValue {
                name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
            }
            name.typeText("iOS native QA scarf")
            if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
            if app.buttons["Done"].exists { app.buttons["Done"].tap() }
            tap(app.buttons["Create project"], app: app)
        }
        tap(app.buttons["Save a checkpoint"], app: app)
        let step = app.textViews.firstMatch
        XCTAssertTrue(step.waitForExistence(timeout: 10), app.debugDescription)
        step.tap()
        step.typeText("Start row 24 with the 4 mm hook")
        if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        tap(app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "Add a photo")).firstMatch, app: app)
        let dismiss = app.otherElements["PopoverDismissRegion"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 10), app.debugDescription)
        dismiss.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        tap(app.buttons["Record a quick note"], app: app)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", "permission")).firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        tap(app.buttons["Save checkpoint"], app: app)
        XCTAssertTrue(app.buttons["Save checkpoint"].waitForNonExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Start row 24 with the 4 mm hook")).firstMatch.waitForExistence(timeout: 20), app.debugDescription)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Start row 24 with the 4 mm hook")).firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        tap(app.buttons["Open navigation"], app: app)
        tap(app.buttons["Account & device"], app: app)
        XCTAssertTrue(app.staticTexts["Your account"].waitForExistence(timeout: 10), app.debugDescription)
        tap(app.buttons["Preview diagnostic report"], app: app)
        let diagnostic = app.textViews.firstMatch
        XCTAssertTrue(diagnostic.waitForExistence(timeout: 10), app.debugDescription)
        let report = diagnostic.value as? String ?? ""
        XCTAssertTrue(report.contains("loopmark-diagnostics") && report.contains("ios"), app.debugDescription)
        XCTAssertFalse(report.contains("iOS native QA scarf") || report.contains("Start row 24"))
        tap(app.buttons["Share diagnostic file"], app: app)
        XCTAssertTrue(dismiss.waitForExistence(timeout: 10), app.debugDescription)
        dismiss.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Sharing cancelled")).firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        tap(app.buttons["Close dialog"], app: app)
    }
}

@available(iOS 16.4, *)
final class InboxProductFlows: XCTestCase {
    private func document() throws -> URL {
        let tag = UUID().uuidString, time = "2026-01-01T00:00:00.000Z"
        let checkpoint: [String: Any] = ["id": "external_checkpoint", "createdAt": time, "position": "Row 24", "toolSize": "4 mm", "nextStep": "Turn and continue from the external backup", "notes": ""]
        let project: [String: Any] = ["id": "external_project", "code": "EXT-1", "name": "iOS external backup " + tag, "craft": "Crochet", "color": "clay", "toolSize": "4 mm", "yarn": "Synthetic fixture", "notes": "", "status": "active", "createdAt": time, "updatedAt": time, "checkpoints": [checkpoint]]
        let backup: [String: Any] = ["format": "loopmark", "version": 1, "exportedAt": time, "projects": [project]]
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("loopmark-external-" + tag + ".json")
        try JSONSerialization.data(withJSONObject: backup, options: [.sortedKeys]).write(to: url)
        return url
    }
    @MainActor
    func testOSDocumentDeliveryToBenchmarkApp() throws {
        continueAfterFailure = false
        let file = try document(); defer { try? FileManager.default.removeItem(at: file) }
        let app = XCUIApplication(bundleIdentifier: "app.loopmark.craft.benchmark")
        app.terminate(); app.open(file)
        XCTAssertTrue(app.staticTexts["Incoming OS file ready"].waitForExistence(timeout: 30), app.debugDescription)
        // The subsequent native bridge fixture verifies durable bytes, source fences and restore.
    }
    @MainActor
    func testExternalBackupReviewCancelRelaunchRestoreAndRepeat() throws {
        continueAfterFailure = false
        let file = try document(); defer { try? FileManager.default.removeItem(at: file) }
        let app = XCUIApplication(bundleIdentifier: "app.loopmark.craft")
        app.terminate(); app.open(file)
        let review = app.buttons["Review backup file"]
        XCTAssertTrue(review.waitForExistence(timeout: 30), app.debugDescription)
        review.tap()
        XCTAssertTrue(app.buttons["Restore as separate collection"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(review.waitForExistence(timeout: 10), app.debugDescription)
        app.terminate(); app.launch()
        XCTAssertTrue(review.waitForExistence(timeout: 30), app.debugDescription)
        review.tap()
        let restore = app.buttons["Restore as separate collection"]
        XCTAssertTrue(restore.waitForExistence(timeout: 30), app.debugDescription); restore.tap()
        XCTAssertTrue(restore.waitForNonExistence(timeout: 30), app.debugDescription)
        app.buttons["Open navigation"].tap()
        app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "My projects")).firstMatch.tap()
        let restored = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "Pick up iOS external backup")).firstMatch
        XCTAssertTrue(restored.waitForExistence(timeout: 30), app.debugDescription)
        app.open(file)
        XCTAssertTrue(app.staticTexts["Backup file already handled"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["Dismiss backup file"].tap()
        app.terminate(); app.launch()
        XCTAssertTrue(restored.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertEqual(app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "Pick up iOS external backup")).count, 1)
        XCTAssertFalse(review.exists)
    }
}
