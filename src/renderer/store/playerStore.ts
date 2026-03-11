import { create } from 'zustand';
import axios from 'axios';
import { Song, getApiBase, getAuthToken, getMediaUrl, clearConnection } from '../types/song';
import { isElectron } from '../utils/platform';
import { useLibraryStore } from './libraryStore';

let audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.volume = 0.7;
  }
  return audio;
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
  // Try to use a meaningful name for mobile
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  return 'Browser';
}

function getDeviceType(): 'desktop' | 'mobile' | 'web' {
  if (isElectron()) return 'desktop';
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return 'mobile';
  return 'web';
}

export interface DeviceInfo {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'web';
  lastSeen: number;
}

interface ServerPlaybackState {
  currentSong: Song | null;
  status: 'playing' | 'paused' | 'stopped';
  position: number;
  updatedAt: number;
  queue: Song[];
  history: Song[];
  estimatedPosition: number;
  activeDeviceId: string | null;
  devices: DeviceInfo[];
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
  activeDeviceId: string | null;
  devices: DeviceInfo[];
  thisDeviceId: string;
  play: (song: Song, queue?: Song[]) => void;
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
  const shouldPlayAudio = isThisDeviceActive(server);
  const justBecameActive = shouldPlayAudio && !wasActivePlayer;

  // Update tracking for next call
  wasActivePlayer = shouldPlayAudio;

  if (shouldPlayAudio) {
    // This device is the active player — manage audio
    if (newTrack?.path !== local.currentTrack?.path || (justBecameActive && newTrack)) {
      // Track changed OR device just became active — (re)load audio
      if (newTrack) {
        a.src = getMediaUrl(newTrack.path);
        a.currentTime = server.estimatedPosition;
        if (isNowPlaying) a.play().catch(() => {});
      } else {
        a.pause();
        a.src = '';
      }
    } else if (local.isPlaying !== isNowPlaying) {
      if (isNowPlaying) a.play().catch(() => {});
      else a.pause();
    }

    // Sync position if significantly off (skip if we just loaded)
    if (newTrack && !justBecameActive && Math.abs(a.currentTime - server.estimatedPosition) > 2) {
      a.currentTime = server.estimatedPosition;
    }
  } else {
    // Not the active player — stop any local audio
    if (!a.paused) a.pause();
    a.src = '';

    // Store the server's position anchor for local interpolation
    serverPositionAnchor = server.estimatedPosition;
    serverPositionTimestamp = Date.now();
    serverIsPlaying = isNowPlaying;
  }

  // If this device is missing from the server's device list, mark as
  // unregistered so the next poll cycle (or an immediate call) re-registers it.
  // This makes the system self-healing regardless of why the device was pruned.
  if (server.devices.length > 0 && !server.devices.some(d => d.id === deviceId)) {
    registered = false;
  }

