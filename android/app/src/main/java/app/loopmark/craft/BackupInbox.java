package app.loopmark.craft;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.os.Build;
import android.database.Cursor;
import android.system.Os;
import android.system.OsConstants;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;

/** Only OS-delivered granted content URIs enter this private, single-file review inbox. */
final class BackupInbox {
    static final ExecutorService QUEUE = Executors.newSingleThreadExecutor();
    static volatile Runnable changed;
    // Only an error notice may fall back to memory when private storage itself is unavailable.
    private static JSONObject volatileFailure;
    static final int MAX = 50 * 1024 * 1024;
    private final File root;
    private JSONObject manifest;
    BackupInbox(Context context) throws Exception {
        root = new File(context.getFilesDir(), "loopmark/incoming");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Private inbox unavailable");
        flush(root.getParentFile().getParentFile()); flush(root.getParentFile()); flush(root);
        File index = new File(root, "inbox.json");
        if (index.exists()) {
            if (index.length() > 2 * 1024 * 1024) throw new IOException("Inbox metadata limit");
            manifest = new JSONObject(new String(readFile(index, 2 * 1024 * 1024), StandardCharsets.UTF_8));
            if (manifest.optInt("schemaVersion") != 1 || !(manifest.opt("handled") instanceof JSONArray)) throw new IOException("Invalid inbox metadata");
        } else manifest = new JSONObject().put("schemaVersion", 1).put("handled", new JSONArray());
        String pendingId = manifest.optJSONObject("pending") == null ? "" : manifest.getJSONObject("pending").getString("id");
        for (File file : Objects.requireNonNull(root.listFiles()))
            if (file.getName().startsWith(".tmp-") || (file.getName().matches("[a-f0-9]{64}") && !file.getName().equals(pendingId))) {
                if (!file.delete()) throw new IOException("Inbox cleanup failed");
            }
        flush(root);
    }
    static void accept(Context context, Intent intent) {
        if (intent == null || !(Intent.ACTION_VIEW.equals(intent.getAction()) || Intent.ACTION_SEND.equals(intent.getAction()))) return;
        Uri uri = Intent.ACTION_SEND.equals(intent.getAction()) ? (Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM)) : intent.getData();
        if (uri == null || !"content".equals(uri.getScheme())) return;
        Context application = context.getApplicationContext();
        QUEUE.execute(() -> {
            try {
                BackupInbox store = new BackupInbox(application);
                try {
                    if ((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0) throw new InvalidInput();
                    String name = "Incoming backup.json";
                    try (Cursor cursor = application.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE), nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            if (sizeColumn >= 0 && !cursor.isNull(sizeColumn) && cursor.getLong(sizeColumn) > MAX) throw new InvalidInput();
                            if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn);
                        }
                    }
                    try (InputStream input = application.getContentResolver().openInputStream(uri)) {
                        if (input == null) throw new InvalidInput();
                        store.stage(input, name);
                    }
                } catch (Exception error) { store.recordFailure(error instanceof InvalidInput || error instanceof SecurityException ? "VALIDATION" : "LOCAL_STORAGE_FAILED"); }
            } catch (Exception ignored) { storageFailure(); }
            notifyChanged();
        });
    }
    static void notifyChanged() { Runnable observer = changed; if (observer != null) observer.run(); }
    private static void flush(File directory) throws Exception {
        FileDescriptor fd = Os.open(directory.getPath(), OsConstants.O_RDONLY, 0);
        try { Os.fsync(fd); } finally { Os.close(fd); }
    }
    private static byte[] readFile(File file, int limit) throws Exception {
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > limit) throw new IOException("Size limit"); bytes.write(buffer, 0, count); }
            return bytes.toByteArray();
        }
    }
    private static String hash(byte[] value) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(value)); }
    private static String hex(byte[] value) { StringBuilder result = new StringBuilder(); for (byte b : value) result.append(String.format(Locale.ROOT, "%02x", b & 255)); return result.toString(); }
    private void save() throws Exception {
        byte[] bytes = manifest.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 2 * 1024 * 1024) throw new IOException("Inbox metadata limit");
        File temp = File.createTempFile(".tmp-", "", root);
        try {
            try (FileOutputStream output = new FileOutputStream(temp)) { output.write(bytes); output.flush(); output.getFD().sync(); }
            Os.rename(temp.getPath(), new File(root, "inbox.json").getPath()); flush(root);
        } finally { if (temp.exists()) temp.delete(); }
    }
    private static JSONObject item(String id, String name, int bytes, String state) throws Exception {
        String safeName = name == null ? "Incoming backup.json" : name.replaceAll("[\\p{Cntrl}]", "");
        if (safeName.length() > 160) safeName = safeName.substring(0, 160);
        SimpleDateFormat date = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT); date.setTimeZone(TimeZone.getTimeZone("UTC"));
        return new JSONObject().put("id", id).put("operationToken", UUID.randomUUID().toString()).put("name", safeName).put("bytes", bytes).put("receivedAt", date.format(new Date())).put("state", state);
    }
    private void notice(String code) throws Exception {
        JSONObject existing = manifest.optJSONObject("notice");
        if (existing != null && code.equals(existing.optString("errorCode"))) return;
        manifest.put("notice", item(hash(UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8)), "Incoming backup", 0, "failed").put("errorCode", code)); save();
    }
    static JSONObject storageFailure() {
        if (volatileFailure == null) try {
            volatileFailure = item(hash(UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8)), "Incoming backup was not saved", 0, "failed").put("errorCode", "LOCAL_STORAGE_FAILED");
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
        return volatileFailure;
    }
    static JSONObject pendingFailure() { return volatileFailure; }
    static boolean finishFailure(String id) {
        if (volatileFailure != null && volatileFailure.optString("id").equals(id)) { volatileFailure = null; return true; }
        return false;
    }
    void recordFailure(String code) {
        try { notice(code); } catch (Exception error) { storageFailure(); }
    }
    private static JSONObject receipt(JSONObject value) throws Exception {
        return new JSONObject().put("id", value.getString("id")).put("operationToken", value.getString("operationToken")).put("receivedAt", value.getString("receivedAt"));
    }
    private static JSONObject repeated(JSONObject value) throws Exception {
        return receipt(value).put("name", "Previously handled backup").put("bytes", 0).put("state", "already-handled");
    }
    private static class InvalidInput extends IOException {}
    void stage(InputStream input, String name) throws Exception {
        File temp = File.createTempFile(".tmp-", "", root);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256"); int total = 0;
            try (FileOutputStream output = new FileOutputStream(temp)) {
                byte[] chunk = new byte[65536]; int count;
                while ((count = input.read(chunk)) != -1) {
                    if (total + count > MAX) throw new InvalidInput();
                    total += count; digest.update(chunk, 0, count); output.write(chunk, 0, count);
                }
                if (total == 0) throw new InvalidInput();
                output.flush(); output.getFD().sync();
            }
            String id = hex(digest.digest());
            JSONObject pending = manifest.optJSONObject("pending");
            if (pending != null && id.equals(pending.getString("id"))) return;
            JSONArray handled = manifest.getJSONArray("handled");
            for (int i = 0; i < handled.length(); i++) if (id.equals(handled.getJSONObject(i).getString("id"))) {
                manifest.put("notice", repeated(handled.getJSONObject(i))); save(); return;
            }
            if (pending != null) { notice("CAPABILITY_UNAVAILABLE"); return; }
            if (handled.length() >= 4096) { notice("TECHNICAL_CAPACITY_REACHED"); return; }
            File destination = new File(root, id);
            Os.rename(temp.getPath(), destination.getPath()); flush(root);
            manifest.put("pending", item(id, name, total, "ready")); save();
        } finally { if (temp.exists()) temp.delete(); }
    }
    JSONObject pending() { if (volatileFailure != null) return volatileFailure; JSONObject notice = manifest.optJSONObject("notice"); return notice == null ? manifest.optJSONObject("pending") : notice; }
    byte[] read(String id, long offset, int length) throws Exception {
        JSONObject pending = manifest.optJSONObject("pending");
        if (pending == null || !pending.getString("id").equals(id) || !id.matches("[a-f0-9]{64}") || offset < 0 || length < 1 || length > 512 * 1024 || offset > pending.getInt("bytes") - length) throw new IOException("Invalid private read");
        try (RandomAccessFile file = new RandomAccessFile(new File(root, id), "r")) {
            if (file.length() != pending.getInt("bytes")) throw new IOException("Changed backup bytes");
            file.seek(offset); byte[] bytes = new byte[length]; file.readFully(bytes); return bytes;
        }
    }
    void finish(String id) throws Exception {
        if (finishFailure(id)) return;
        JSONObject notice = manifest.optJSONObject("notice"), pending = manifest.optJSONObject("pending");
        if (notice != null && notice.getString("id").equals(id)) { manifest.remove("notice"); save(); return; }
        if (pending == null || !pending.getString("id").equals(id)) {
            JSONArray handled = manifest.getJSONArray("handled");
            for (int i = 0; i < handled.length(); i++) if (handled.getJSONObject(i).getString("id").equals(id)) return;
            throw new IOException("Unknown backup");
        }
        manifest.getJSONArray("handled").put(receipt(pending)); manifest.remove("pending"); save();
        File file = new File(root, id); if (file.exists() && !file.delete()) throw new IOException("Inbox cleanup failed"); flush(root);
    }
}
