package app.loopmark.craft;

import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import java.io.File;
import java.util.concurrent.*;

@CapacitorPlugin(name = "LoopmarkDurableFiles")
public class DurableFilesPlugin extends Plugin {
    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private DurableFiles store;
    private interface Work { JSObject run() throws Exception; }
    private void perform(PluginCall call, Work work) {
        queue.execute(() -> { try { if (store == null) store = new DurableFiles(getContext()); call.resolve(work.run()); }
        catch (Exception error) { call.reject("Private file operation failed", "LOCAL_STORAGE_FAILED"); } });
    }
    @PluginMethod public void put(PluginCall call) {
        String encoded = call.getString("base64");
        if (encoded == null || encoded.length() > 12 * 1024 * 1024) { call.reject("Invalid size", "INVALID_INPUT"); return; }
        perform(call, () -> { store.put(call.getString("key"), Base64.decode(encoded, Base64.NO_WRAP), call.getString("sha256")); return new JSObject(); });
    }
    @PluginMethod public void read(PluginCall call) { perform(call, () -> new JSObject().put("base64", Base64.encodeToString(store.read(call.getString("key")), Base64.NO_WRAP))); }
    @PluginMethod public void remove(PluginCall call) { perform(call, () -> { store.remove(call.getString("key")); return new JSObject(); }); }
    @PluginMethod public void list(PluginCall call) { perform(call, () -> {
        JSONArray files = new JSONArray(); for (File file : store.list()) files.put(new JSObject().put("key", file.getName()).put("modifiedAt", file.lastModified()));
        return new JSObject().put("files", files);
    }); }
    @PluginMethod public void sweepTemporary(PluginCall call) { perform(call, () -> { store.sweepTemporary(); return new JSObject(); }); }
}
