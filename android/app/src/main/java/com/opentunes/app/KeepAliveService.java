package com.opentunes.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.media.MediaMetadata;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import android.support.v4.media.session.MediaSessionCompat;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class KeepAliveService extends Service {

    private static final String CHANNEL_ID = "opentunes_media";
    private static final int NOTIFICATION_ID = 1;

    public static final String ACTION_PLAY = "com.opentunes.app.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.opentunes.app.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.opentunes.app.ACTION_NEXT";
    public static final String ACTION_PREV = "com.opentunes.app.ACTION_PREV";

    private PowerManager.WakeLock wakeLock;
    private MediaSession mediaSession;

    // Current metadata for notification rebuilds
    private String currentTitle = "OpenTunes";
    private String currentArtist = "";
    private String currentAlbum = "";
    private Bitmap currentArt = null;
    private boolean currentIsPlaying = false;
    private long currentPosition = 0;
    private long currentDuration = 0;

    // Static callback for media button events → JS
    public interface MediaActionCallback {
        void onAction(String action);
    }

    private static MediaActionCallback actionCallback;
    private static KeepAliveService instance;

    public static void setMediaActionCallback(MediaActionCallback callback) {
        actionCallback = callback;
    }

    public static KeepAliveService getInstance() {
        return instance;
    }

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

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

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

    private void createMediaSession() {
        mediaSession = new MediaSession(this, "OpenTunesSession");
        mediaSession.setCallback(new MediaSession.Callback() {
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
        });
        mediaSession.setActive(true);
    }

    public void updateMetadata(String title, String artist, String album, String artUrl, long durationMs) {
        currentTitle = title != null ? title : "OpenTunes";
        currentArtist = artist != null ? artist : "";
        currentAlbum = album != null ? album : "";
        currentDuration = durationMs;

        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);

        if (currentArt != null) {
            metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, currentArt);
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

        int state = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                .setActions(
                        PlaybackState.ACTION_PLAY |
                        PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY_PAUSE |
                        PlaybackState.ACTION_SKIP_TO_NEXT |
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackState.ACTION_SEEK_TO
                )
                .setState(state, positionMs, isPlaying ? 1.0f : 0f);

        mediaSession.setPlaybackState(stateBuilder.build());
        updateNotification();
    }

    private void loadAlbumArt(final String artUrl) {
        new Thread(() -> {
            try {
                URL url = new URL(artUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoInput(true);
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.connect();

                InputStream input = conn.getInputStream();
                Bitmap bitmap = BitmapFactory.decodeStream(input);
                input.close();

                if (bitmap != null) {
                    currentArt = bitmap;

                    // Update MediaSession metadata with art
                    MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                            .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                            .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
                            .putString(MediaMetadata.METADATA_KEY_ALBUM, currentAlbum)
                            .putLong(MediaMetadata.METADATA_KEY_DURATION, currentDuration)
                            .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, bitmap);

                    mediaSession.setMetadata(metaBuilder.build());
                    updateNotification();
                }
            } catch (Exception e) {
                // Failed to load art — notification still works without it
            }
        }).start();
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Previous button
        PendingIntent prevIntent = PendingIntent.getService(
                this, 1,
                new Intent(this, KeepAliveService.class).setAction(ACTION_PREV),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Play/Pause button
        String playPauseAction = currentIsPlaying ? ACTION_PAUSE : ACTION_PLAY;
        PendingIntent playPauseIntent = PendingIntent.getService(
                this, 2,
                new Intent(this, KeepAliveService.class).setAction(playPauseAction),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Next button
        PendingIntent nextIntent = PendingIntent.getService(
                this, 3,
                new Intent(this, KeepAliveService.class).setAction(ACTION_NEXT),
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
                        .setMediaSession(MediaSessionCompat.Token
                                .fromToken(mediaSession.getSessionToken()))
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

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "OpenTunes::KeepAliveWakeLock"
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
