package app.loopmark.craft;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.ComponentName;
import android.content.ClipData;
import android.net.Uri;

/** Installed only in the test APK; real separate-UID OS grants exercise production intake. */
public class BackupSenderActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String target = getIntent().getStringExtra("target");
        if (!"app.loopmark.craft".equals(target) && !"app.loopmark.craft.benchmark".equals(target)) { finish(); return; }
        String kind = getIntent().getStringExtra("kind"), tag = getIntent().getStringExtra("tag");
        if (kind == null) kind = "valid";
        if (!kind.matches("valid|other|invalid|empty|oversized")) { finish(); return; }
        if (tag == null || !tag.matches("[A-Za-z0-9_-]{1,60}")) tag = "fixed";
        Uri uri = new Uri.Builder().scheme("content").authority(getPackageName() + ".backupfixture").appendPath(kind).appendQueryParameter("tag", tag).build();
        boolean send = getIntent().getBooleanExtra("send", false);
        Intent launch = new Intent(send ? Intent.ACTION_SEND : Intent.ACTION_VIEW);
        launch.setComponent(new ComponentName(target, "app.loopmark.craft.MainActivity"));
        launch.setDataAndType(uri, "application/json");
        if (send) launch.putExtra(Intent.EXTRA_STREAM, uri);
        launch.setClipData(ClipData.newRawUri("Synthetic backup", uri));
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (!getIntent().getBooleanExtra("noGrant", false)) launch.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(launch); finish();
    }
}
