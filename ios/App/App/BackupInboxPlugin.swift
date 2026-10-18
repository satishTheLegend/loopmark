import Capacitor
import Foundation

@objc(BackupInboxPlugin)
public class BackupInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackupInboxPlugin"
    public let jsName = "LoopmarkBackupInbox"
    public let pluginMethods: [CAPPluginMethod] = ["pending", "read", "finish"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private var observer: NSObjectProtocol?
    public override func load() {
        observer = NotificationCenter.default.addObserver(forName: BackupInbox.changed, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("changed", data: [:], retainUntilConsumed: true)
        }
    }
    deinit { if let observer = observer { NotificationCenter.default.removeObserver(observer) } }
    private func perform(_ call: CAPPluginCall, _ work: @escaping (BackupInbox) throws -> JSObject) {
        BackupInbox.queue.async {
            do { call.resolve(try work(BackupInbox())) }
            catch { call.reject("Private backup inbox operation failed", "LOCAL_STORAGE_FAILED") }
        }
    }
    @objc func pending(_ call: CAPPluginCall) {
        BackupInbox.queue.async {
            let item: [String: Any]?
            do { item = try BackupInbox().pending() } catch { item = BackupInbox.storageFailure() }
            if let item = item, let value = item as? JSObject { call.resolve(["item": value]) }
            else { call.resolve(["item": NSNull()]) }
        }
    }
    @objc func read(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let offset = call.getInt("offset"), let length = call.getInt("length") else { call.reject("Invalid private read", "VALIDATION"); return }
        perform(call) { ["base64": try $0.read(id: id, offset: offset, length: length).base64EncodedString()] }
    }
    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("Invalid private receipt", "VALIDATION"); return }
        BackupInbox.queue.async {
            do {
                if !BackupInbox.finishFailure(id: id) { try BackupInbox().finish(id: id) }
                call.resolve([:])
            } catch { call.reject("Private backup inbox operation failed", "LOCAL_STORAGE_FAILED") }
        }
    }
}
