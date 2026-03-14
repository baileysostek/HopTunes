package com.opentunes.app;

import android.media.MediaMetadataRetriever;
import android.util.Base64;
import android.util.Log;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Native WebSocket client that runs in the foreground service, surviving
 * Android WebView suspension when the screen is off.
 *
 * Handles autonomously (no JS needed):
 *   - Heartbeat every 5s
 *   - Reverse audio streaming (request-audio -> file read -> binary frames)
 *   - Reverse art extraction (request-art -> embedded art -> JSON response)
 *   - Reconnection with exponential backoff
 *   - Playback state interception for native MediaPlayer and lock screen
 *   - HTTP playback control (play/pause/skip) for lock screen buttons
 *
 * Forwards all other messages (state, library, welcome, etc.) to JS via the
 * MessageForwarder callback.
 */
public class NativeWebSocketManager {

    private static final String TAG = "NativeWS";
    private static final int HEARTBEAT_INTERVAL_MS = 5000;
    private static final int MAX_RECONNECT_DELAY_MS = 5000;
    private static final int CHUNK_SIZE = 64 * 1024; // 64KB
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json");

    private final OkHttpClient client;
    private final ScheduledExecutorService scheduler;
    private final ExecutorService fileIoExecutor;
    private final AtomicReference<WebSocket> webSocketRef = new AtomicReference<>(null);

    private ScheduledFuture<?> heartbeatTask;
    private ScheduledFuture<?> reconnectTask;

    // Connection params (set from JS via plugin)
    private String wsUrl;
    private String deviceId;
    private String deviceName;
    private String deviceType;

    // Derived from wsUrl for HTTP API calls and audio URL construction
    private String httpBaseUrl;
    private String authToken;

    // Cached edge library JSON for re-announcement on reconnect
    private volatile String cachedEdgeLibraryJson;

    private volatile boolean connected = false;
    private volatile boolean shouldReconnect = true;
    private int reconnectDelay = 1000;

    private volatile MessageForwarder forwarder;

    public interface MessageForwarder {
        void onMessage(String json);
        void onConnected();
        void onDisconnected(int code, String reason);
    }

    public NativeWebSocketManager() {
        client = new OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build();
        scheduler = Executors.newSingleThreadScheduledExecutor();
        fileIoExecutor = Executors.newSingleThreadExecutor();
    }

