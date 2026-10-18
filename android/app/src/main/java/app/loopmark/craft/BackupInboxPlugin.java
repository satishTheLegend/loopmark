package app.loopmark.craft;

import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "LoopmarkBackupInbox")
public class BackupInboxPlugin extends Plugin {
    private final Runnable observer = () -> notifyListeners("changed", new JSObject(), true);
    @Override public void load() { BackupInbox.changed = observer; }
    @Override protected void handleOnDestroy() { if (BackupInbox.changed == observer) BackupInbox.changed = null; }
    private interface Work { JSObject run(BackupInbox store) throws Exception; }
    private void perform(PluginCall call, Work work) { BackupInbox.QUEUE.execute(() -> {
        try { call.resolve(work.run(new BackupInbox(getContext()))); }
        catch (Exception error) { call.reject("Private backup inbox operation failed", "LOCAL_STORAGE_FAILED"); }
    }); }
    @PluginMethod public void pending(PluginCall call) { perform(call, store -> new JSObject().put("item", store.pending() == null ? JSONObject.NULL : store.pending())); }
    @PluginMethod public void read(PluginCall call) { perform(call, store -> new JSObject().put("base64", Base64.encodeToString(store.read(call.getString("id"), call.getLong("offset", -1L), call.getInt("length", 0)), Base64.NO_WRAP))); }
    @PluginMethod public void finish(PluginCall call) { perform(call, store -> { store.finish(call.getString("id")); BackupInbox.notifyChanged(); return new JSObject(); }); }
}
