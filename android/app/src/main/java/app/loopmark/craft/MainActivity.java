package app.loopmark.craft;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DurableFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
