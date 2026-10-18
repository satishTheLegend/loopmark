package app.loopmark.craft;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import static org.junit.Assert.*;

/** Actual Android files and directory fsync; external intent delivery has its own test sender. */
@RunWith(AndroidJUnit4.class)
public class BackupInboxTest {
    private interface Check { void run(Context context, File root) throws Exception; }
    private void fixture(Check check) throws Exception {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(target.getCacheDir(), "inbox-test-" + UUID.randomUUID());
        assertTrue(directory.mkdirs());
        Context isolated = new ContextWrapper(target) { @Override public File getFilesDir() { return directory; } };
        try { check.run(isolated, new File(directory, "loopmark/incoming")); }
        finally { remove(directory); }
    }
    private void remove(File file) {
        if (file.isDirectory()) for (File child : file.listFiles()) remove(child);
        assertTrue(file.delete());
    }
    private ByteArrayInputStream bytes(String value) { return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)); }
    @Test public void reopenRepeatedFileAndHandledReceipt() throws Exception {
        fixture((context, root) -> {
            BackupInbox first = new BackupInbox(context);
            first.stage(bytes("durable inbox"), "fixture.json");
            JSONObject item = first.pending(); String id = item.getString("id"), token = item.getString("operationToken");
            BackupInbox reopened = new BackupInbox(context);
            assertEquals(token, reopened.pending().getString("operationToken"));
            assertArrayEquals("durable inbox".getBytes(StandardCharsets.UTF_8), reopened.read(id, 0, 13));
            reopened.stage(bytes("durable inbox"), "renamed.json");
            assertEquals(token, reopened.pending().getString("operationToken"));
            reopened.stage(bytes("different"), "different.json"); String notice = reopened.pending().getString("id");
            reopened.finish(id);
            new BackupInbox(context).finish(id);
            assertEquals(notice, new BackupInbox(context).pending().getString("id"));
            new BackupInbox(context).finish(notice);
            assertNull(new BackupInbox(context).pending()); assertFalse(new File(root, id).exists());
            BackupInbox repeated = new BackupInbox(context); repeated.stage(bytes("durable inbox"), "fixture.json");
            assertEquals("already-handled", repeated.pending().getString("state"));
            assertEquals(token, repeated.pending().getString("operationToken"));
            try { repeated.read(id, 0, 1); fail("Handled bytes must be gone"); } catch (IOException expected) {}
            repeated.finish(id); assertNull(new BackupInbox(context).pending());
        });
    }
    @Test public void failedPrivateAndNoticeWritesExposeFailure() throws Exception {
        fixture((context, root) -> {
            BackupInbox store = new BackupInbox(context); store.stage(bytes("original"), "original.json");
            String id = store.pending().getString("id"); File held = new File(root.getParentFile(), "held");
            assertTrue(root.renameTo(held)); assertTrue(root.createNewFile());
            try { store.stage(bytes("different"), "different.json"); fail("Private write must fail"); } catch (IOException expected) {}
            store.recordFailure("LOCAL_STORAGE_FAILED");
            JSONObject failure = store.pending(); assertEquals("LOCAL_STORAGE_FAILED", failure.getString("errorCode"));
            assertTrue(root.delete()); assertTrue(held.renameTo(root));
            BackupInbox reopened = new BackupInbox(context);
            assertEquals(failure.getString("id"), reopened.pending().getString("id"));
            reopened.finish(failure.getString("id")); assertEquals(id, reopened.pending().getString("id"));
            assertArrayEquals("original".getBytes(StandardCharsets.UTF_8), reopened.read(id, 0, 8));
        });
    }
    @Test public void maximumReceiptsWithMultibyteNamesFitBound() throws Exception {
        fixture((context, root) -> {
            BackupInbox store = new BackupInbox(context); store.stage(bytes("last receipt"), "界".repeat(160));
            String id = store.pending().getString("id"); File index = new File(root, "inbox.json");
            JSONObject manifest = new JSONObject(new String(java.nio.file.Files.readAllBytes(index.toPath()), StandardCharsets.UTF_8));
            org.json.JSONArray receipts = new org.json.JSONArray();
            for (int i = 0; i < 4095; i++) receipts.put(new JSONObject().put("id", String.format(java.util.Locale.ROOT, "%064x", i)).put("operationToken", UUID.randomUUID().toString()).put("receivedAt", "2026-01-01T00:00:00.000Z"));
            manifest.put("handled", receipts);
            try (FileOutputStream output = new FileOutputStream(index)) { output.write(manifest.toString().getBytes(StandardCharsets.UTF_8)); output.getFD().sync(); }
            new BackupInbox(context).finish(id); assertTrue(index.length() < 1024 * 1024);
            JSONObject finished = new JSONObject(new String(java.nio.file.Files.readAllBytes(index.toPath()), StandardCharsets.UTF_8));
            assertEquals(4096, finished.getJSONArray("handled").length()); assertFalse(finished.getJSONArray("handled").getJSONObject(4095).has("name"));
            BackupInbox repeated = new BackupInbox(context); repeated.stage(bytes("last receipt"), "界".repeat(160));
            assertEquals("already-handled", repeated.pending().getString("state")); repeated.finish(id);
            assertNull(new BackupInbox(context).pending());
        });
    }
    @Test public void busyLimitsAndOrphanCleanupPreserveOriginal() throws Exception {
        fixture((context, root) -> {
            BackupInbox store = new BackupInbox(context); store.stage(bytes("original"), "first.json");
            String id = store.pending().getString("id");
            store.stage(bytes("different"), "other.json");
            assertEquals("CAPABILITY_UNAVAILABLE", store.pending().getString("errorCode"));
            store.finish(store.pending().getString("id")); assertEquals(id, store.pending().getString("id"));
            try { store.stage(bytes(""), "empty.json"); fail("Empty file must fail"); } catch (IOException expected) {}
            InputStream oversized = new InputStream() {
                int left = BackupInbox.MAX + 1;
                @Override public int read() { return left-- > 0 ? 0 : -1; }
                @Override public int read(byte[] value) { if (left <= 0) return -1; int count = Math.min(left, value.length); left -= count; return count; }
            };
            try { store.stage(oversized, "oversized.json"); fail("Oversized stream must fail"); } catch (IOException expected) {}
            try { store.read("../escape", 0, 1); fail("Traversal must fail"); } catch (IOException expected) {}
            try { store.read(id, Long.MAX_VALUE, 1); fail("Overflow must fail"); } catch (IOException expected) {}
            assertTrue(new File(root, ".tmp-interrupted").createNewFile());
            assertTrue(new File(root, "a".repeat(64)).createNewFile());
            BackupInbox reopened = new BackupInbox(context);
            assertEquals(id, reopened.pending().getString("id"));
            assertFalse(new File(root, ".tmp-interrupted").exists()); assertFalse(new File(root, "a".repeat(64)).exists());
            assertArrayEquals("original".getBytes(StandardCharsets.UTF_8), reopened.read(id, 0, 8));
        });
    }
}
