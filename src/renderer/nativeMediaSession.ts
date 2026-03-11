/**
 * Bridges the web player store to native Android media controls (lock screen, notification).
 * On non-Capacitor platforms this module is a no-op.
 */

import { registerPlugin } from '@capacitor/core';
import { isCapacitor } from './utils/platform';
import { usePlayerStore } from './store/playerStore';
import { getMediaUrl } from './types/song';

interface MediaControlsPlugin {
  updateMetadata(options: {
    title: string;
    artist: string;
    album: string;
    artUrl?: string;
    duration?: number;
  }): Promise<void>;

  updatePlaybackState(options: {
    isPlaying: boolean;
    position?: number;
  }): Promise<void>;

  addListener(
    eventName: 'mediaControlAction',
    listenerFunc: (data: { action: string; seekPosition?: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const MediaControls = registerPlugin<MediaControlsPlugin>('MediaControls');

let lastTrackPath: string | null = null;

/** Push current metadata + playback state to the native MediaSession */
function pushFullState() {
  const state = usePlayerStore.getState();
  const track = state.currentTrack;

  if (track) {
    const artUrl = track.art ? getMediaUrl(track.art) : undefined;
    const trackChanged = track.path !== lastTrackPath;
    lastTrackPath = track.path;

    // Always push metadata if the track is different, or re-push on periodic sync
    if (trackChanged) {
      MediaControls.updateMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artUrl,
        duration: track.duration || 0,
      }).catch(() => {});
    }
  } else if (lastTrackPath) {
    lastTrackPath = null;
    MediaControls.updateMetadata({
      title: 'OpenTunes',
      artist: '',
      album: '',
      duration: 0,
    }).catch(() => {});
  }

  MediaControls.updatePlaybackState({
    isPlaying: state.isPlaying,
    position: state.currentTime,
  }).catch(() => {});
}

/**
 * Call once at app startup. Sets up subscriptions between the Zustand player
 * store and the native MediaSession so lock-screen controls stay in sync.
 */
export function initNativeMediaSession() {
  if (!isCapacitor()) return;

  // Listen for native media button presses
  MediaControls.addListener('mediaControlAction', (data) => {
    const store = usePlayerStore.getState();

    switch (data.action) {
      case 'play':
        store.resume();
        break;
      case 'pause':
        store.pause();
        break;
      case 'next':
        store.next();
        break;
      case 'previous':
        store.prev();
        break;
      case 'seekTo':
        if (data.seekPosition != null) {
          store.seek(data.seekPosition);
        }
        break;
    }
  });

  // Subscribe to store changes and push them to native side
  usePlayerStore.subscribe((state, prevState) => {
    const trackChanged = state.currentTrack?.path !== prevState.currentTrack?.path;
    const playStateChanged = state.isPlaying !== prevState.isPlaying;

    if (trackChanged || playStateChanged) {
      pushFullState();
    }
  });

  // Send initial state
  pushFullState();

  // Periodically sync so the lock screen stays accurate even when
  // Android throttles WebView JS timers (screen off / background).
  setInterval(() => {
    pushFullState();
  }, 5000);

  // When the app returns to foreground, force an immediate resync — the
  // WebView may have been paused and missed WebSocket updates.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Trigger a server sync to get latest state, then push to native
      usePlayerStore.getState().syncFromServer().then(() => {
        pushFullState();
      });
    }
  });

  // Capacitor fires 'resume' when the app comes back from background,
  // which is more reliable than visibilitychange on Android.
  document.addEventListener('resume', () => {
    usePlayerStore.getState().syncFromServer().then(() => {
      pushFullState();
    });
  });
}
