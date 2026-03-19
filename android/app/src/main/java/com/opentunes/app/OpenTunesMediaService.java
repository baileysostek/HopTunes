package com.opentunes.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.net.wifi.WifiManager;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class OpenTunesMediaService extends MediaBrowserServiceCompat {

    private static final String TAG = "OpenTunesMedia";
    private static final String CHANNEL_ID = "opentunes_media";
    private static final int NOTIFICATION_ID = 1;

    // Content tree node IDs
    private static final String ROOT_ID = "__ROOT__";
    private static final String NODE_SONGS = "__SONGS__";
    private static final String NODE_ALBUMS = "__ALBUMS__";
    private static final String NODE_ARTISTS = "__ARTISTS__";
    private static final String NODE_QUEUE = "__QUEUE__";
    private static final String PREFIX_ALBUM = "__ALBUM__/";
    private static final String PREFIX_ARTIST = "__ARTIST__/";

    public static final String ACTION_PLAY = "com.opentunes.app.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.opentunes.app.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.opentunes.app.ACTION_NEXT";
    public static final String ACTION_PREV = "com.opentunes.app.ACTION_PREV";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private MediaSessionCompat mediaSession;

    // Current metadata for notification rebuilds
    private String currentTitle = "OpenTunes";
    private String currentArtist = "";
    private String currentAlbum = "";
    private Bitmap currentArt = null;
    private boolean currentIsPlaying = false;
    private long currentPosition = 0;
    private long currentDuration = 0;

    // Library data pushed from JS
    private List<Bundle> library = new ArrayList<>();
    private List<Bundle> queue = new ArrayList<>();

    // Static callback for media button events -> JS (Android Auto browsing only)
    public interface MediaActionCallback {
        void onAction(String action);
    }

    private static MediaActionCallback actionCallback;
    private static OpenTunesMediaService instance;

    // Native WebSocket manager — survives WebView suspension
    private NativeWebSocketManager webSocketManager;

    // Native audio playback (replaces HTMLAudioElement when WebView is suspended)
    private MediaPlayer nativePlayer;
    private String currentNativeSource; // URL or local path currently loaded
    private boolean pendingPlay;        // start playback when onPrepared fires
    private long pendingSeekMs;         // seek to this position when prepared
    private boolean nativePlayerPrepared = false;
    private Handler mainHandler;

    // Whether this device is currently the active player (set by server state)
    private boolean isActiveDevice = false;

    // Audio focus
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private boolean hasAudioFocus = false;

    public static void setMediaActionCallback(MediaActionCallback callback) {
        actionCallback = callback;
    }

    public static OpenTunesMediaService getInstance() {
        return instance;
    }

    public NativeWebSocketManager getWebSocketManager() {
        return webSocketManager;
    }

    public MediaSessionCompat getMediaSession() {
        return mediaSession;
    }

    // --- Lifecycle ---

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        mainHandler = new Handler(Looper.getMainLooper());
        webSocketManager = new NativeWebSocketManager();
        createNotificationChannel();
        createMediaSession();
        setupAudioFocus();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            handleAction(intent.getAction());
            return START_STICKY;
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (webSocketManager != null) {
            webSocketManager.shutdown();
        }
        releaseNativePlayer();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        releaseWakeLock();
        super.onDestroy();
    }

    // --- MediaBrowserServiceCompat ---

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName,
                                  int clientUid,
                                  @Nullable Bundle rootHints) {
        // Allow all clients to connect (Android Auto, system UI, etc.)
        return new BrowserRoot(ROOT_ID, null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId,
                                @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();

        switch (parentId) {
            case ROOT_ID:
                // Top-level tabs (max 4)
                items.add(makeBrowsableItem(NODE_SONGS, "Songs", null));
                items.add(makeBrowsableItem(NODE_ALBUMS, "Albums", null));
                items.add(makeBrowsableItem(NODE_ARTISTS, "Artists", null));
                items.add(makeBrowsableItem(NODE_QUEUE, "Queue", null));
                break;

            case NODE_SONGS:
                for (Bundle song : library) {
                    items.add(makePlayableItem(song));
                }
                break;

            case NODE_ALBUMS:
                // Unique album names, preserving order of first appearance
                // Track artist and art from the first song in each album
                Map<String, String> albums = new LinkedHashMap<>();
                Map<String, String> albumArt = new LinkedHashMap<>();
                for (Bundle song : library) {
                    String album = song.getString("album", "Unknown Album");
                    if (!albums.containsKey(album)) {
                        String artist = song.getString("artist", "");
                        albums.put(album, artist);
                        String art = song.getString("art", null);
                        if (art != null && !art.isEmpty()) {
                            albumArt.put(album, art);
                        }
                    }
                }
                for (Map.Entry<String, String> entry : albums.entrySet()) {
                    items.add(makeBrowsableItem(
                            PREFIX_ALBUM + entry.getKey(),
                            entry.getKey(),
                            entry.getValue(),
                            albumArt.get(entry.getKey())));
                }
                break;

            case NODE_ARTISTS:
                // Unique artist names
                Map<String, Boolean> artists = new LinkedHashMap<>();
                for (Bundle song : library) {
                    String artist = song.getString("artist", "Unknown Artist");
                    artists.put(artist, true);
                }
                for (String artist : artists.keySet()) {
                    items.add(makeBrowsableItem(PREFIX_ARTIST + artist, artist, null));
                }
                break;

            case NODE_QUEUE:
                for (Bundle song : queue) {
                    items.add(makePlayableItem(song));
                }
                break;

            default:
                if (parentId.startsWith(PREFIX_ALBUM)) {
                    String albumName = parentId.substring(PREFIX_ALBUM.length());
                    for (Bundle song : library) {
                        if (albumName.equals(song.getString("album", ""))) {
                            items.add(makePlayableItem(song));
                        }
                    }
                } else if (parentId.startsWith(PREFIX_ARTIST)) {
                    String artistName = parentId.substring(PREFIX_ARTIST.length());
                    for (Bundle song : library) {
                        if (artistName.equals(song.getString("artist", ""))) {
                            items.add(makePlayableItem(song));
                        }
                    }
                }
                break;
        }

        result.sendResult(items);
    }

    // --- Content tree helpers ---

    private MediaBrowserCompat.MediaItem makeBrowsableItem(String id, String title,
                                                            @Nullable String subtitle) {
        return makeBrowsableItem(id, title, subtitle, null);
    }

    private MediaBrowserCompat.MediaItem makeBrowsableItem(String id, String title,
                                                            @Nullable String subtitle,
                                                            @Nullable String art) {
        MediaDescriptionCompat.Builder desc = new MediaDescriptionCompat.Builder()
                .setMediaId(id)
                .setTitle(title);
        if (subtitle != null) {
            desc.setSubtitle(subtitle);
        }
        if (art != null && !art.isEmpty()) {
            desc.setIconUri(Uri.parse(art));
        }
        return new MediaBrowserCompat.MediaItem(desc.build(),
                MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private MediaBrowserCompat.MediaItem makePlayableItem(Bundle song) {
        String path = song.getString("path", "");
        String title = song.getString("title", "Unknown");
        String artist = song.getString("artist", "");
        String album = song.getString("album", "");
        String art = song.getString("art", null);

        MediaDescriptionCompat.Builder desc = new MediaDescriptionCompat.Builder()
                .setMediaId(path)
                .setTitle(title)
                .setSubtitle(artist)
                .setDescription(album);

        if (art != null && !art.isEmpty()) {
            desc.setIconUri(Uri.parse(art));
        }

        return new MediaBrowserCompat.MediaItem(desc.build(),
                MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    // --- Library/queue data from JS ---

    public void setLibrary(List<Bundle> songs) {
        this.library = songs;
        // Notify Android Auto to refresh all browse nodes
        notifyChildrenChanged(ROOT_ID);
        notifyChildrenChanged(NODE_SONGS);
        notifyChildrenChanged(NODE_ALBUMS);
        notifyChildrenChanged(NODE_ARTISTS);
    }

    public void setQueue(List<Bundle> queueItems) {
        this.queue = queueItems;
        notifyChildrenChanged(NODE_QUEUE);

        // Also update the MediaSession queue for the Auto now-playing queue view
        List<MediaSessionCompat.QueueItem> sessionQueue = new ArrayList<>();
        for (int i = 0; i < queueItems.size(); i++) {
            Bundle song = queueItems.get(i);
            MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                    .setMediaId(song.getString("path", ""))
                    .setTitle(song.getString("title", "Unknown"))
                    .setSubtitle(song.getString("artist", ""))
                    .build();
            sessionQueue.add(new MediaSessionCompat.QueueItem(desc, i));
        }
        if (mediaSession != null) {
            mediaSession.setQueue(sessionQueue);
        }
    }

    // --- Native playback control (called from NativeWebSocketManager) ---

    /**
     * Called when a state/welcome message arrives via the native WebSocket.
     * Updates the lock screen/notification and controls native MediaPlayer.
     * Runs on the main thread via Handler.
     */
    public void handleNativePlayback(final String audioUrl, final String localPath,
                                      final String title, final String artist,
                                      final String album, final String artUrl,
                                      final long durationMs, final boolean isPlaying,
                                      final long positionMs, final boolean isActiveDevice) {
        mainHandler.post(() -> doHandleNativePlayback(
                audioUrl, localPath, title, artist, album, artUrl,
                durationMs, isPlaying, positionMs, isActiveDevice));
    }

    private void doHandleNativePlayback(String audioUrl, String localPath,
                                         String title, String artist, String album,
                                         String artUrl, long durationMs,
                                         boolean isPlaying, long positionMs,
                                         boolean isActiveDevice) {
        // Always update lock screen metadata and notification.
        // When the queue empties, currentSong is null so title will be null —
        // reset to defaults so the notification doesn't show stale song info.
        if (title != null) {
            updateMetadata(title, artist, album, artUrl, durationMs);
        } else {
            updateMetadata("OpenTunes", "", "", null, 0);
        }
        updatePlaybackState(isPlaying, positionMs);

        // Track whether this device is the active player so lock-screen
        // button handlers (nativeResume/nativePause) know whether to touch
        // the native MediaPlayer or just forward the command to the server.
        this.isActiveDevice = isActiveDevice;

        if (!isActiveDevice) {
            // Not the active player — stop native audio if playing
            stopNativeAudio();
            return;
        }

        // This device is the active player — manage native MediaPlayer
        String source = localPath != null ? localPath : audioUrl;
        if (source == null) {
            // No track to play
            stopNativeAudio();
            return;
        }

        initNativePlayer();

        if (!source.equals(currentNativeSource)) {
            // Track changed — load new source
            Log.d(TAG, "Loading new track: " + (localPath != null ? "local" : "remote"));
            nativePlayer.reset();
            nativePlayerPrepared = false;
            currentNativeSource = source;
            pendingPlay = isPlaying;
            pendingSeekMs = positionMs;

            try {
                nativePlayer.setAudioAttributes(new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .build());

                if (localPath != null) {
                    nativePlayer.setDataSource(localPath);
                } else {
                    nativePlayer.setDataSource(audioUrl);
                }
                nativePlayer.prepareAsync();
            } catch (Exception e) {
                Log.e(TAG, "Failed to set data source: " + source, e);
                currentNativeSource = null;
                nativePlayerPrepared = false;
            }
        } else if (nativePlayerPrepared) {
            // Same track — just update play state and position
            try {
                if (isPlaying && !nativePlayer.isPlaying()) {
                    if (requestAudioFocus()) {
                        nativePlayer.start();
                    }
                } else if (!isPlaying && nativePlayer.isPlaying()) {
                    nativePlayer.pause();
                }

                // Sync position if significantly off (> 2 seconds)
                int currentPos = nativePlayer.getCurrentPosition();
                if (Math.abs(currentPos - positionMs) > 2000) {
                    nativePlayer.seekTo((int) positionMs);
                }
            } catch (IllegalStateException e) {
                Log.w(TAG, "MediaPlayer in bad state, resetting", e);
                currentNativeSource = null;
                nativePlayerPrepared = false;
            }
        }
        // If preparing (nativePlayerPrepared == false && source matches),
        // just wait — onPrepared will handle it with pendingPlay/pendingSeekMs
    }

    private void initNativePlayer() {
        if (nativePlayer != null) return;

        nativePlayer = new MediaPlayer();
        nativePlayer.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);

        nativePlayer.setOnPreparedListener(mp -> {
            nativePlayerPrepared = true;
            Log.d(TAG, "MediaPlayer prepared");

            if (pendingSeekMs > 0) {
                // For HTTP streams, seekTo is async — wait for seek to
                // complete before starting playback so the player doesn't
                // try to decode from the wrong position.
                if (pendingPlay) {
                    mp.setOnSeekCompleteListener(player -> {
                        player.setOnSeekCompleteListener(null);
                        if (requestAudioFocus()) {
                            player.start();
                            Log.d(TAG, "MediaPlayer started after seek");
                        }
                    });
                }
                mp.seekTo((int) pendingSeekMs);
                pendingSeekMs = 0;
            } else if (pendingPlay) {
                if (requestAudioFocus()) {
                    mp.start();
                    Log.d(TAG, "MediaPlayer started playback");
                }
            }
        });

        nativePlayer.setOnCompletionListener(mp -> {
            Log.d(TAG, "Track completed, notifying server to advance");
            currentNativeSource = null;
            nativePlayerPrepared = false;
            // Tell the server to advance to the next track
            if (webSocketManager != null) {
                webSocketManager.postSkip();
            }
        });

        nativePlayer.setOnErrorListener((mp, what, extra) -> {
            Log.e(TAG, "MediaPlayer error: what=" + what + " extra=" + extra);
            currentNativeSource = null;
            nativePlayerPrepared = false;
            return true; // error handled
        });
    }

    private void stopNativeAudio() {
        if (nativePlayer != null) {
            try {
                if (nativePlayer.isPlaying()) {
                    nativePlayer.pause();
                }
            } catch (IllegalStateException ignored) {}
        }
    }

    private void releaseNativePlayer() {
        if (nativePlayer != null) {
            try {
                nativePlayer.release();
            } catch (Exception ignored) {}
            nativePlayer = null;
            currentNativeSource = null;
            nativePlayerPrepared = false;
        }
    }

    // --- Native media button handling ---

    /** Resume playback: start native player + tell server. */
    private void nativeResume() {
        // Only touch the native MediaPlayer if this device is the active player.
        // Otherwise we're just a remote control for the host — starting the local
        // player would briefly play audio out of this device's speakers.
        if (isActiveDevice && nativePlayer != null && nativePlayerPrepared && !nativePlayer.isPlaying()) {
            if (requestAudioFocus()) {
                try { nativePlayer.start(); } catch (Exception ignored) {}
            }
        }
        currentIsPlaying = true;
        updatePlaybackState(true, getCurrentPositionMs());
        if (webSocketManager != null) webSocketManager.postResume();
    }

    /** Pause playback: pause native player + tell server. */
    private void nativePause() {
        // Only touch the native MediaPlayer if this device is the active player.
        if (isActiveDevice && nativePlayer != null && nativePlayerPrepared) {
            try {
                if (nativePlayer.isPlaying()) {
                    currentPosition = nativePlayer.getCurrentPosition();
                    nativePlayer.pause();
                }
            } catch (Exception ignored) {}
        }
        currentIsPlaying = false;
        updatePlaybackState(false, getCurrentPositionMs());
        if (webSocketManager != null) webSocketManager.postPause();
    }

    /** Seek native player + tell server. */
    private void nativeSeek(long posMs) {
        // Only touch the native MediaPlayer if this device is the active player.
        if (isActiveDevice && nativePlayer != null && nativePlayerPrepared) {
            try { nativePlayer.seekTo((int) posMs); } catch (Exception ignored) {}
        }
        currentPosition = posMs;
        updatePlaybackState(currentIsPlaying, posMs);
        if (webSocketManager != null) webSocketManager.postSeek(posMs / 1000.0);
    }

    private long getCurrentPositionMs() {
        if (nativePlayer != null && nativePlayerPrepared) {
            try { return nativePlayer.getCurrentPosition(); } catch (Exception ignored) {}
        }
        return currentPosition;
    }

    // --- Notification action handling ---

    private void handleAction(String action) {
        switch (action) {
            case ACTION_PLAY:
                nativeResume();
                break;
            case ACTION_PAUSE:
                nativePause();
                break;
            case ACTION_NEXT:
                if (webSocketManager != null) webSocketManager.postSkip();
                break;
            case ACTION_PREV:
                if (webSocketManager != null) webSocketManager.postSkipPrev();
                break;
        }
    }

    // --- Notification channel ---

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "OpenTunes Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Media playback controls");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    // --- MediaSession ---

    private void createMediaSession() {
        mediaSession = new MediaSessionCompat(this, "OpenTunesSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                nativeResume();
            }

            @Override
            public void onPause() {
                nativePause();
            }

            @Override
            public void onSkipToNext() {
                if (webSocketManager != null) webSocketManager.postSkip();
            }

            @Override
            public void onSkipToPrevious() {
                if (webSocketManager != null) webSocketManager.postSkipPrev();
            }

            @Override
            public void onSeekTo(long pos) {
                nativeSeek(pos);
            }

            @Override
            public void onPlayFromMediaId(String mediaId, Bundle extras) {
                // Android Auto browsing — requires JS context
                if (actionCallback != null) {
                    actionCallback.onAction("playFromMediaId:" + mediaId);
                }
            }

            @Override
            public void onSkipToQueueItem(long id) {
                // Android Auto queue — requires JS context
                if (actionCallback != null) {
                    actionCallback.onAction("skipToQueueItem:" + id);
                }
            }

            @Override
            public void onPlayFromSearch(String query, Bundle extras) {
                // Voice search from Google Assistant / Android Auto.
                // Extract structured hints and forward to JS for search + playback.
                String artist = extras != null ? extras.getString(MediaStore.EXTRA_MEDIA_ARTIST) : null;
                String album = extras != null ? extras.getString(MediaStore.EXTRA_MEDIA_ALBUM) : null;
                String title = extras != null ? extras.getString(MediaStore.EXTRA_MEDIA_TITLE) : null;
                String focus = extras != null ? extras.getString(MediaStore.EXTRA_MEDIA_FOCUS) : null;

                if (actionCallback != null) {
                    StringBuilder sb = new StringBuilder("playFromSearch:");
                    sb.append(query != null ? query : "");
                    if (artist != null && !artist.isEmpty()) sb.append("|artist:").append(artist);
                    if (album != null && !album.isEmpty()) sb.append("|album:").append(album);
                    if (title != null && !title.isEmpty()) sb.append("|title:").append(title);
                    if (focus != null && !focus.isEmpty()) sb.append("|focus:").append(focus);
                    actionCallback.onAction(sb.toString());
                }
            }
        });
        mediaSession.setActive(true);

        // Connect the session to this browser service so Android Auto can find it
        setSessionToken(mediaSession.getSessionToken());
    }

    // --- Audio focus ---

    private void setupAudioFocus() {
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);

        AudioAttributes attrs = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .build();

        audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(this::onAudioFocusChange)
                .build();
    }

    private boolean requestAudioFocus() {
        if (hasAudioFocus) return true;
        if (audioManager == null) return false;
        int result = audioManager.requestAudioFocus(audioFocusRequest);
        hasAudioFocus = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        return hasAudioFocus;
    }

    private void abandonAudioFocus() {
        if (hasAudioFocus && audioManager != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
            hasAudioFocus = false;
        }
    }

    private void onAudioFocusChange(int focusChange) {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // Another app took audio focus — pause native player
                if (nativePlayer != null && nativePlayerPrepared) {
                    try {
                        if (nativePlayer.isPlaying()) {
                            nativePlayer.pause();
                        }
                    } catch (Exception ignored) {}
                }
                hasAudioFocus = false;
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                // Regained focus — resume if server state says playing
                hasAudioFocus = true;
                if (nativePlayer != null && nativePlayerPrepared
                        && currentIsPlaying && !nativePlayer.isPlaying()) {
                    try { nativePlayer.start(); } catch (Exception ignored) {}
                }
                if (nativePlayer != null) {
                    try { nativePlayer.setVolume(1.0f, 1.0f); } catch (Exception ignored) {}
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // Lower volume temporarily
                if (nativePlayer != null) {
                    try { nativePlayer.setVolume(0.3f, 0.3f); } catch (Exception ignored) {}
                }
                break;
        }
    }

    // --- Public methods called from MediaControlsPlugin ---

    public void updateMetadata(String title, String artist, String album,
                                String artUrl, long durationMs) {
        currentTitle = title != null ? title : "OpenTunes";
        currentArtist = artist != null ? artist : "";
        currentAlbum = album != null ? album : "";
        currentDuration = durationMs;

        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);

        if (currentArt != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArt);
        }

        mediaSession.setMetadata(metaBuilder.build());
        updateNotification();

        // Load album art asynchronously if URL is provided
        if (artUrl != null && !artUrl.isEmpty()) {
            loadAlbumArt(artUrl);
        }
    }

    public void updatePlaybackState(boolean isPlaying, long positionMs) {
        currentIsPlaying = isPlaying;
        currentPosition = positionMs;

        int state = isPlaying
                ? PlaybackStateCompat.STATE_PLAYING
                : PlaybackStateCompat.STATE_PAUSED;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(
                        PlaybackStateCompat.ACTION_PLAY |
                        PlaybackStateCompat.ACTION_PAUSE |
                        PlaybackStateCompat.ACTION_PLAY_PAUSE |
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackStateCompat.ACTION_SEEK_TO |
                        PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID |
                        PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM |
                        PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
                )
                .setState(state, positionMs, isPlaying ? 1.0f : 0f);

        mediaSession.setPlaybackState(stateBuilder.build());
        updateNotification();
    }

    // --- Album art loading (with disk cache) ---

    private File getArtCacheDir() {
        File dir = new File(getCacheDir(), "album_art");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private String hashUrl(String url) {
        try {
            // Strip the auth token so the same art path always maps to the same cache key
            String key = url.replaceAll("[?&]token=[^&]*", "");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(key.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(url.hashCode());
        }
    }

    private void loadAlbumArt(final String artUrl) {
        new Thread(() -> {
            Bitmap bitmap = null;
            String hash = hashUrl(artUrl);
            File cached = new File(getArtCacheDir(), hash + ".png");

            // 1. Try loading from disk cache
            if (cached.exists()) {
                try {
                    FileInputStream fis = new FileInputStream(cached);
                    bitmap = BitmapFactory.decodeStream(fis);
                    fis.close();
                } catch (Exception e) {
                    // Cache read failed, will try network
                }
            }

            // 2. If not cached, fetch from network and save
            if (bitmap == null) {
                try {
                    URL url = new URL(artUrl);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setDoInput(true);
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);
                    conn.connect();

                    InputStream input = conn.getInputStream();
                    bitmap = BitmapFactory.decodeStream(input);
                    input.close();

                    // Save to disk cache
                    if (bitmap != null) {
                        try {
                            FileOutputStream fos = new FileOutputStream(cached);
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos);
                            fos.close();
                        } catch (Exception e) {
                            // Cache write failed — non-critical
                        }
                    }
                } catch (Exception e) {
                    // Network fetch failed — bitmap stays null
                }
            }

            // 3. Update media session with the bitmap (from cache or network)
            if (bitmap != null) {
                currentArt = bitmap;

                MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration)
                        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);

                mediaSession.setMetadata(metaBuilder.build());
                updateNotification();
            }
        }).start();
    }

    // --- Notification ---

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent prevIntent = PendingIntent.getService(
                this, 1,
                new Intent(this, OpenTunesMediaService.class).setAction(ACTION_PREV),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String playPauseAction = currentIsPlaying ? ACTION_PAUSE : ACTION_PLAY;
        PendingIntent playPauseIntent = PendingIntent.getService(
                this, 2,
                new Intent(this, OpenTunesMediaService.class).setAction(playPauseAction),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent nextIntent = PendingIntent.getService(
                this, 3,
                new Intent(this, OpenTunesMediaService.class).setAction(ACTION_NEXT),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int playPauseIcon = currentIsPlaying
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;
        String playPauseLabel = currentIsPlaying ? "Pause" : "Play";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText(currentAlbum)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(android.R.drawable.ic_media_previous, "Previous", prevIntent)
                .addAction(playPauseIcon, playPauseLabel, playPauseIntent)
                .addAction(android.R.drawable.ic_media_next, "Next", nextIntent)
                .setStyle(new MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));

        if (currentArt != null) {
            builder.setLargeIcon(currentArt);
        }

        return builder.build();
    }

    private void updateNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    // --- Wake lock ---

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "OpenTunes::MediaServiceWakeLock"
            );
            wakeLock.acquire();
        }

        // Keep the WiFi radio fully active so WebSocket connections survive
        // when the screen turns off. Without this, Android drops WiFi to a
        // low-power mode that kills TCP connections.
        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifiManager != null) {
            wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "OpenTunes::MediaServiceWifiLock"
            );
            wifiLock.acquire();
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
            wifiLock = null;
        }
    }
}
