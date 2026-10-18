import Capacitor

class LoopmarkViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DurableFilesPlugin())
    }
}
