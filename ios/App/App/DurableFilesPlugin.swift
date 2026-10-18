import Capacitor
import Foundation

@objc(DurableFilesPlugin)
public class DurableFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DurableFilesPlugin"
    public let jsName = "LoopmarkDurableFiles"
    public let pluginMethods: [CAPPluginMethod] = ["put", "read", "remove", "list", "sweepTemporary"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let queue = DispatchQueue(label: "app.loopmark.durable-files")
    private func perform(_ call: CAPPluginCall, _ work: @escaping (DurableFiles) throws -> JSObject) {
        queue.async {
            do { call.resolve(try work(DurableFiles())) }
            catch { call.reject("Private file operation failed", "LOCAL_STORAGE_FAILED") }
        }
    }
    @objc func put(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let encoded = call.getString("base64"), encoded.count <= 12 * 1024 * 1024,
              let bytes = Data(base64Encoded: encoded), let hash = call.getString("sha256") else { call.reject("Invalid file input", "INVALID_INPUT"); return }
        perform(call) { store in try store.put(key: key, bytes: bytes, hash: hash); return [:] }
    }
    @objc func read(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("Missing key", "INVALID_INPUT"); return }
        perform(call) { ["base64": try $0.read(key: key).base64EncodedString()] }
    }
    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("Missing key", "INVALID_INPUT"); return }
        perform(call) { try $0.remove(key: key); return [:] }
    }
    @objc func list(_ call: CAPPluginCall) { perform(call) { ["files": try $0.list()] } }
    @objc func sweepTemporary(_ call: CAPPluginCall) { perform(call) { try $0.sweepTemporary(before: Date().addingTimeInterval(-86400)); return [:] } }
}
