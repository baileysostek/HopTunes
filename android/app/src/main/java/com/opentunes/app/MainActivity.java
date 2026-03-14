package com.opentunes.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaControlsPlugin.class);
        registerPlugin(LocalLibraryPlugin.class);
        registerPlugin(NativeWebSocketPlugin.class);
        super.onCreate(savedInstanceState);

        // Grant camera permission to the WebView when JavaScript requests it
        this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        // Start the media browser service (also serves as foreground keep-alive)
        Intent serviceIntent = new Intent(this, OpenTunesMediaService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    @Override
    public void onDestroy() {
        // Stop the media service when the app is closed
        Intent serviceIntent = new Intent(this, OpenTunesMediaService.class);
        stopService(serviceIntent);
        super.onDestroy();
    }
}
