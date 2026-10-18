package app.loopmark.craft;

import android.content.Context;
import android.system.Os;
import android.system.OsConstants;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;

/** Immutable file publication. SQLite visibility is a later, separate commit. */
public final class DurableFiles {
    private final File root;
    public DurableFiles(Context context) throws Exception {
        root = new File(context.getFilesDir(), "loopmark/media");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Private directory unavailable");
        flushDirectory(context.getFilesDir());
        flushDirectory(root.getParentFile());
        flushDirectory(root);
    }
    private File path(String key) throws IOException {
        if (key == null || !key.matches("[a-f0-9]{64}")) throw new IOException("Invalid key");
        return new File(root, key);
    }
    private void flushDirectory() throws Exception { flushDirectory(root); }
    private void flushDirectory(File directory) throws Exception {
        FileDescriptor descriptor = Os.open(directory.getPath(), OsConstants.O_RDONLY, 0);
        try { Os.fsync(descriptor); } finally { Os.close(descriptor); }
    }
    public synchronized void put(String key, byte[] bytes, String hash) throws Exception {
        if (bytes.length == 0 || bytes.length > 8 * 1024 * 1024) throw new IOException("Invalid size");
        StringBuilder computed = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) computed.append(String.format(Locale.ROOT, "%02x", b & 255));
        if (!computed.toString().equals(hash)) throw new IOException("Hash mismatch");
        File destination = path(key);
        if (destination.exists()) {
            if (!Arrays.equals(read(key), bytes)) throw new IOException("Immutable collision");
            return;
        }
        File temp = File.createTempFile(".tmp-", "", root);
        try {
            try (FileOutputStream output = new FileOutputStream(temp)) { output.write(bytes); output.flush(); output.getFD().sync(); }
            // One app-private store serializes writers; no user-controlled paths or overwrites.
            if (destination.exists()) throw new IOException("Immutable collision");
            Os.rename(temp.getPath(), destination.getPath());
            flushDirectory();
        } finally { if (temp.exists()) temp.delete(); }
    }
    public synchronized byte[] read(String key) throws IOException {
        File file = path(key);
        if (file.length() > 8 * 1024 * 1024) throw new IOException("Invalid size");
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[65536]; int count;
            while ((count = input.read(chunk)) != -1) bytes.write(chunk, 0, count);
            return bytes.toByteArray();
        }
    }
    public synchronized void remove(String key) throws Exception {
        File file = path(key);
        if (file.exists() && !file.delete()) throw new IOException("Delete failed");
        flushDirectory();
    }
    public synchronized File[] list() throws IOException {
        File[] files = root.listFiles(); if (files == null) throw new IOException("List failed"); return files;
    }
    public synchronized void sweepTemporary() throws Exception {
        long cutoff = System.currentTimeMillis() - 86400000L;
        for (File file : list()) if (file.getName().startsWith(".tmp-") && file.lastModified() < cutoff && !file.delete()) throw new IOException("Cleanup failed");
        flushDirectory();
    }
}
