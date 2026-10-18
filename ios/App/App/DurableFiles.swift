import Foundation
import CryptoKit
import Darwin

// Files are immutable. Visibility is committed separately by SQLite after put returns.
final class DurableFiles {
    private let root: URL
    init(root: URL? = nil) throws {
        self.root = root ?? FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Loopmark/Media", isDirectory: true)
        try FileManager.default.createDirectory(at: self.root, withIntermediateDirectories: true)
        var excluded = self.root.deletingLastPathComponent()
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        try flushDirectory(self.root.deletingLastPathComponent().deletingLastPathComponent())
        try flushDirectory(self.root.deletingLastPathComponent())
        try flushDirectory(self.root)
    }
    private func url(_ key: String) throws -> URL {
        guard key.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.invalidKey }
        return root.appendingPathComponent(key, isDirectory: false)
    }
    private func flushDirectory(_ directory: URL? = nil) throws {
        let descriptor = Darwin.open((directory ?? root).path, O_RDONLY)
        guard descriptor >= 0 else { throw Failure.io }
        defer { Darwin.close(descriptor) }
        guard fsync(descriptor) == 0 else { throw Failure.io }
    }
    func put(key: String, bytes: Data, hash: String) throws {
        guard bytes.count > 0, bytes.count <= 8 * 1024 * 1024,
              SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == hash else { throw Failure.integrity }
        let target = try url(key)
        if FileManager.default.fileExists(atPath: target.path) {
            guard try Data(contentsOf: target) == bytes else { throw Failure.immutable }
            return
        }
        let temp = root.appendingPathComponent(".tmp-" + UUID().uuidString)
        guard FileManager.default.createFile(atPath: temp.path, contents: nil) else { throw Failure.io }
        defer { try? FileManager.default.removeItem(at: temp) }
        let handle = try FileHandle(forWritingTo: temp)
        do {
            try handle.write(contentsOf: bytes)
            try handle.synchronize()
            // F_FULLFSYNC asks Apple storage to flush hardware caches as well.
            guard fcntl(handle.fileDescriptor, F_FULLFSYNC) == 0 else { throw Failure.io }
            try handle.close()
        } catch { try? handle.close(); throw error }
        // Same-volume exclusive rename avoids accidentally replacing immutable bytes.
        guard renamex_np(temp.path, target.path, UInt32(RENAME_EXCL)) == 0 else {
            if errno == EEXIST, try Data(contentsOf: target) == bytes { return }
            throw Failure.io
        }
        try flushDirectory()
    }
    func read(key: String) throws -> Data { try Data(contentsOf: url(key)) }
    func remove(key: String) throws {
        let target = try url(key)
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target); try flushDirectory() }
    }
    func list() throws -> [[String: Any]] {
        try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey]).map { item in
            let values = try item.resourceValues(forKeys: [.contentModificationDateKey])
            return ["key": item.lastPathComponent, "modifiedAt": (values.contentModificationDate ?? .distantFuture).timeIntervalSince1970 * 1000]
        }
    }
    func sweepTemporary(before: Date) throws {
        for item in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey]) where item.lastPathComponent.hasPrefix(".tmp-") {
            if let date = try item.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, date < before { try FileManager.default.removeItem(at: item) }
        }
        try flushDirectory()
    }
    enum Failure: Error { case invalidKey, integrity, immutable, io }
}
