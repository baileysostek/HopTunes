/**
 * Bridges the web player store to native Android media controls (lock screen,
 * notification) and Android Auto media browsing.
 * On non-Capacitor platforms this module is a no-op.
 */

import { registerPlugin } from '@capacitor/core';
import { isCapacitor } from './utils/platform';
import { usePlayerStore } from './store/playerStore';
import { useLibraryStore } from './store/libraryStore';
import { getMediaUrl } from './types/song';
import type { Song } from '../shared/types';

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

  updateLibrary(options: { songs: Song[] }): Promise<void>;

  updateQueue(options: { queue: Song[] }): Promise<void>;

  addListener(
    eventName: 'mediaControlAction',
    listenerFunc: (data: {
      action: string;
      seekPosition?: number;
      mediaId?: string;
      queueIndex?: number;
    }) => void,
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

/** Push the full library to the native side for Android Auto browsing */
function pushLibrary() {
  const { songs } = useLibraryStore.getState();
  if (songs.length > 0) {
    MediaControls.updateLibrary({ songs }).catch(() => {});
  }
}

/** Push the current queue to the native side for Android Auto */
function pushQueue() {
  const { queue } = usePlayerStore.getState();
  MediaControls.updateQueue({ queue }).catch(() => {});
}

/**
 * Call once at app startup. Sets up subscriptions between the Zustand player
 * store and the native MediaSession so lock-screen controls and Android Auto
 * stay in sync.
 */
export function initNativeMediaSession() {
  if (!isCapacitor()) return;

  // Listen for native media button presses (lock screen, notification, Android Auto)
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
      case 'playFromMediaId': {
        // Android Auto tapped a song in the browse tree. mediaId is the song path.
        const mediaId = data.mediaId;
        if (!mediaId) break;
        const songs = useLibraryStore.getState().songs;
        const song = songs.find((s) => s.path === mediaId);
        if (song) {
          // Queue up sibling songs from the same album for continuous playback
          const albumSongs = songs
            .filter((s) => s.album === song.album)
            .sort((a, b) => a.trackNumber - b.trackNumber);
          store.play(song, albumSongs.length > 1 ? albumSongs : undefined);
        }
        break;
      }
      case 'skipToQueueItem': {
        const idx = data.queueIndex;
        if (idx == null) break;
        const queue = store.queue;
        if (idx >= 0 && idx < queue.length) {
          store.play(queue[idx]);
        }
        break;
      }
    }
  });

  // Subscribe to store changes and push them to native side
  usePlayerStore.subscribe((state, prevState) => {
    const trackChanged = state.currentTrack?.path !== prevState.currentTrack?.path;
    const playStateChanged = state.isPlaying !== prevState.isPlaying;

    if (trackChanged || playStateChanged) {
      pushFullState();
    }

    // Push queue changes to native for Android Auto
    if (state.queue !== prevState.queue) {
      pushQueue();
    }
  });

  // Subscribe to library changes and push to native for Android Auto browsing
  useLibraryStore.subscribe((state, prevState) => {
    if (state.songs !== prevState.songs && state.songs.length > 0) {
      pushLibrary();
    }
  });

  // Send initial state
  pushFullState();
  pushLibrary();
  pushQueue();

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
        pushQueue();
      });
    }
  });

  // Capacitor fires 'resume' when the app comes back from background,
  // which is more reliable than visibilitychange on Android.
  document.addEventListener('resume', () => {
    usePlayerStore.getState().syncFromServer().then(() => {
      pushFullState();
      pushQueue();
    });
  });
}
