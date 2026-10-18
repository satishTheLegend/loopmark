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
