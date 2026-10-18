package app.loopmark.craft;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Synthetic bounded documents only; never bundled in the product APK. */
public class BackupFixtureProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/json"; }
    private File fixture(Uri uri) throws Exception {
        String kind = uri.getLastPathSegment(), tag = uri.getQueryParameter("tag");
        if (kind == null || !kind.matches("valid|other|invalid|empty|oversized") || tag == null || !tag.matches("[A-Za-z0-9_-]{1,60}")) throw new FileNotFoundException();
        File directory = new File(getContext().getCacheDir(), "synthetic-inbox-sender"); directory.mkdirs();
        File file = new File(directory, kind + "-" + tag + ".json");
        if (file.exists()) return file;
        if ("oversized".equals(kind)) { try (RandomAccessFile output = new RandomAccessFile(file, "rw")) { output.setLength(50L * 1024 * 1024 + 1); } return file; }
        String body = "";
        if ("invalid".equals(kind)) body = "{invalid synthetic JSON " + tag;
        if ("valid".equals(kind) || "other".equals(kind)) {
            String time = "2026-01-01T00:00:00.000Z";
            JSONObject checkpoint = new JSONObject().put("id", "external_checkpoint").put("createdAt", time).put("position", "Row 24").put("toolSize", "4 mm").put("nextStep", "Turn and continue from the external backup").put("notes", "");
            JSONObject project = new JSONObject().put("id", "external_project").put("code", "EXT-1").put("name", "External " + kind + " " + tag).put("craft", "Crochet").put("color", "clay").put("toolSize", "4 mm").put("yarn", "Synthetic fixture").put("notes", "").put("status", "active").put("createdAt", time).put("updatedAt", time).put("checkpoints", new JSONArray().put(checkpoint));
            body = new JSONObject().put("format", "loopmark").put("version", 1).put("exportedAt", time).put("projects", new JSONArray().put(project)).toString();
        }
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(body.getBytes(StandardCharsets.UTF_8)); output.getFD().sync(); }
        return file;
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        try {
            File file = fixture(uri);
            String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns); Object[] row = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) row[i] = OpenableColumns.DISPLAY_NAME.equals(columns[i]) ? file.getName() : OpenableColumns.SIZE.equals(columns[i]) ? file.length() : null;
            cursor.addRow(row); return cursor;
        } catch (Exception error) { return null; }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException();
        try { return ParcelFileDescriptor.open(fixture(uri), ParcelFileDescriptor.MODE_READ_ONLY); }
        catch (Exception error) { throw new FileNotFoundException("Synthetic fixture unavailable"); }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
