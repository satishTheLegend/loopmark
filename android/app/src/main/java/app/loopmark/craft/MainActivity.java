package app.loopmark.craft;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DurableFilesPlugin.class);
        registerPlugin(BackupInboxPlugin.class);
        super.onCreate(savedInstanceState);
        // BridgeActivity forwards the cold-launch intent through onNewIntent as well.
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        BackupInbox.accept(this, intent);
    }
}