    public void setForwarder(MessageForwarder forwarder) {
        this.forwarder = forwarder;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public synchronized void connect(String wsUrl, String deviceId,
                                     String deviceName, String deviceType) {
        this.wsUrl = wsUrl;
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.deviceType = deviceType;

        extractConnectionInfo();

        this.shouldReconnect = true;
        this.reconnectDelay = 1000;

        doConnect();
    }

    public synchronized void disconnect() {
        shouldReconnect = false;
        cancelReconnect();
        stopHeartbeat();

        WebSocket ws = webSocketRef.getAndSet(null);
        if (ws != null) {
            ws.close(1000, "app closing");
        }
        connected = false;
    }

    public boolean isConnected() {
        return connected;
    }

    public void sendMessage(String json) {
        WebSocket ws = webSocketRef.get();
        if (ws != null && connected) {
            ws.send(json);
        }
    }

    public void cacheEdgeLibrary(String json) {
        this.cachedEdgeLibraryJson = json;
    }

    public void shutdown() {
        disconnect();
        scheduler.shutdownNow();
        fileIoExecutor.shutdownNow();
        client.dispatcher().cancelAll();
    }

    // --- HTTP API helpers for playback control ---

    public String getHttpBaseUrl() {
        return httpBaseUrl;
    }

    public String getAuthToken() {
        return authToken;
    }

    /** POST /api/playback/resume */
    public void postResume() {
        postPlaybackAction("/api/playback/resume");
    }

    /** POST /api/playback/pause */
    public void postPause() {
        postPlaybackAction("/api/playback/pause");
    }

    /** POST /api/playback/skip */
    public void postSkip() {
        postPlaybackAction("/api/playback/skip");
    }

    /** POST /api/playback/skip-prev */
    public void postSkipPrev() {
        postPlaybackAction("/api/playback/skip-prev");
    }

    /** POST /api/playback/seek with position in seconds */
    public void postSeek(double positionSeconds) {
        if (httpBaseUrl == null) return;
        fileIoExecutor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("position", positionSeconds);
                Request.Builder builder = new Request.Builder()
                        .url(httpBaseUrl + "/api/playback/seek")
                        .post(RequestBody.create(body.toString(), JSON_MEDIA_TYPE));
                if (authToken != null) {
                    builder.addHeader("Authorization", "Bearer " + authToken);
                }
                try (Response response = client.newCall(builder.build()).execute()) {
                    // State update comes via WS broadcast
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to POST seek", e);
            }
        });
    }

    private void postPlaybackAction(String path) {
        if (httpBaseUrl == null) return;
        fileIoExecutor.execute(() -> {
            try {
                Request.Builder builder = new Request.Builder()
                        .url(httpBaseUrl + path)
                        .post(RequestBody.create("{}", JSON_MEDIA_TYPE));
                if (authToken != null) {
                    builder.addHeader("Authorization", "Bearer " + authToken);
                }
                try (Response response = client.newCall(builder.build()).execute()) {
                    // State update comes via WS broadcast
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to POST " + path, e);
            }
        });
    }

    // --- URL construction ---

    /** Build a full HTTP URL from a relative path (e.g. /api/audio/...) with auth token. */
    public String buildFullUrl(String path) {
        if (httpBaseUrl == null || path == null) return null;
        String url = httpBaseUrl + path;
        if (authToken != null && !authToken.isEmpty()) {
            url += (url.contains("?") ? "&" : "?") + "token=" + authToken;
        }
        return url;
    }

    // --- Internal ---

    /** Extract HTTP base URL and auth token from the WebSocket URL. */
    private void extractConnectionInfo() {
        if (wsUrl == null) return;
        try {
            URI uri = new URI(wsUrl);
            String scheme = uri.getScheme();
            if (scheme != null) {
                scheme = scheme.replace("wss", "https").replace("ws", "http");
            } else {
                scheme = "http";
            }
            int port = uri.getPort();
            httpBaseUrl = scheme + "://" + uri.getHost() + (port > 0 ? ":" + port : "");

            String query = uri.getQuery();
            if (query != null) {
                for (String param : query.split("&")) {
                    String[] kv = param.split("=", 2);
                    if (kv.length == 2 && "token".equals(kv[0])) {
                        authToken = URLDecoder.decode(kv[1], "UTF-8");
                        break;
                    }
                }
            }
            Log.d(TAG, "HTTP base: " + httpBaseUrl + ", token present: " + (authToken != null));
        } catch (Exception e) {
            Log.e(TAG, "Failed to parse wsUrl for connection info", e);
        }
    }

    private void doConnect() {
        cancelReconnect();

        WebSocket oldWs = webSocketRef.getAndSet(null);
        if (oldWs != null) {
            try { oldWs.cancel(); } catch (Exception ignored) {}
        }

        if (wsUrl == null) return;

        Log.d(TAG, "Connecting to " + wsUrl);

        Request request = new Request.Builder()
                .url(wsUrl)
                .build();

        client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                Log.d(TAG, "Connected");
                webSocketRef.set(ws);
                connected = true;
                reconnectDelay = 1000;

                startHeartbeat();

                // Re-announce cached edge library on reconnect so the host
                // doesn't need to wait for JS to wake up and re-scan.
                if (cachedEdgeLibraryJson != null) {
                    ws.send(cachedEdgeLibraryJson);
                    Log.d(TAG, "Re-announced cached edge library");
                }

                MessageForwarder f = forwarder;
                if (f != null) {
                    f.onConnected();
                }
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                handleTextMessage(ws, text);
            }

            @Override
            public void onMessage(WebSocket ws, ByteString bytes) {
                // Binary frames from server — not expected in current protocol
            }

            @Override
            public void onClosing(WebSocket ws, int code, String reason) {
                ws.close(code, reason);
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                Log.d(TAG, "Closed: " + code + " " + reason);
                handleDisconnect(code, reason);
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response response) {
                Log.e(TAG, "Failure: " + (t != null ? t.getMessage() : "unknown"));
                handleDisconnect(1006, t != null ? t.getMessage() : "connection failed");
            }
        });
    }

    private void handleDisconnect(int code, String reason) {
        webSocketRef.set(null);
        connected = false;
        stopHeartbeat();

        MessageForwarder f = forwarder;
        if (f != null) {
            f.onDisconnected(code, reason != null ? reason : "");
        }

        // 4001 = revoked by host — don't reconnect
        if (code == 4001) {
            shouldReconnect = false;
            return;
        }

        if (shouldReconnect) {
            scheduleReconnect();
        }
    }

    private void startHeartbeat() {
        stopHeartbeat();
        heartbeatTask = scheduler.scheduleAtFixedRate(() -> {
            WebSocket ws = webSocketRef.get();
            if (ws != null && connected) {
                try {
                    JSONObject msg = new JSONObject();
                    msg.put("type", "heartbeat");
                    msg.put("deviceId", deviceId);
                    msg.put("name", deviceName);
                    msg.put("deviceType", deviceType);
                    ws.send(msg.toString());
                } catch (Exception e) {
                    Log.e(TAG, "Failed to send heartbeat", e);
                }
            }
        }, HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, TimeUnit.MILLISECONDS);
    }

    private void stopHeartbeat() {
        if (heartbeatTask != null) {
            heartbeatTask.cancel(false);
            heartbeatTask = null;
        }
    }

    private void scheduleReconnect() {
        cancelReconnect();
        Log.d(TAG, "Reconnecting in " + reconnectDelay + "ms");
        reconnectTask = scheduler.schedule(() -> {
            if (shouldReconnect) {
                doConnect();
            }
        }, reconnectDelay, TimeUnit.MILLISECONDS);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    }

    private void cancelReconnect() {
        if (reconnectTask != null) {
            reconnectTask.cancel(false);
            reconnectTask = null;
        }
    }

    private void handleTextMessage(WebSocket ws, String text) {
        try {
            JSONObject msg = new JSONObject(text);
            String type = msg.optString("type", "");

            switch (type) {
                case "request-audio":
                    handleAudioRequest(ws, msg.getString("requestId"),
                            msg.getString("localPath"));
                    return; // native-only, don't forward to JS
                case "request-art":
                    handleArtRequest(ws, msg.getString("requestId"),
                            msg.getString("localPath"));
                    return; // native-only, don't forward to JS
                case "state":
                    handlePlaybackState(msg.optJSONObject("data"));
                    break; // process AND forward to JS
                case "welcome":
                    handlePlaybackState(msg.optJSONObject("state"));
                    break; // process AND forward to JS
            }

            // Forward to JS (state, welcome, library, and any other messages)
            MessageForwarder f = forwarder;
            if (f != null) {
                f.onMessage(text);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to parse message", e);
        }
    }

    /**
     * Extract playback info from a ServerPlaybackState JSON and notify the
     * foreground service to update the lock screen and native MediaPlayer.
     */
    private void handlePlaybackState(JSONObject state) {
        if (state == null) return;

        try {
            String activeDeviceId = state.isNull("activeDeviceId")
                    ? null : state.optString("activeDeviceId", null);
            boolean isActiveDevice = deviceId != null && deviceId.equals(activeDeviceId);
            String status = state.optString("status", "stopped");
            boolean isPlaying = "playing".equals(status);
            double estimatedPosition = state.optDouble("estimatedPosition", 0);

            JSONObject currentSong = state.isNull("currentSong")
                    ? null : state.optJSONObject("currentSong");

            String title = null, artist = null, album = null;
            String artPath = null, songPath = null;
            double duration = 0;
            String originDeviceId = null;

            if (currentSong != null) {
                title = currentSong.optString("title", "Unknown");
                artist = currentSong.optString("artist", "");
                album = currentSong.optString("album", "");
                artPath = currentSong.isNull("art") ? null
                        : currentSong.optString("art", null);
                songPath = currentSong.optString("path", null);
                duration = currentSong.optDouble("duration", 0);

                JSONObject origin = currentSong.isNull("origin")
                        ? null : currentSong.optJSONObject("origin");
                if (origin != null) {
                    originDeviceId = origin.optString("deviceId", null);
                }
            }

            // Build full URLs
            String audioUrl = null;
            String artUrl = null;
            String localPath = null;

            if (songPath != null) {
                // Check if this song is from this device — play local file directly
                if (originDeviceId != null && originDeviceId.equals(deviceId)) {
                    String prefix = "/api/audio/remote/" + deviceId + "/";
                    if (songPath.startsWith(prefix)) {
                        try {
                            localPath = URLDecoder.decode(
                                    songPath.substring(prefix.length()), "UTF-8");
                        } catch (Exception e) {
                            Log.w(TAG, "Failed to decode local path from song path", e);
                        }
                    }
                }

                if (localPath == null) {
                    audioUrl = buildFullUrl(songPath);
                }
            }

            if (artPath != null) {
                artUrl = buildFullUrl(artPath);
            }

            // Notify the foreground service
            OpenTunesMediaService service = OpenTunesMediaService.getInstance();
            if (service != null) {
                long durationMs = (long) (duration * 1000);
                long positionMs = (long) (estimatedPosition * 1000);
                service.handleNativePlayback(
                        audioUrl, localPath, title, artist, album, artUrl,
                        durationMs, isPlaying, positionMs, isActiveDevice
                );
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to handle playback state", e);
        }
    }

    // --- Reverse audio streaming (native file I/O) ---

    private void handleAudioRequest(WebSocket ws, String requestId, String localPath) {
        fileIoExecutor.execute(() -> {
            try {
                File file = new File(localPath);
                if (!file.exists()) {
                    ws.send(ByteString.EMPTY);
                    return;
                }

                // Send metadata JSON
                JSONObject meta = new JSONObject();
                meta.put("type", "edge-audio-response");
                meta.put("requestId", requestId);
                meta.put("mimeType", getMimeType(localPath));
                meta.put("fileSize", file.length());
                ws.send(meta.toString());

                // Stream binary chunks
                try (FileInputStream fis = new FileInputStream(file)) {
                    byte[] buffer = new byte[CHUNK_SIZE];
                    int bytesRead;
                    while ((bytesRead = fis.read(buffer)) != -1) {
                        ByteString chunk = ByteString.of(buffer, 0, bytesRead);
                        boolean sent = ws.send(chunk);
                        if (!sent) {
                            // OkHttp outgoing buffer exceeded 16MB — backpressure
                            Log.w(TAG, "Backpressure on audio stream, pausing");
                            // OkHttp will buffer and send when ready; just slow down
                            Thread.sleep(100);
                        }
                    }
                }

                // Empty frame = stream complete signal
                ws.send(ByteString.EMPTY);
            } catch (Exception e) {
                Log.e(TAG, "Failed to stream audio: " + localPath, e);
                try { ws.send(ByteString.EMPTY); } catch (Exception ignored) {}
            }
        });
    }

    // --- Reverse art extraction (native MediaMetadataRetriever) ---

    private void handleArtRequest(WebSocket ws, String requestId, String localPath) {
        fileIoExecutor.execute(() -> {
            String base64Data = null;
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                retriever.setDataSource(localPath);
                byte[] art = retriever.getEmbeddedPicture();
                if (art != null) {
                    base64Data = Base64.encodeToString(art, Base64.NO_WRAP);
                }
            } catch (Exception e) {
                // No art available
            } finally {
                try { retriever.release(); } catch (Exception ignored) {}
            }

            try {
                JSONObject response = new JSONObject();
                response.put("type", "edge-art-response");
                response.put("requestId", requestId);
                response.put("data", base64Data != null ? base64Data : JSONObject.NULL);
                ws.send(response.toString());
            } catch (Exception e) {
                Log.e(TAG, "Failed to send art response", e);
            }
        });
    }

    private String getMimeType(String filePath) {
        String lower = filePath.toLowerCase();
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "audio/mp4";
        if (lower.endsWith(".opus")) return "audio/opus";
        return "audio/mpeg";
    }
}