  set({
    currentTrack: newTrack,
    isPlaying: isNowPlaying,
    queue: server.queue,
    hasHistory: server.history.length > 0,
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
  activeDeviceId: null,
  devices: [],
  thisDeviceId: deviceId,

  play: async (song, queue) => {
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

  pause: async () => {
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/pause`);
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to pause:', err);
    }
  },

  resume: async () => {
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
    try {
      const response = await axios.post(`${getApiBase()}/api/playback/skip`);
      applyServerState(response.data, set, get);
    } catch (err) {
      console.error('Failed to skip:', err);
    }
  },

  prev: async () => {
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
    getAudio().volume = vol;
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
  const a = getAudio();

  a.addEventListener('timeupdate', () => {
    // Only the active device should drive time/duration from the audio element.
    // Non-active devices have a.src = '' so a.duration is NaN and a.currentTime is 0,
    // which would overwrite the correct interpolated values.
    if (!isThisDeviceActive(usePlayerStore.getState())) return;
    // Skip if metadata hasn't loaded yet (duration is NaN) to avoid clobbering
    // the server-provided duration with 0
    if (!a.duration || isNaN(a.duration)) return;
    usePlayerStore.setState({
      currentTime: a.currentTime,
      duration: a.duration,
    });
  });

  a.addEventListener('ended', () => {
    // Only the active device should advance the queue
    if (isThisDeviceActive(usePlayerStore.getState())) {
      usePlayerStore.getState().next();
    }
  });

  a.addEventListener('loadedmetadata', () => {
    if (!isThisDeviceActive(usePlayerStore.getState())) return;
    usePlayerStore.setState({ duration: a.duration });
  });

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

  registerThisDevice();

  // --- WebSocket for instant state sync ---
  let wsConnected = false;
  let revoked = false; // true when the host revokes this device
  let activeWs: WebSocket | null = null; // reference for clean shutdown

  function connectWebSocket() {
    const base = getApiBase().replace(/^http/, 'ws');
    const token = getAuthToken();
    const wsUrl = token ? `${base}?token=${encodeURIComponent(token)}` : base;
    const ws = new WebSocket(wsUrl);
    activeWs = ws;

    let settled = false; // prevents double-scheduling reconnects

    // If the connection doesn't open within 5s, kill it and retry.
    // This prevents hanging in CONNECTING state for 30-60s (TCP timeout)
    // when the host isn't running yet.
    const connectTimeout = setTimeout(() => {
      if (!settled && ws.readyState !== WebSocket.OPEN) {
        console.log('[OpenTunes] WebSocket connection timed out, retrying...');
        settled = true;
        ws.close();
        setTimeout(connectWebSocket, 1000);
      }
    }, 5000);

    ws.addEventListener('open', () => {
      clearTimeout(connectTimeout);
      console.log('[OpenTunes] WebSocket connected');
      wsConnected = true;
      // (Re-)register on every connect — server may have restarted
      registerThisDevice();
      // Re-fetch the music library — it may have failed on initial load
      // if the host wasn't running yet
      useLibraryStore.getState().fetchLibrary();
    });

    ws.addEventListener('message', async (event) => {
      try {
        // On some platforms (Android WebView), data may arrive as a Blob
        const text = typeof event.data === 'string'
          ? event.data
          : await (event.data as Blob).text();
        const serverState = JSON.parse(text);
        applyServerState(
          serverState,
          usePlayerStore.setState.bind(usePlayerStore),
          usePlayerStore.getState
        );
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener('close', (event) => {
      clearTimeout(connectTimeout);
      wsConnected = false;

      // 4001 = revoked/unauthorized — clear all state and stop reconnecting
      if (event.code === 4001) {
        console.log('[OpenTunes] Device revoked by host, clearing state');
        settled = true;
        registered = false;
        revoked = true;
        clearConnection();
        useLibraryStore.setState({ songs: [], loading: false });
        usePlayerStore.setState({
          currentTrack: null,
          isPlaying: false,
          queue: [],
          hasHistory: false,
          devices: [],
          activeDeviceId: null,
          currentTime: 0,
          duration: 0,
        });
        const a = getAudio();
        a.pause();
        a.src = '';
        return;
      }

      if (!settled) {
        settled = true;
        console.log('[OpenTunes] WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 1000);
      }
    });

    ws.addEventListener('error', () => {
      // Schedule reconnect from error too — some WebViews don't fire 'close'
      // after 'error'. The settled flag prevents double-scheduling.
      clearTimeout(connectTimeout);
      if (!settled) {
        settled = true;
        setTimeout(connectWebSocket, 1000);
      }
    });
  }

  connectWebSocket();

  // Poll every 10s as a fallback (WebSocket handles real-time sync)
  setInterval(() => {
    if (revoked) return;
    if (!registered) registerThisDevice();
    usePlayerStore.getState().syncFromServer();
  }, 10000);

  // Initial sync on load
  usePlayerStore.getState().syncFromServer();

  // Explicitly close the WebSocket when the app is shutting down so the
  // server detects the disconnect instantly (sends a proper close frame)
  // instead of waiting for the ping/pong timeout.
  function cleanupOnShutdown() {
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      revoked = true; // prevent reconnection attempts
      activeWs.close(1000, 'app closing');
    }
  }
  window.addEventListener('beforeunload', cleanupOnShutdown);
  window.addEventListener('pagehide', cleanupOnShutdown);

  // Use visibilitychange to handle mobile app backgrounding/foregrounding.
  // On Android WebViews (Capacitor), this fires when the app is backgrounded
  // or brought back to the foreground — no native plugin needed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      cleanupOnShutdown();
    } else if (document.visibilityState === 'visible') {
      // Re-establish connection when the app comes back to foreground
      if (revoked || !activeWs || activeWs.readyState !== WebSocket.OPEN) {
        revoked = false;
        connectWebSocket();
      }
      registerThisDevice();
    }
  });

  // Interpolate playback position locally for non-active devices.
  // Without this, the playhead only updates on WebSocket messages (state changes),
  // leaving it frozen between events like play/pause/skip.
  let interpolationFrame = 0;
  function interpolatePosition() {
    interpolationFrame = requestAnimationFrame(interpolatePosition);
    const state = usePlayerStore.getState();
    if (isThisDeviceActive(state)) return; // active device uses audio timeupdate
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
