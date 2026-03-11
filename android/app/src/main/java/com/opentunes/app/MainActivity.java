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
        super.onCreate(savedInstanceState);

        // Grant camera permission to the WebView when JavaScript requests it
        this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        // Start the foreground service to keep the app alive with the screen off
        Intent serviceIntent = new Intent(this, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    @Override
    public void onDestroy() {
        // Stop the keep-alive service when the app is closed
        Intent serviceIntent = new Intent(this, KeepAliveService.class);
        stopService(serviceIntent);
        super.onDestroy();
    }
}
