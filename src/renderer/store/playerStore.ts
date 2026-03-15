import { create } from 'zustand';
import axios from 'axios';
import { Song, getApiBase, getAuthToken, getMediaUrl, clearConnection } from '../types/song';
import { ClientWsMessage, DeviceInfo, DeviceType, ServerPlaybackState, ServerWsMessage, AUDIO_PATH_PREFIX, WS_PROTOCOL_VERSION } from '../../shared/types';
import { isElectron, isCapacitor } from '../utils/platform';
import { useLibraryStore } from './libraryStore';
import { initLocalLibrary, getLocalFileUrl } from '../services/localLibrary';
import { NativeWebSocket } from '../services/nativeWebSocket';

// Re-export so components can import from the store
export type { DeviceInfo };

// Dual audio element pool for gapless playback.
// One plays the current track while the other pre-buffers the next.
let audioElements: [HTMLAudioElement, HTMLAudioElement] | null = null;
let activeIndex = 0;
let preloadedTrackPath: string | null = null; // path loaded in the preload element
let gaplessTrackPath: string | null = null;   // set during gapless swap, cleared on server confirm

function initAudioPool(): [HTMLAudioElement, HTMLAudioElement] {
  if (!audioElements) {
    const a = new Audio();
    const b = new Audio();
    a.volume = 0.7;
    b.volume = 0.7;
    a.preload = 'auto';
    b.preload = 'auto';
    audioElements = [a, b];
  }
  return audioElements;
}

function getAudio(): HTMLAudioElement {
  return initAudioPool()[activeIndex];
}

function getPreloadAudio(): HTMLAudioElement {
  return initAudioPool()[1 - activeIndex];
}

function prebufferNextTrack(queue: Song[]): void {
  const nextSong = queue[0];
  const preload = getPreloadAudio();

  if (!nextSong) {
    preload.src = '';
    preloadedTrackPath = null;
    return;
  }

  if (preloadedTrackPath === nextSong.path) return; // already preloading correct track

  preload.src = getMediaUrl(nextSong.path);
  preload.currentTime = 0;
  preloadedTrackPath = nextSong.path;
}

function cleanupAllAudio(): void {
  const [a, b] = initAudioPool();
  a.pause(); a.src = '';
  b.pause(); b.src = '';
  preloadedTrackPath = null;
  gaplessTrackPath = null;
}

// --- Local-only playback for edge devices without server connection ---

let localHistory: Song[] = [];

/** True when this edge device should play locally (no server). */
function isLocalOnlyMode(): boolean {
  return isCapacitor() && useLibraryStore.getState().source === 'local';
}

/** Convert a song's server-style path to a local file URL for direct playback. */
function getLocalAudioSrc(song: Song): string {
  const localPath = decodeURIComponent(song.path.replace(AUDIO_PATH_PREFIX, ''));
  return getLocalFileUrl(localPath);
}

/** Prebuffer the next song in local mode. */
function prebufferNextLocal(queue: Song[]): void {
  const nextSong = queue[0];
  const preload = getPreloadAudio();
  if (!nextSong) {
    preload.src = '';
    preloadedTrackPath = null;
    return;
  }
  if (preloadedTrackPath === nextSong.path) return;
  preload.src = getLocalAudioSrc(nextSong);
  preload.currentTime = 0;
  preloadedTrackPath = nextSong.path;
}

// Generate a stable device ID stored in localStorage
function getDeviceId(): string {
  const key = 'opentunes_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = (crypto as any).randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(key, id);
  }
  return id;
}

function getDeviceName(): string {
  if (isElectron()) return 'Desktop';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  return 'Browser';
}

function getDeviceType(): DeviceType {
  if (isElectron()) return 'desktop';
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return 'mobile';
  return 'web';
}

interface PlayerState {
  currentTrack: Song | null;
  isPlaying: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  queue: Song[];
  hasHistory: boolean;
  queueVisible: boolean;
  shuffleEnabled: boolean;
  activeDeviceId: string | null;
  devices: DeviceInfo[];
  thisDeviceId: string;
  play: (song: Song, queue?: Song[]) => void;
  addToQueue: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  syncFromServer: () => Promise<void>;
  moveInQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  toggleQueue: () => void;
  toggleShuffle: () => void;
  transferPlayback: (deviceId: string) => Promise<void>;
}

