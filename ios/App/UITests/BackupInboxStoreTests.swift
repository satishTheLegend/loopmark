import XCTest
import Foundation
import CryptoKit

/// Native filesystem qualification; OS document routing is tested separately in the product app.
final class BackupInboxStoreTests: XCTestCase {
    private func fixture(_ body: (URL, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("inbox-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory.appendingPathComponent("private/Incoming"), directory)
    }
    func testDurableReopenRepeatedFileAndHandledReceipt() throws {
        try fixture { root, directory in
            let bytes = Data("{\"synthetic\":\"durable inbox\"}".utf8), file = directory.appendingPathComponent("fixture.json")
            try bytes.write(to: file)
            let first = try BackupInbox(root: root)
            try first.stage(file)
            let item = try XCTUnwrap(first.pending()), id = try XCTUnwrap(item["id"] as? String)
            XCTAssertEqual(id, SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
            let token = try XCTUnwrap(item["operationToken"] as? String)
            let reopened = try BackupInbox(root: root)
            XCTAssertEqual(reopened.pending()?["operationToken"] as? String, token)
            XCTAssertEqual(try reopened.read(id: id, offset: 0, length: bytes.count), bytes)
            try reopened.stage(file)
            XCTAssertEqual(reopened.pending()?["operationToken"] as? String, token)
            let different = directory.appendingPathComponent("different.json"); try Data("different".utf8).write(to: different)
            try reopened.stage(different)
            let noticeID = try XCTUnwrap(reopened.pending()?["id"] as? String)
            try reopened.finish(id: id)
            try BackupInbox(root: root).finish(id: id) // A lost JS completion reply retries the same native receipt.
            XCTAssertEqual(try BackupInbox(root: root).pending()?["id"] as? String, noticeID)
            try BackupInbox(root: root).finish(id: noticeID)
            XCTAssertNil(try BackupInbox(root: root).pending())
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(id).path))
            let repeatStore = try BackupInbox(root: root)
            try repeatStore.stage(file)
            XCTAssertEqual(repeatStore.pending()?["state"] as? String, "already-handled")
            XCTAssertEqual(repeatStore.pending()?["operationToken"] as? String, token)
            XCTAssertThrowsError(try repeatStore.read(id: id, offset: 0, length: 1))
            try repeatStore.finish(id: id)
            XCTAssertNil(try BackupInbox(root: root).pending())
            XCTAssertEqual(try root.deletingLastPathComponent().resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        }
    }
    func testFailedPrivateAndNoticeWritesExposeStorageFailure() throws {
        try fixture { root, directory in
            let file = directory.appendingPathComponent("original.json"), other = directory.appendingPathComponent("other.json")
            try Data("original".utf8).write(to: file); try Data("different".utf8).write(to: other)
            let store = try BackupInbox(root: root); try store.stage(file)
            let id = try XCTUnwrap(store.pending()?["id"] as? String), held = directory.appendingPathComponent("held")
            try FileManager.default.moveItem(at: root, to: held)
            try Data("blocks private writes".utf8).write(to: root)
            XCTAssertThrowsError(try store.stage(other))
            store.recordFailure("LOCAL_STORAGE_FAILED") // Both real file creation and notice persistence encounter ENOTDIR.
            let failure = try XCTUnwrap(store.pending())
            XCTAssertEqual(failure["errorCode"] as? String, "LOCAL_STORAGE_FAILED")
            XCTAssertEqual(failure["state"] as? String, "failed")
            try FileManager.default.removeItem(at: root); try FileManager.default.moveItem(at: held, to: root)
            let reopened = try BackupInbox(root: root)
            XCTAssertEqual(reopened.pending()?["id"] as? String, failure["id"] as? String)
            try reopened.finish(id: try XCTUnwrap(failure["id"] as? String))
            XCTAssertEqual(reopened.pending()?["id"] as? String, id)
            XCTAssertEqual(try reopened.read(id: id, offset: 0, length: 8), Data("original".utf8))
        }
    }
    func testMaximumHandledReceiptsRemainBoundedWithMultibyteName() throws {
        try fixture { root, directory in
            let file = directory.appendingPathComponent("fixture.json"); try Data("last receipt".utf8).write(to: file)
            let store = try BackupInbox(root: root); try store.stage(file)
            let id = try XCTUnwrap(store.pending()?["id"] as? String), index = root.appendingPathComponent("inbox.json")
            var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: index)) as? [String: Any])
            manifest["handled"] = (0..<4095).map { ["id": String(format: "%064x", $0), "operationToken": UUID().uuidString.lowercased(), "receivedAt": "2026-01-01T00:00:00.000Z"] }
            var pending = try XCTUnwrap(manifest["pending"] as? [String: Any]); pending["name"] = String(repeating: "界", count: 160); manifest["pending"] = pending
            try JSONSerialization.data(withJSONObject: manifest).write(to: index)
            try BackupInbox(root: root).finish(id: id)
            let finishedBytes = try Data(contentsOf: index)
            XCTAssertLessThan(finishedBytes.count, 1024 * 1024)
            let finished = try XCTUnwrap(JSONSerialization.jsonObject(with: finishedBytes) as? [String: Any]), receipts = try XCTUnwrap(finished["handled"] as? [[String: Any]])
            XCTAssertEqual(receipts.count, 4096); XCTAssertNil(receipts.last?["name"])
            let repeated = try BackupInbox(root: root); try repeated.stage(file)
            XCTAssertEqual(repeated.pending()?["state"] as? String, "already-handled")
            try repeated.finish(id: id)
            XCTAssertNil(try BackupInbox(root: root).pending())
        }
    }
    func testBusyInvalidAndOrphanCleanupPreserveOriginal() throws {
        try fixture { root, directory in
            let file = directory.appendingPathComponent("original.json"), other = directory.appendingPathComponent("other.json")
            try Data("original".utf8).write(to: file); try Data("different".utf8).write(to: other)
            let store = try BackupInbox(root: root); try store.stage(file)
            let original = try XCTUnwrap(store.pending()), id = try XCTUnwrap(original["id"] as? String)
            try store.stage(other)
            let notice = try XCTUnwrap(store.pending())
            XCTAssertEqual(notice["errorCode"] as? String, "CAPABILITY_UNAVAILABLE")
            try store.finish(id: try XCTUnwrap(notice["id"] as? String))
            XCTAssertEqual(store.pending()?["id"] as? String, id)
            let empty = directory.appendingPathComponent("empty.json"); try Data().write(to: empty)
            XCTAssertThrowsError(try store.stage(empty))
            let oversized = directory.appendingPathComponent("oversized.json")
            XCTAssertTrue(FileManager.default.createFile(atPath: oversized.path, contents: nil))
            let handle = try FileHandle(forWritingTo: oversized); try handle.truncate(atOffset: UInt64(BackupInbox.maximum + 1)); try handle.close()
            XCTAssertThrowsError(try store.stage(oversized))
            XCTAssertThrowsError(try store.read(id: "../escape", offset: 0, length: 1))
            XCTAssertThrowsError(try store.read(id: id, offset: Int.max, length: 1))
            try Data("orphan".utf8).write(to: root.appendingPathComponent(String(repeating: "a", count: 64)))
            try Data("temporary".utf8).write(to: root.appendingPathComponent(".tmp-interrupted"))
            let reopened = try BackupInbox(root: root)
            XCTAssertEqual(reopened.pending()?["id"] as? String, id)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".tmp-interrupted").path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(String(repeating: "a", count: 64)).path))
            XCTAssertEqual(try reopened.read(id: id, offset: 0, length: 8), Data("original".utf8))
        }
    }
}
