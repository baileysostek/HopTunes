package com.opentunes.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

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
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class OpenTunesMediaService extends MediaBrowserServiceCompat {

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

    // Static callback for media button events -> JS
    public interface MediaActionCallback {
        void onAction(String action);
    }

    private static MediaActionCallback actionCallback;
    private static OpenTunesMediaService instance;

    public static void setMediaActionCallback(MediaActionCallback callback) {
        actionCallback = callback;
    }

    public static OpenTunesMediaService getInstance() {
        return instance;
    }

    // --- Lifecycle ---

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        createMediaSession();
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
                Map<String, String> albums = new LinkedHashMap<>();
                for (Bundle song : library) {
                    String album = song.getString("album", "Unknown Album");
                    if (!albums.containsKey(album)) {
                        String artist = song.getString("artist", "");
                        albums.put(album, artist);
                    }
                }
                for (Map.Entry<String, String> entry : albums.entrySet()) {
                    items.add(makeBrowsableItem(
                            PREFIX_ALBUM + entry.getKey(),
                            entry.getKey(),
                            entry.getValue()));
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
        MediaDescriptionCompat.Builder desc = new MediaDescriptionCompat.Builder()
                .setMediaId(id)
                .setTitle(title);
        if (subtitle != null) {
            desc.setSubtitle(subtitle);
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

    // --- Notification action handling ---

    private void handleAction(String action) {
        if (actionCallback != null) {
            switch (action) {
                case ACTION_PLAY:
                    actionCallback.onAction("play");
                    break;
                case ACTION_PAUSE:
                    actionCallback.onAction("pause");
                    break;
                case ACTION_NEXT:
                    actionCallback.onAction("next");
                    break;
                case ACTION_PREV:
                    actionCallback.onAction("previous");
                    break;
            }
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
                if (actionCallback != null) actionCallback.onAction("play");
            }

            @Override
            public void onPause() {
                if (actionCallback != null) actionCallback.onAction("pause");
            }

            @Override
            public void onSkipToNext() {
                if (actionCallback != null) actionCallback.onAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                if (actionCallback != null) actionCallback.onAction("previous");
            }

            @Override
            public void onSeekTo(long pos) {
                if (actionCallback != null) actionCallback.onAction("seekTo:" + pos);
            }

            @Override
            public void onPlayFromMediaId(String mediaId, Bundle extras) {
                if (actionCallback != null) {
                    actionCallback.onAction("playFromMediaId:" + mediaId);
                }
            }

            @Override
            public void onSkipToQueueItem(long id) {
                if (actionCallback != null) {
                    actionCallback.onAction("skipToQueueItem:" + id);
                }
            }
        });
        mediaSession.setActive(true);

        // Connect the session to this browser service so Android Auto can find it
        setSessionToken(mediaSession.getSessionToken());
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
                        PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM
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
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }
}