const deviceId = typeof window !== 'undefined' ? getDeviceId() : '';

// Add auth token to all outgoing requests
axios.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// Track whether this device was the active player on the last sync
let wasActivePlayer = false;

// Whether this device has successfully registered with the server
let registered = false;

// Callback set by the initialization block to trigger immediate re-registration.
// Defined at module level so applyServerState (also module level) can call it.
let reregisterFn: (() => void) | null = null;

// For non-active devices: track the server's position anchor so we can interpolate locally
let serverPositionAnchor = 0;   // estimatedPosition at time of last server update
let serverPositionTimestamp = 0; // Date.now() when we received that update
let serverIsPlaying = false;     // whether the server says playback is active

function isThisDeviceActive(state: { activeDeviceId: string | null }): boolean {
  return state.activeDeviceId === deviceId;
}

// Apply server state to local Zustand store and Audio element
function applyServerState(
  server: ServerPlaybackState,
  set: (state: Partial<PlayerState>) => void,
  get: () => PlayerState
) {
  const a = getAudio();
  const local = get();
  const newTrack = server.currentSong;
  const isNowPlaying = server.status === 'playing';
  // On Capacitor, native Java MediaPlayer handles audio — JS only updates UI state.
  const shouldPlayAudio = isThisDeviceActive(server) && !isCapacitor();
  const justBecameActive = shouldPlayAudio && !wasActivePlayer;

  // Update tracking for next call
  wasActivePlayer = shouldPlayAudio;

  if (shouldPlayAudio) {
    // This device is the active player — manage audio
    if (gaplessTrackPath && newTrack?.path === gaplessTrackPath) {
      // Track already playing via gapless transition — skip reload
      gaplessTrackPath = null;
      prebufferNextTrack(server.queue);
    } else if (newTrack?.path !== local.currentTrack?.path || (justBecameActive && newTrack)) {
      // Track changed OR device just became active — (re)load audio
      gaplessTrackPath = null;
      if (newTrack) {
        // Local playback shortcut: if this edge device owns the song, play directly
        // from local file instead of streaming through the host.
        const isOwnSong = isCapacitor() && newTrack.origin?.deviceId === deviceId;
        if (isOwnSong) {
          // Extract local path from the remote URL path
          const parts = newTrack.path.split('/');
          const encodedPath = parts[parts.length - 1];
          a.src = getLocalFileUrl(decodeURIComponent(encodedPath));
        } else {
          a.src = getMediaUrl(newTrack.path);
        }
        a.currentTime = server.estimatedPosition;
        if (isNowPlaying) a.play().catch(() => {});
      } else {
        a.pause();
        a.src = '';
      }
      prebufferNextTrack(server.queue);
    } else if (local.isPlaying !== isNowPlaying) {
      if (isNowPlaying) a.play().catch(() => {});
      else a.pause();
    } else {
      // Same track, same play state — queue may have changed, update preload
      prebufferNextTrack(server.queue);
    }

    // Sync position if significantly off (skip if we just loaded)
    if (newTrack && !justBecameActive && Math.abs(a.currentTime - server.estimatedPosition) > 2) {
      a.currentTime = server.estimatedPosition;
    }
  } else {
    // Not the active player — stop any local audio
    if (!a.paused) a.pause();
    a.src = '';
    getPreloadAudio().src = '';
    preloadedTrackPath = null;
    gaplessTrackPath = null;

    // Store the server's position anchor for local interpolation
    serverPositionAnchor = server.estimatedPosition;
    serverPositionTimestamp = Date.now();
    serverIsPlaying = isNowPlaying;
  }

  // If this device is missing from the server's device list, re-register
  // immediately instead of waiting for the 10s polling interval.
  if (!server.devices.some(d => d.id === deviceId)) {
    registered = false;
    if (reregisterFn) reregisterFn();
  }

  set({
    currentTrack: newTrack,
    isPlaying: isNowPlaying,
    queue: server.queue,
    hasHistory: server.history.length > 0,
    shuffleEnabled: server.shuffleEnabled,
    activeDeviceId: server.activeDeviceId,
    devices: server.devices,
    // Set position/duration from server when this device isn't driving audio,
    // OR when it just became active (audio element hasn't loaded metadata yet)
    ...((!shouldPlayAudio || justBecameActive) && newTrack ? {
      currentTime: server.estimatedPosition,
      duration: newTrack.duration || 0,
    } : {}),
  });
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  volume: 0.7,
  currentTime: 0,
  duration: 0,
  queue: [],
  hasHistory: false,
  queueVisible: false,
  shuffleEnabled: false,
  activeDeviceId: null,
  devices: [],
  thisDeviceId: deviceId,

  play: async (song, queue) => {
    if (isLocalOnlyMode()) {
      const current = get().currentTrack;
      if (current) localHistory.push(current);
      const a = getAudio();
      a.src = getLocalAudioSrc(song);
      a.currentTime = 0;
      a.play().catch(() => {});
      const upcoming = queue
        ? (() => { const idx = queue.findIndex(s => s.path === song.path); return idx >= 0 ? queue.slice(idx + 1) : []; })()
        : [];
      set({
        currentTrack: song,
        isPlaying: true,
        queue: upcoming,
        hasHistory: localHistory.length > 0,
        activeDeviceId: deviceId,
        devices: [{ id: deviceId, name: getDeviceName(), type: getDeviceType(), lastSeen: Date.now() }],
      });
      prebufferNextLocal(upcoming);
      return;
    }
    try {
      let response;
      if (queue) {
        const idx = queue.findIndex(s => s.path === song.path);
        const upcoming = idx >= 0 ? queue.slice(idx + 1) : [];
        response = await axios.post(`${getApiBase()}/api/playback/play-with-queue`, {
          song,
          queue: upcoming,
        });
      } else {
        response = await axios.post(`${getApiBase()}/api/playback/play`, { song });
      }
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to play:', err);
    }
  },

  addToQueue: async (song) => {
    if (isLocalOnlyMode()) {
      set({ queue: [...get().queue, song] });
      return;
    }
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/queue`, { song });
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to add to queue:', err);
    }
  },

  pause: async () => {
    if (isLocalOnlyMode()) {
      getAudio().pause();
      set({ isPlaying: false });
      return;
    }
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/pause`);
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to pause:', err);
    }
  },

  resume: async () => {
    if (isLocalOnlyMode()) {
      getAudio().play().catch(() => {});
      set({ isPlaying: true });
      return;
    }
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/resume`);
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to resume:', err);
    }
  },

  togglePlay: () => {
    const { isPlaying, currentTrack } = get();
    if (!currentTrack) return;
    if (isPlaying) get().pause();
    else get().resume();
  },

  next: async () => {
    if (isLocalOnlyMode()) {
      const { currentTrack, queue } = get();
      if (currentTrack) localHistory.push(currentTrack);
      const nextSong = queue[0];
      if (nextSong) {
        const a = getAudio();
        a.src = getLocalAudioSrc(nextSong);
        a.currentTime = 0;
        a.play().catch(() => {});
        const newQueue = queue.slice(1);
        set({
          currentTrack: nextSong,
          isPlaying: true,
          queue: newQueue,
          hasHistory: localHistory.length > 0,
        });
        prebufferNextLocal(newQueue);
      } else {
        getAudio().pause();
        set({ isPlaying: false, currentTrack: null });
      }
      return;
    }
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/skip`);
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to skip:', err);
    }
  },

  prev: async () => {
    if (isLocalOnlyMode()) {
      const a = getAudio();
      if (a.currentTime > 3) {
        a.currentTime = 0;
        set({ currentTime: 0 });
        return;
      }
      const prevSong = localHistory.pop();
      if (prevSong) {
        const current = get().currentTrack;
        const newQueue = current ? [current, ...get().queue] : get().queue;
        a.src = getLocalAudioSrc(prevSong);
        a.currentTime = 0;
        a.play().catch(() => {});
        set({
          currentTrack: prevSong,
          isPlaying: true,
          queue: newQueue,
          hasHistory: localHistory.length > 0,
        });
      }
      return;
    }
    const a = getAudio();
    // If more than 3 seconds in, restart current song
    if (isThisDeviceActive(get()) && a.currentTime > 3) {
      get().seek(0);
      return;
    }
    // For non-active devices, check server position
    if (!isThisDeviceActive(get()) && get().currentTime > 3) {
      get().seek(0);
      return;
    }
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/skip-prev`);
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to skip prev:', err);
    }
  },

  seek: async (time) => {
    if (isLocalOnlyMode()) {
      const a = getAudio();
      a.currentTime = time;
      set({ currentTime: time });
      return;
    }
    if (isThisDeviceActive(get())) {
      const a = getAudio();
      a.currentTime = time;
    }
    set({ currentTime: time });
    try {
      await axios.post(`${getApiBase()}/api/playback/seek`, { position: time });
    } catch (err) {
      console.error('Failed to seek:', err);
    }
  },

  setVolume: (vol) => {
    const [a, b] = initAudioPool();
    a.volume = vol;
    b.volume = vol;
    set({ volume: vol });
  },

  syncFromServer: async () => {
    try {
      const response = await axios.get(`${getApiBase()}/api/playback?deviceId=${deviceId}`);
      applyServerState(response.data, set, get);
    } catch {
      // Silent fail for polling
    }
  },

  moveInQueue: async (from, to) => {
    try {
      const response = await axios.put(`${getApiBase()}/api/playback/queue/move`, { from, to });
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to move in queue:', err);
    }
  },

  removeFromQueue: async (index) => {
    try {
      const response = await axios.delete(`${getApiBase()}/api/playback/queue/${index}`);
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to remove from queue:', err);
    }
  },

  toggleQueue: () => set({ queueVisible: !get().queueVisible }),

  toggleShuffle: async () => {
    if (isLocalOnlyMode()) {
      const current = get().shuffleEnabled;
      set({ shuffleEnabled: !current });
      // Local-only: shuffle/unshuffle the queue client-side
      if (!current) {
        const { smartShuffle } = await import('../../shared/smartShuffle');
        set({ queue: smartShuffle(get().queue) });
      }
      return;
    }
    const current = get().shuffleEnabled;
    set({ shuffleEnabled: !current }); // optimistic
    try {
      const response = await axios.put(`${getApiBase()}/api/playback/shuffle`, {
        enabled: !current,
      });
      applyServerState(response.data, set, get);
    } catch (err) {
      set({ shuffleEnabled: current }); // revert
      console.error('Failed to toggle shuffle:', err);
    }
  },

  transferPlayback: async (targetDeviceId: string) => {
    try {
      const response = await axios.put(`${getApiBase()}/api/playback/devices/active`, {
        deviceId: targetDeviceId,
      });
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to transfer playback:', err);
    }
  },
}));

// Wire up local audio events + server polling + device registration
if (typeof window !== 'undefined') {
  const [audioA, audioB] = initAudioPool();

  function handleTimeUpdate(this: HTMLAudioElement) {
    if (this !== getAudio()) return; // ignore events from the preload element
    if (!isLocalOnlyMode() && !isThisDeviceActive(usePlayerStore.getState())) return;
    if (!this.duration || isNaN(this.duration)) return;
    usePlayerStore.setState({
      currentTime: this.currentTime,
      duration: this.duration,
    });
  }

  function handleEnded(this: HTMLAudioElement) {
    if (this !== getAudio()) return;

    const state = usePlayerStore.getState();

    // Local-only mode: advance queue entirely client-side
    if (isLocalOnlyMode()) {
      state.next();
      return;
    }

    if (!isThisDeviceActive(state)) return;

    const nextSong = state.queue[0];
    const preload = getPreloadAudio();

    if (preloadedTrackPath && preload.src && nextSong?.path === preloadedTrackPath) {
      // Gapless transition: swap to pre-buffered element and play immediately
      activeIndex = 1 - activeIndex;
      gaplessTrackPath = preloadedTrackPath;
      preloadedTrackPath = null;
      getAudio().play().catch(() => {});

      // Update UI immediately without waiting for server round-trip
      usePlayerStore.setState({
        currentTrack: nextSong,
        currentTime: 0,
        duration: nextSong.duration || 0,
      });

      // Clear the old element (now the preload slot)
      getPreloadAudio().src = '';
    }

    // Notify server to advance the queue
    state.next();
  }

  function handleLoadedMetadata(this: HTMLAudioElement) {
    if (this !== getAudio()) return;
    if (!isLocalOnlyMode() && !isThisDeviceActive(usePlayerStore.getState())) return;
    usePlayerStore.setState({ duration: this.duration });
  }

  for (const el of [audioA, audioB]) {
    el.addEventListener('timeupdate', handleTimeUpdate);
    el.addEventListener('ended', handleEnded);
    el.addEventListener('loadedmetadata', handleLoadedMetadata);
  }

  // Register this device with the server, retrying until successful.
  // The response includes the full state (devices list, playback, etc.)
  // so we apply it immediately — no need to wait for a WebSocket broadcast.
  async function registerThisDevice() {
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/devices/register`, {
        id: deviceId,
        name: getDeviceName(),
        type: getDeviceType(),
      });
      registered = true;
      applyServerState(
        response.data,
        usePlayerStore.setState.bind(usePlayerStore),
        usePlayerStore.getState
      );
    } catch {
      registered = false;
    }
  }

  reregisterFn = registerThisDevice;
  registerThisDevice();

  // --- WebSocket for instant state sync ---
  let wsConnected = false;
  let revoked = false; // true when the host revokes this device
  let activeWs: WebSocket | null = null; // reference for clean shutdown (browser path only)
  let reconnectDelay = 1000; // Exponential backoff: 1s → 2s → 4s → max 5s
  const MAX_RECONNECT_DELAY = 5000;

  function scheduleReconnect() {
    setTimeout(connectBrowserWebSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  /** Build the full WebSocket URL with auth and device info as query params. */
  function buildWsUrl(): string {
    const base = getApiBase().replace(/^http/, 'ws');
    const token = getAuthToken();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    params.set('deviceId', deviceId);
    params.set('deviceName', getDeviceName());
    params.set('deviceType', getDeviceType());
    return `${base}?${params.toString()}`;
  }

  /** Shared handler for server WS messages (used by both browser and native paths). */
  async function handleServerMessage(msg: ServerWsMessage): Promise<void> {
    switch (msg.type) {
      case 'welcome': {
        if (msg.protocolVersion !== WS_PROTOCOL_VERSION) {
          console.warn(
            `[OpenTunes] Protocol version mismatch: server=${msg.protocolVersion}, client=${WS_PROTOCOL_VERSION}. Some features may not work.`
          );
        }
        applyServerState(
          msg.state,
          usePlayerStore.setState.bind(usePlayerStore),
          usePlayerStore.getState
        );
        if (isCapacitor()) {
          // Merge: the welcome library won't include this device's edge songs yet
          // (the host hasn't processed our edge-library message). Keep local songs
          // that aren't already in the welcome library so they don't briefly vanish.
          const currentSongs = useLibraryStore.getState().songs;
          const welcomeHashes = new Set(msg.library.filter((s: Song) => s.hash).map((s: Song) => s.hash));
          const welcomePaths = new Set(msg.library.map((s: Song) => s.path));
          const localOnly = currentSongs.filter(
            (s) => !welcomePaths.has(s.path) && (!s.hash || !welcomeHashes.has(s.hash))
          );
          useLibraryStore.setState({ songs: [...msg.library, ...localOnly], loading: false });
        } else {
          useLibraryStore.setState({ songs: msg.library, loading: false });
        }
        registered = true;
        break;
      }
      case 'state':
        applyServerState(
          msg.data,
          usePlayerStore.setState.bind(usePlayerStore),
          usePlayerStore.getState
        );
        break;
      case 'library': {
        useLibraryStore.getState().setSongsWithTransition(msg.data);
        const { useReindexStore } = await import('../components/ReindexOverlay');
        if (useReindexStore.getState().active) {
          useReindexStore.getState().stop();
        }
        break;
      }
      case 'reindex-progress': {
        const { useReindexStore } = await import('../components/ReindexOverlay');
        useReindexStore.getState().setProgress(msg.found, msg.added ?? 0, msg.skipped ?? 0);
        break;
      }
      case 'folder-import-song': {
        const { useFolderImportStore } = await import('../components/FolderImportOverlay');
        useFolderImportStore.getState().addSong({
          title: msg.title,
          artist: msg.artist,
          album: msg.album,
          isNew: msg.isNew,
        });
        break;
      }
      case 'folder-import-done': {
        const { useFolderImportStore } = await import('../components/FolderImportOverlay');
        useFolderImportStore.getState().finish(msg.folderName, msg.added, msg.skipped);
        break;
      }
      case 'edge-sync-start': {
        if (!isCapacitor()) {
          const { useSyncStore } = await import('../components/SyncBanner');
          useSyncStore.getState().startEdgeSync(msg.deviceName, msg.songCount);
        }
        break;
      }
      case 'edge-sync-done': {
        if (!isCapacitor()) {
          const { useSyncStore } = await import('../components/SyncBanner');
          useSyncStore.getState().finishEdgeSync(msg.deviceName, msg.newSongCount);
        }
        break;
      }
      case 'edge-sync-cancel': {
        if (!isCapacitor()) {
          const { useSyncStore } = await import('../components/SyncBanner');
          useSyncStore.getState().cancelEdgeSync(msg.deviceName);
        }
        break;
      }
    }
  }

  /** Handle WS disconnect cleanup (shared by both browser and native paths). */
  function handleWsDisconnect(code: number): void {
    wsConnected = false;

    // 4001 = revoked/unauthorized — clear all state and stop reconnecting
    if (code === 4001) {
      console.log('[OpenTunes] Device revoked by host, clearing state');
      registered = false;
      revoked = true;
      clearConnection();
      usePlayerStore.setState({
        currentTrack: null, isPlaying: false, queue: [], hasHistory: false,
        devices: [], activeDeviceId: null, currentTime: 0, duration: 0,
      });
      cleanupAllAudio();
      if (isCapacitor()) {
        useLibraryStore.getState().switchToLocalLibrary();
      } else {
        useLibraryStore.setState({ songs: [], loading: false });
      }
      return;
    }

    registered = false;

    if (isCapacitor() && useLibraryStore.getState().source === 'local') {
      // Already in local-only mode — don't destroy playback state
    } else if (isCapacitor()) {
      usePlayerStore.setState({
        currentTrack: null, isPlaying: false, queue: [], hasHistory: false,
        devices: [], activeDeviceId: null, currentTime: 0, duration: 0,
      });
      cleanupAllAudio();
      useLibraryStore.getState().switchToLocalLibrary();
    } else {
      usePlayerStore.setState({
        currentTrack: null, isPlaying: false, queue: [], hasHistory: false,
        devices: [], activeDeviceId: null, currentTime: 0, duration: 0,
      });
      useLibraryStore.setState({ songs: [], loading: false });
      cleanupAllAudio();
    }

    serverPositionAnchor = 0;
    serverPositionTimestamp = 0;
    serverIsPlaying = false;
  }

  // --- Capacitor: native WebSocket (survives screen-off) ---

  // When the WebView is suspended (screen off), the native WS may disconnect
  // and reconnect autonomously. We defer processing those events until the
  // WebView resumes so we don't needlessly clear and rebuild UI state.
  let pendingResumeSync = false;

  function connectNativeWebSocket() {
    const wsUrl = buildWsUrl();

    // Native handles heartbeat, reconnection, and reverse streaming.
    // JS just listens for forwarded messages and connection events.
    NativeWebSocket.addListener('wsConnected', () => {
      console.log('[OpenTunes] Native WebSocket connected');
      wsConnected = true;
      reconnectDelay = 1000;

      // If the WebView is suspended, the native side handles reconnection
      // autonomously (cached library re-announcement, heartbeats). Defer
      // JS-side re-init to the visibilitychange handler on resume.
      if (document.visibilityState === 'hidden') {
        pendingResumeSync = true;
        return;
      }

      registerThisDevice();
      localHistory = [];
      useLibraryStore.getState().switchToServerLibrary();
      initLocalLibrary(deviceId);
    });

    NativeWebSocket.addListener('wsMessage', (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerWsMessage;
        handleServerMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    NativeWebSocket.addListener('wsDisconnected', (event) => {
      console.log(`[OpenTunes] Native WebSocket disconnected: ${event.code} ${event.reason}`);

      // If the WebView is suspended, defer handling — the native WS will
      // attempt reconnection. We'll check the actual state on resume.
      // Exception: 4001 (revoked) must be handled immediately.
      if (document.visibilityState === 'hidden' && event.code !== 4001) {
        wsConnected = false;
        pendingResumeSync = true;
        return;
      }

      handleWsDisconnect(event.code);
      // Native handles reconnection — no scheduleReconnect() needed
    });

    NativeWebSocket.connect({
      wsUrl,
      deviceId,
      deviceName: getDeviceName(),
      deviceType: getDeviceType(),
    });
  }

  // --- Browser/Desktop: JS WebSocket ---

  function connectBrowserWebSocket() {
    const wsUrl = buildWsUrl();
    const ws = new WebSocket(wsUrl);
    activeWs = ws;

    let settled = false;

    const connectTimeout = setTimeout(() => {
      if (!settled && ws.readyState !== WebSocket.OPEN) {
        console.log('[OpenTunes] WebSocket connection timed out, retrying...');
        settled = true;
        ws.close();
        scheduleReconnect();
      }
    }, 5000);

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    ws.addEventListener('open', () => {
      clearTimeout(connectTimeout);
      console.log('[OpenTunes] WebSocket connected');
      wsConnected = true;
      reconnectDelay = 1000;
      registerThisDevice();
      localHistory = [];

      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'heartbeat',
            deviceId,
            name: getDeviceName(),
            deviceType: getDeviceType(),
          }));
        }
      }, 5000);
    });

    ws.addEventListener('message', async (event) => {
      try {
        const text = typeof event.data === 'string'
          ? event.data
          : await (event.data as Blob).text();
        const msg = JSON.parse(text) as ServerWsMessage;
        handleServerMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener('close', (event) => {
      clearTimeout(connectTimeout);
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      handleWsDisconnect(event.code);

      if (!settled && !revoked) {
        settled = true;
        console.log('[OpenTunes] WebSocket disconnected, reconnecting...');
        scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(connectTimeout);
      if (!settled && !revoked) {
        settled = true;
        handleWsDisconnect(1006);
        scheduleReconnect();
      }
    });
  }

  // Start the appropriate WebSocket connection
  if (isCapacitor()) {
    connectNativeWebSocket();
  } else {
    connectBrowserWebSocket();
  }

  // Poll every 10s as a fallback when WebSocket is disconnected.
  // Always re-register if pruned, even when WS is connected.
  // Skip polling entirely when in local-only mode — server is unreachable.
  setInterval(() => {
    if (revoked) return;
    if (isLocalOnlyMode()) return;
    if (!registered) registerThisDevice();
    if (wsConnected) return; // WebSocket handles real-time sync
    usePlayerStore.getState().syncFromServer();
  }, 10000);

  // Initial sync on load
  usePlayerStore.getState().syncFromServer();

  // Close the WebSocket cleanly when the app is closing.
  window.addEventListener('beforeunload', () => {
    if (isCapacitor()) {
      NativeWebSocket.disconnect();
    } else if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      revoked = true;
      activeWs.close(1000, 'app closing');
    }
  });

  // When the app comes back to the foreground, re-sync state.
  // On Capacitor, the native WS handles reconnection — JS just needs to
  // refresh its state. On browser, re-establish the WS if it was dropped.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      if (isCapacitor()) {
        if (pendingResumeSync) {
          // WS events occurred while the WebView was suspended.
          // Check the actual native connection state instead of replaying
          // stale disconnect/reconnect events that would clear the UI.
          pendingResumeSync = false;
          const { connected } = await NativeWebSocket.getConnectionState();
          if (connected) {
            // Connection was maintained or re-established during sleep.
            // The native side already re-announced the cached library.
            // Just do a light sync — no full re-init needed.
            wsConnected = true;
            useLibraryStore.getState().switchToServerLibrary();
            registerThisDevice();
            usePlayerStore.getState().syncFromServer();
          } else {
            // Truly disconnected and native hasn't reconnected yet
            handleWsDisconnect(1006);
          }
        } else {
          // No WS events during sleep — just refresh state
          registerThisDevice();
          usePlayerStore.getState().syncFromServer();
        }
      } else {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
          revoked = false;
          connectBrowserWebSocket();
        }
        registerThisDevice();
      }
    }
  });

  // Interpolate playback position locally for non-active devices.
  // Without this, the playhead only updates on WebSocket messages (state changes),
  // leaving it frozen between events like play/pause/skip.
  let interpolationFrame = 0;
  function interpolatePosition() {
    interpolationFrame = requestAnimationFrame(interpolatePosition);
    const state = usePlayerStore.getState();
    if (isThisDeviceActive(state) && !isCapacitor()) return; // active device uses audio timeupdate (except on Capacitor where native handles audio)
    if (!state.currentTrack || !serverIsPlaying) return;

    const elapsed = (Date.now() - serverPositionTimestamp) / 1000;
    const interpolated = serverPositionAnchor + elapsed;
    const dur = state.currentTrack.duration || Infinity;
    usePlayerStore.setState({
      currentTime: Math.min(interpolated, dur),
    });
  }
  interpolatePosition();
}
