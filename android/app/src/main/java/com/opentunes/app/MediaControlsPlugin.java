package com.opentunes.app;

import android.os.Bundle;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "MediaControls")
public class MediaControlsPlugin extends Plugin {

    @Override
    public void load() {
        // Listen for media button actions from the service and forward to JS
        OpenTunesMediaService.setMediaActionCallback(action -> {
            JSObject data = new JSObject();

            if (action.startsWith("seekTo:")) {
                data.put("action", "seekTo");
                try {
                    long posMs = Long.parseLong(action.substring(7));
                    data.put("seekPosition", posMs / 1000.0);
                } catch (NumberFormatException e) {
                    return;
                }
            } else if (action.startsWith("playFromMediaId:")) {
                data.put("action", "playFromMediaId");
                data.put("mediaId", action.substring(16));
            } else if (action.startsWith("skipToQueueItem:")) {
                data.put("action", "skipToQueueItem");
                try {
                    long idx = Long.parseLong(action.substring(16));
                    data.put("queueIndex", idx);
                } catch (NumberFormatException e) {
                    return;
                }
            } else if (action.startsWith("playFromSearch:")) {
                data.put("action", "playFromSearch");
                String payload = action.substring(15);
                String[] parts = payload.split("\\|");
                data.put("query", parts[0]);
                for (int i = 1; i < parts.length; i++) {
                    String[] kv = parts[i].split(":", 2);
                    if (kv.length == 2 && !kv[1].isEmpty()) {
                        data.put(kv[0], kv[1]);
                    }
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

        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
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

        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            service.updatePlaybackState(isPlaying, positionMs);
        }

        call.resolve();
    }

    @PluginMethod
    public void updateLibrary(PluginCall call) {
        JSArray songs = call.getArray("songs");
        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null && songs != null) {
            List<Bundle> songList = new ArrayList<>();
            try {
                for (int i = 0; i < songs.length(); i++) {
                    JSONObject s = songs.getJSONObject(i);
                    Bundle b = new Bundle();
                    b.putString("title", s.optString("title", "Unknown"));
                    b.putString("artist", s.optString("artist", ""));
                    b.putString("album", s.optString("album", ""));
                    b.putString("path", s.optString("path", ""));
                    b.putString("art", s.optString("art", null));
                    b.putLong("duration", (long) (s.optDouble("duration", 0) * 1000));
                    songList.add(b);
                }
            } catch (Exception e) {
                // Skip malformed entries
            }
            service.setLibrary(songList);
        }
        call.resolve();
    }

    @PluginMethod
    public void updateQueue(PluginCall call) {
        JSArray songs = call.getArray("queue");
        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null && songs != null) {
            List<Bundle> queueList = new ArrayList<>();
            try {
                for (int i = 0; i < songs.length(); i++) {
                    JSONObject s = songs.getJSONObject(i);
                    Bundle b = new Bundle();
                    b.putString("title", s.optString("title", "Unknown"));
                    b.putString("artist", s.optString("artist", ""));
                    b.putString("album", s.optString("album", ""));
                    b.putString("path", s.optString("path", ""));
                    b.putString("art", s.optString("art", null));
                    b.putLong("duration", (long) (s.optDouble("duration", 0) * 1000));
                    queueList.add(b);
                }
            } catch (Exception e) {
                // Skip malformed entries
            }
            service.setQueue(queueList);
        }
        call.resolve();
    }
}
