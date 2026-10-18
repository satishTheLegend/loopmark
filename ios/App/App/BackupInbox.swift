import Foundation
import CryptoKit
import Darwin

/** One private staged file. Input URLs enter only through OS document-open callbacks. */
final class BackupInbox {
    static let queue = DispatchQueue(label: "app.loopmark.backup-inbox")
    static let changed = Notification.Name("LoopmarkBackupInboxChanged")
    static let maximum = 50 * 1024 * 1024
    private let root: URL
    private var manifest: [String: Any]
    init(root: URL? = nil) throws {
        self.root = root ?? FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Loopmark/Incoming", isDirectory: true)
        try FileManager.default.createDirectory(at: self.root, withIntermediateDirectories: true)
        var excluded = self.root.deletingLastPathComponent(), values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        let index = self.root.appendingPathComponent("inbox.json")
        if FileManager.default.fileExists(atPath: index.path) {
            let size = try index.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
            guard size <= 2 * 1024 * 1024,
                  let value = try JSONSerialization.jsonObject(with: Data(contentsOf: index)) as? [String: Any],
                  value["schemaVersion"] as? Int == 1, value["handled"] is [[String: Any]] else { throw Failure.storage }
            manifest = value
        } else { manifest = ["schemaVersion": 1, "handled": [[String: Any]]()] }
        let pendingId = (manifest["pending"] as? [String: Any])?["id"] as? String
        for file in try FileManager.default.contentsOfDirectory(at: self.root, includingPropertiesForKeys: nil) {
            if file.lastPathComponent.hasPrefix(".tmp-") || (Self.validID(file.lastPathComponent) && file.lastPathComponent != pendingId) { try FileManager.default.removeItem(at: file) }
        }
        try flush(self.root.deletingLastPathComponent()); try flush(self.root)
    }
    static func accept(_ url: URL) {
        guard url.isFileURL else { return }
        queue.async {
            do {
                let store = try BackupInbox()
                do {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    var coordinationError: NSError?, failure: Error?
                    NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { readable in
                        do { try store.stage(readable) } catch { failure = error }
                    }
                    if let failure = failure { throw failure }
                    if let coordinationError = coordinationError { throw coordinationError }
                } catch { try store.notice("VALIDATION") }
            } catch { /* pending() exposes storage failure; no project data is changed. */ }
            NotificationCenter.default.post(name: changed, object: nil)
        }
    }
    private static func validID(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    private static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    private func flush(_ directory: URL) throws {
        let fd = Darwin.open(directory.path, O_RDONLY)
        guard fd >= 0 else { throw Failure.storage }; defer { Darwin.close(fd) }
        guard fsync(fd) == 0 else { throw Failure.storage }
    }
    private func write(_ bytes: Data, to file: URL) throws {
        guard FileManager.default.createFile(atPath: file.path, contents: nil) else { throw Failure.storage }
        let handle = try FileHandle(forWritingTo: file)
        do {
            try handle.write(contentsOf: bytes); try handle.synchronize()
            guard fcntl(handle.fileDescriptor, F_FULLFSYNC) == 0 else { throw Failure.storage }
            try handle.close()
        } catch { try? handle.close(); throw error }
    }
    private func save() throws {
        let bytes = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
        guard bytes.count <= 2 * 1024 * 1024 else { throw Failure.storage }
        let temp = root.appendingPathComponent(".tmp-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temp) }
        try write(bytes, to: temp)
        guard Darwin.rename(temp.path, root.appendingPathComponent("inbox.json").path) == 0 else { throw Failure.storage }
        try flush(root)
    }
    private func item(id: String, name: String, bytes: Int, state: String) -> [String: Any] {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let scalars = name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.map(String.init).joined()
        let cleaned = String(decoding: Array(scalars.utf16.prefix(160)), as: UTF16.self)
        return ["id": id, "operationToken": UUID().uuidString.lowercased(), "name": cleaned, "bytes": bytes, "receivedAt": formatter.string(from: Date()), "state": state]
    }
    private func notice(_ code: String) throws {
        if (manifest["notice"] as? [String: Any])?["errorCode"] as? String == code { return }
        var value = item(id: Self.hash(Data(UUID().uuidString.utf8)), name: "Incoming backup", bytes: 0, state: "failed")
        value["errorCode"] = code; manifest["notice"] = value; try save()
    }
    func stage(_ url: URL) throws {
        let resource = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .nameKey])
        guard resource.isRegularFile == true, (resource.fileSize ?? Int.max) <= Self.maximum else { throw Failure.invalid }
        let input = try FileHandle(forReadingFrom: url), temp = root.appendingPathComponent(".tmp-" + UUID().uuidString)
        defer { try? input.close(); try? FileManager.default.removeItem(at: temp) }
        guard FileManager.default.createFile(atPath: temp.path, contents: nil) else { throw Failure.storage }
        let output = try FileHandle(forWritingTo: temp)
        var total = 0, digest = SHA256()
        do {
            while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
                total += chunk.count; guard total <= Self.maximum else { throw Failure.invalid }
                digest.update(data: chunk); try output.write(contentsOf: chunk)
            }
            guard total > 0 else { throw Failure.invalid }
            try output.synchronize(); guard fcntl(output.fileDescriptor, F_FULLFSYNC) == 0 else { throw Failure.storage }; try output.close()
        } catch { try? output.close(); throw error }
        let id = digest.finalize().map { String(format: "%02x", $0) }.joined(), pending = manifest["pending"] as? [String: Any]
        if pending?["id"] as? String == id { return }
        let handled = manifest["handled"] as? [[String: Any]] ?? []
        if let previous = handled.first(where: { $0["id"] as? String == id }) { var notice = previous; notice["state"] = "already-handled"; manifest["notice"] = notice; try save(); return }
        if pending != nil { try notice("CAPABILITY_UNAVAILABLE"); return }
        if handled.count >= 4096 { try notice("TECHNICAL_CAPACITY_REACHED"); return }
        guard Darwin.rename(temp.path, root.appendingPathComponent(id).path) == 0 else { throw Failure.storage }
        try flush(root)
        manifest["pending"] = item(id: id, name: resource.name ?? "Incoming backup.json", bytes: total, state: "ready"); try save()
    }
    func pending() -> [String: Any]? { manifest["notice"] as? [String: Any] ?? manifest["pending"] as? [String: Any] }
    func read(id: String, offset: Int, length: Int) throws -> Data {
        guard Self.validID(id), let pending = manifest["pending"] as? [String: Any], pending["id"] as? String == id,
              let size = pending["bytes"] as? Int, offset >= 0, length > 0, length <= 512 * 1024, offset <= size - length else { throw Failure.invalid }
        let file = root.appendingPathComponent(id)
        guard try file.resourceValues(forKeys: [.fileSizeKey]).fileSize == size else { throw Failure.invalid }
        let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
        try input.seek(toOffset: UInt64(offset)); let bytes = try input.read(upToCount: length) ?? Data()
        guard bytes.count == length else { throw Failure.invalid }; return bytes
    }
    func finish(id: String) throws {
        if let notice = manifest["notice"] as? [String: Any], notice["id"] as? String == id { manifest.removeValue(forKey: "notice"); try save(); return }
        guard var pending = manifest["pending"] as? [String: Any], pending["id"] as? String == id else { throw Failure.invalid }
        pending["state"] = "already-handled"
        var handled = manifest["handled"] as? [[String: Any]] ?? []; handled.append(pending)
        manifest["handled"] = handled; manifest.removeValue(forKey: "pending"); try save()
        let file = root.appendingPathComponent(id); if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }; try flush(root)
    }
    enum Failure: Error { case invalid, storage }
}
