package com.opentunes.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaControls")
public class MediaControlsPlugin extends Plugin {

    @Override
    public void load() {
        // Listen for media button actions from the service and forward to JS
        KeepAliveService.setMediaActionCallback(action -> {
            JSObject data = new JSObject();

            if (action.startsWith("seekTo:")) {
                data.put("action", "seekTo");
                try {
                    long posMs = Long.parseLong(action.substring(7));
                    data.put("seekPosition", posMs / 1000.0);
                } catch (NumberFormatException e) {
                    return;
                }
            } else {
                data.put("action", action);
            }

            notifyListeners("mediaControlAction", data);
        });
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        String artUrl = call.getString("artUrl", null);
        double duration = call.getDouble("duration", 0.0);
        long durationMs = (long) (duration * 1000);

        KeepAliveService service = KeepAliveService.getInstance();
        if (service != null) {
            service.updateMetadata(title, artist, album, artUrl, durationMs);
        }

        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        boolean isPlaying = call.getBoolean("isPlaying", false);
        double position = call.getDouble("position", 0.0);
        long positionMs = (long) (position * 1000);

        KeepAliveService service = KeepAliveService.getInstance();
        if (service != null) {
            service.updatePlaybackState(isPlaying, positionMs);
        }

        call.resolve();
    }
}
