package com.opentunes.app;

import android.app.SearchManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.support.v4.media.session.MediaSessionCompat;
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

        handleVoiceSearchIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleVoiceSearchIntent(intent);
    }

    /**
     * If the activity was launched by Google Assistant for voice search,
     * forward the query to the MediaSession's onPlayFromSearch callback.
     */
    private void handleVoiceSearchIntent(Intent intent) {
        if (intent == null) return;
        if (!"android.media.action.MEDIA_PLAY_FROM_SEARCH".equals(intent.getAction())) return;

        String query = intent.getStringExtra(SearchManager.QUERY);

        // Delegate to the MediaSession callback via the service
        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            MediaSessionCompat session = service.getMediaSession();
            if (session != null) {
                session.getController().getTransportControls()
                        .playFromSearch(query != null ? query : "", intent.getExtras());
            }
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
