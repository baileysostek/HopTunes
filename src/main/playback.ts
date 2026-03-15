import {
  Song,
  DeviceInfo,
  PlaybackState,
  ServerPlaybackState,
} from '../shared/types';
import { smartShuffle, findSmartInsertPosition } from '../shared/smartShuffle';

// Re-export shared types so existing imports from './playback' still work
export type { Song as SongInfo, DeviceInfo };

const MAX_HISTORY = 100;
const DEVICE_TIMEOUT = 10000; // Remove devices not seen in 10s

const state: PlaybackState = {
  currentSong: null,
  status: 'stopped',
  position: 0,
  updatedAt: Date.now(),
  queue: [],
  history: [],
  shuffleEnabled: false,
};

// Original queue order preserved when shuffle is on, so toggling off restores it
let originalQueue: Song[] = [];

const devices = new Map<string, DeviceInfo>();
let activeDeviceId: string | null = null;

// --- Device management ---

function pruneStaleDevices(): void {
  const now = Date.now();
  for (const [id, device] of devices) {
    if (now - device.lastSeen > DEVICE_TIMEOUT) {
      devices.delete(id);
      if (activeDeviceId === id) {
        // If active device went away, pick the first remaining one
        activeDeviceId = devices.size > 0 ? devices.keys().next().value : null;
      }
    }
  }
}

export function registerDevice(id: string, name: string, type: DeviceInfo['type']): void {
  devices.set(id, { id, name, type, lastSeen: Date.now() });
  // First device to register becomes active
  if (activeDeviceId === null) {
    activeDeviceId = id;
  }
}

export function removeDevice(id: string): void {
  devices.delete(id);
  if (activeDeviceId === id) {
    activeDeviceId = devices.size > 0 ? devices.keys().next().value : null;
  }
}

export function heartbeatDevice(id: string): boolean {
  const device = devices.get(id);
  if (device) {
    device.lastSeen = Date.now();
    return true;
  }
  return false;
}

export function getDevices(): DeviceInfo[] {
  pruneStaleDevices();
  return [...devices.values()];
}

export function getActiveDeviceId(): string | null {
  pruneStaleDevices();
  return activeDeviceId;
}

export function setActiveDevice(deviceId: string): boolean {
  if (!devices.has(deviceId)) return false;
  activeDeviceId = deviceId;
  return true;
}

// Returns the estimated current position accounting for elapsed time
function estimatedPosition(): number {
  if (state.status === 'playing' && state.currentSong) {
    const elapsed = (Date.now() - state.updatedAt) / 1000;
    const pos = state.position + elapsed;
    const dur = state.currentSong.duration;
    return dur ? Math.min(pos, dur) : pos;
  }
  return state.position;
}

function pushToHistory(song: Song): void {
  state.history.push(song);
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(-MAX_HISTORY);
  }
}

export function getPlaybackState(): ServerPlaybackState {
  pruneStaleDevices();
  return {
    ...state,
    queue: [...state.queue],
    history: [...state.history],
    estimatedPosition: estimatedPosition(),
    activeDeviceId,
    devices: [...devices.values()],
  };
}

export function play(song: Song): void {
  if (state.currentSong && state.currentSong.path !== song.path) {
    pushToHistory(state.currentSong);
  }
  state.currentSong = song;
  state.status = 'playing';
  state.position = 0;
  state.updatedAt = Date.now();
}

export function playWithQueue(song: Song, queue: Song[]): void {
  if (state.currentSong && state.currentSong.path !== song.path) {
    pushToHistory(state.currentSong);
  }
  state.currentSong = song;
  state.status = 'playing';
  state.position = 0;
  state.updatedAt = Date.now();
  if (state.shuffleEnabled) {
    originalQueue = [...queue];
    state.queue = smartShuffle(queue);
  } else {
    originalQueue = [];
    state.queue = [...queue];
  }
}

export function pause(): void {
  state.position = estimatedPosition();
  state.updatedAt = Date.now();
  state.status = 'paused';
}

export function resume(): void {
  state.updatedAt = Date.now();
  state.status = 'playing';
}

export function stop(): void {
  state.currentSong = null;
  state.status = 'stopped';
  state.position = 0;
  state.updatedAt = Date.now();
}

export function seek(positionSeconds: number): void {
  state.position = Math.max(0, positionSeconds);
  state.updatedAt = Date.now();
}

