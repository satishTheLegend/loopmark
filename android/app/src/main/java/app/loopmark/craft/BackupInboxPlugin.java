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
    @PluginMethod public void pending(PluginCall call) { BackupInbox.QUEUE.execute(() -> {
        JSONObject item;
        try { item = new BackupInbox(getContext()).pending(); }
        catch (Exception error) { item = BackupInbox.storageFailure(); }
        call.resolve(new JSObject().put("item", item == null ? JSONObject.NULL : item));
    }); }
    @PluginMethod public void read(PluginCall call) { perform(call, store -> new JSObject().put("base64", Base64.encodeToString(store.read(call.getString("id"), call.getInt("offset", -1), call.getInt("length", 0)), Base64.NO_WRAP))); }
    @PluginMethod public void finish(PluginCall call) { BackupInbox.QUEUE.execute(() -> {
        try {
            String id = call.getString("id");
            if (!BackupInbox.finishFailure(id)) new BackupInbox(getContext()).finish(id);
            BackupInbox.notifyChanged(); call.resolve(new JSObject());
        } catch (Exception error) { call.reject("Private backup inbox operation failed", "LOCAL_STORAGE_FAILED"); }
    }); }
}
