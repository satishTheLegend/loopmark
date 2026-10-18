package app.loopmark.craft;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DurableFilesTest {
    private String hash(byte[] bytes) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    @Test public void immutableByteRoundtripAcrossStoreReopen() throws Exception {
        byte[] bytes = "loopmark-synthetic-persistence".getBytes(StandardCharsets.UTF_8);
        String key = hash(bytes);
        DurableFiles first = new DurableFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());
        first.put(key, bytes, key);
        DurableFiles reopened = new DurableFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());
        assertArrayEquals(bytes, reopened.read(key));
        reopened.put(key, bytes, key);
        byte[] changed = "different".getBytes(StandardCharsets.UTF_8);
        try { reopened.put(key, changed, hash(changed)); fail("Must reject overwrite"); } catch (java.io.IOException expected) {}
        assertArrayEquals(bytes, reopened.read(key));
        reopened.remove(key);
    }
    @Test public void rejectsTraversalAndCorruptionWithoutPublication() throws Exception {
        DurableFiles store = new DurableFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());
        byte[] bytes = "synthetic".getBytes(StandardCharsets.UTF_8);
        try { store.put("../escape", bytes, hash(bytes)); fail("Must reject traversal"); } catch (java.io.IOException expected) {}
        try { store.put(hash(bytes), bytes, "0".repeat(64)); fail("Must reject hash mismatch"); } catch (java.io.IOException expected) {}
    }
}