export function skipNext(): Song | null {
  if (state.currentSong) {
    pushToHistory(state.currentSong);
  }
  const next = state.queue.shift() || null;
  if (next) {
    state.currentSong = next;
    state.status = 'playing';
    state.position = 0;
    state.updatedAt = Date.now();
  } else {
    stop();
  }
  return next;
}

export function skipPrev(): Song | null {
  const prev = state.history.pop() || null;
  if (prev) {
    // Push current song back to front of queue
    if (state.currentSong) {
      state.queue.unshift(state.currentSong);
    }
    state.currentSong = prev;
    state.status = 'playing';
    state.position = 0;
    state.updatedAt = Date.now();
  }
  return prev;
}

// Queue operations

export function addToQueue(song: Song): void {
  if (state.shuffleEnabled) {
    originalQueue.push(song);
    const pos = findSmartInsertPosition(state.queue, song);
    state.queue.splice(pos, 0, song);
  } else {
    state.queue.push(song);
  }
}

export function addToQueueNext(song: Song): void {
  state.queue.unshift(song);
  if (state.shuffleEnabled) {
    originalQueue.unshift(song);
  }
}

export function removeFromQueue(index: number): Song | null {
  if (index < 0 || index >= state.queue.length) return null;
  const removed = state.queue.splice(index, 1)[0];
  if (state.shuffleEnabled) {
    const origIdx = originalQueue.findIndex(s => s.hash === removed.hash && s.path === removed.path);
    if (origIdx >= 0) originalQueue.splice(origIdx, 1);
  }
  return removed;
}

export function clearQueue(): void {
  state.queue = [];
  originalQueue = [];
}

export function moveInQueue(fromIndex: number, toIndex: number): boolean {
  if (
    fromIndex < 0 || fromIndex >= state.queue.length ||
    toIndex < 0 || toIndex >= state.queue.length
  ) return false;
  const [item] = state.queue.splice(fromIndex, 1);
  state.queue.splice(toIndex, 0, item);
  return true;
}

// --- Shuffle ---

export function setShuffle(enabled: boolean): void {
  state.shuffleEnabled = enabled;
  if (enabled) {
    originalQueue = [...state.queue];
    state.queue = smartShuffle(state.queue);
  } else {
    // Restore original order, but only songs still in the shuffled queue
    const currentHashes = new Set(state.queue.map(s => s.path));
    state.queue = originalQueue.filter(s => currentHashes.has(s.path));
    originalQueue = [];
  }
}

export function getShuffleEnabled(): boolean {
  return state.shuffleEnabled;
}

// --- Resilience ---

/**
 * Remove all queued songs sourced from the given device.
 */
export function purgeDeviceFromQueue(deviceId: string): void {
  state.queue = state.queue.filter(s => s.origin?.deviceId !== deviceId);
  if (state.shuffleEnabled) {
    originalQueue = originalQueue.filter(s => s.origin?.deviceId !== deviceId);
  }
}

/**
 * Handle the case where the current song's source device has gone offline
 * and the file is not cached. If the same hash exists on another source
 * (another edge device or the host), swap the path. Otherwise, skip to next.
 */
export function handleSongSourceLost(
  deviceId: string,
  findAlternative: (hash: string, excludeDeviceId: string) => Song | null,
): void {
  if (!state.currentSong) return;
  if (!state.currentSong.origin || state.currentSong.origin.deviceId !== deviceId) return;

  // Try to find an alternative source for the same song (by hash)
  if (state.currentSong.hash) {
    const alt = findAlternative(state.currentSong.hash, deviceId);
    if (alt) {
      state.currentSong = alt;
      state.updatedAt = Date.now();
      broadcastState();
      return;
    }
  }

  // No alternative — skip to next
  console.log(`[Playback] Song source lost (device ${deviceId}), skipping to next`);
  skipNext();
  broadcastState();
}

// --- WebSocket broadcast ---

type StateListener = () => void;
const listeners: Set<StateListener> = new Set();

export function onStateChange(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcastState(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** @internal Reset all module state. Only for use in tests. */
export function __resetForTesting(): void {
  state.currentSong = null;
  state.status = 'stopped';
  state.position = 0;
  state.updatedAt = Date.now();
  state.queue = [];
  state.history = [];
  state.shuffleEnabled = false;
  originalQueue = [];
  devices.clear();
  activeDeviceId = null;
  listeners.clear();
}
