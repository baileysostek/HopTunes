// Host-side federation state manager.
// Tracks edge device libraries, merges with host library, and handles
// reverse streaming (edge → host) using stream-as-it-arrives via PassThrough.

import path from 'path';
import fs from 'fs';
import { PassThrough } from 'stream';
import { app } from 'electron';
import { WebSocket } from 'ws';
import { Response } from 'express';
import { Song, EdgeSongMeta, ServerWsMessage } from '../shared/types';
import { mapHostSongRows, mapEdgeSongs, deduplicateSongs, mergeLibraries, EdgeLibraryEntry } from '../shared/federation';
import { getAllSongs } from './database';
import { handleSongSourceLost, getPlaybackState } from './playback';

// --- Types ---

interface EdgeDevice {
  deviceId: string;
  deviceName: string;
  ws: WebSocket;
  songs: EdgeSongMeta[];
  lastSeen: number;
}

interface PendingStream {
  requestId: string;
  passThrough: PassThrough;
  tempPath: string;
  writeStream: fs.WriteStream;
  mimeType: string | null;
  fileSize: number | null;
  resolved: boolean;
  resolve: () => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  /** Resolves when the edge device sends the audio-response metadata. */
  metadataResolve: (() => void) | null;
}

// --- State ---

const edgeDevices = new Map<string, EdgeDevice>();
const pendingStreams = new Map<string, PendingStream>();  // requestId → stream
const activeRequests = new Map<string, Set<string>>();    // deviceId → set of in-flight requestIds
// Tracks which request is currently receiving binary data from each device.
// The edge device processes requests sequentially, so binary frames always
// belong to the request that most recently received its edge-audio-response.
const currentStreamingRequest = new Map<string, string>(); // deviceId → requestId

let broadcastFn: ((msg: ServerWsMessage) => void) | null = null;

const CACHE_DIR = path.join(app.getPath('userData'), 'edge-cache');
const STREAM_TIMEOUT = 30_000; // 30 seconds

// Ensure cache directory exists
fs.mkdirSync(CACHE_DIR, { recursive: true });

// --- Public API ---

/** Inject the broadcast function (called once from index.ts during setup). */
export function setFederationBroadcast(fn: (msg: ServerWsMessage) => void): void {
  broadcastFn = fn;
}

/** Register an edge device's library. Triggers a unified library broadcast. */
export async function registerEdgeLibrary(
  deviceId: string,
  deviceName: string,
  ws: WebSocket,
  songs: EdgeSongMeta[],
  syncing?: boolean,
): Promise<void> {
  const isNew = !edgeDevices.has(deviceId);
  edgeDevices.set(deviceId, {
    deviceId,
    deviceName,
    ws,
    songs,
    lastSeen: Date.now(),
  });
  console.log(`[Federation] Registered edge device ${deviceName} (${deviceId}) with ${songs.length} songs`);

  // Notify all clients about sync status
  if (broadcastFn && songs.length > 0) {
    broadcastFn({ type: 'edge-sync-start', deviceName, songCount: songs.length });

    if (!syncing) {
      // Edge device is done hashing — defer the sync-done until after
      // the debounced library broadcast so the banner is visible
      pendingSyncDone.add(deviceName);
    }
  }

  await broadcastUnifiedLibrary();
}

/** Update an edge device's WebSocket reference (e.g., on reconnect). */
export function updateEdgeDeviceWs(deviceId: string, ws: WebSocket): void {
  const device = edgeDevices.get(deviceId);
  if (device) {
    device.ws = ws;
    device.lastSeen = Date.now();
  }
}

/** Update hashes for specific songs on an edge device (background hashing results). */
export async function updateEdgeLibraryHashes(
  deviceId: string,
  updates: { localPath: string; hash: string }[],
): Promise<void> {
  const device = edgeDevices.get(deviceId);
  if (!device) return;

  const hashMap = new Map(updates.map(u => [u.localPath, u.hash]));
  for (const song of device.songs) {
    const newHash = hashMap.get(song.localPath);
    if (newHash !== undefined) {
      song.hash = newHash;
    }
  }

  // Re-broadcast since dedup results may change with new hashes
  await broadcastUnifiedLibrary();
}

/** Unregister an edge device (on disconnect). Songs become unavailable. */
export async function unregisterEdgeDevice(deviceId: string): Promise<void> {
  const device = edgeDevices.get(deviceId);
  if (!device) return;

  // Cancel all pending streams from this device
  const reqIds = activeRequests.get(deviceId);
  if (reqIds) {
    for (const reqId of reqIds) {
      const pending = pendingStreams.get(reqId);
      if (pending && !pending.resolved) {
        pending.resolved = true;
        clearTimeout(pending.timeout);
        pending.passThrough.destroy(new Error('Device disconnected'));
        pending.writeStream.destroy();
        cleanupTempFile(pending.tempPath);
        pending.reject(new Error('Device disconnected'));
      }
      pendingStreams.delete(reqId);
    }
    activeRequests.delete(deviceId);
  }
  currentStreamingRequest.delete(deviceId);

  edgeDevices.delete(deviceId);
  pendingSyncDone.delete(device.deviceName);
  console.log(`[Federation] Unregistered edge device ${device.deviceName} (${deviceId})`);

  // Check if the currently playing song was from this device
  const playbackState = getPlaybackState();
  if (playbackState.currentSong?.origin?.deviceId === deviceId) {
    const cached = hasAudioCache(deviceId,
      decodeURIComponent(playbackState.currentSong.path.split('/').pop() || ''));
    if (!cached) {
      handleSongSourceLost(deviceId, (hash, excludeId) =>
        findAlternativeSource(hash, excludeId)
      );
    }
  }

  // Broadcast updated library — songs from this device are now gone
  await broadcastUnifiedLibrary();
}

/** Get the unified library: host songs + all edge device songs, deduplicated. */
export async function getUnifiedLibrary(): Promise<Song[]> {
  const hostRows = await getAllSongs();
  const hostSongs = mapHostSongRows(hostRows);

  const edgeLibraries = new Map<string, EdgeLibraryEntry>();
  const onlineDevices = new Set<string>();

  for (const [deviceId, device] of edgeDevices) {
    edgeLibraries.set(deviceId, {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      songs: device.songs,
    });
    // All registered devices are considered online (they have active WS)
    onlineDevices.add(deviceId);
  }

  return mergeLibraries(hostSongs, edgeLibraries, onlineDevices);
}

/** Check if an edge device is currently registered and connected. */
export function isEdgeDeviceOnline(deviceId: string): boolean {
  const device = edgeDevices.get(deviceId);
  return !!device && device.ws.readyState === WebSocket.OPEN;
}

/** Get list of connected edge devices with song counts. */
export function getConnectedEdgeDevices(): { deviceId: string; deviceName: string; songCount: number }[] {
  return [...edgeDevices.values()].map(d => ({
    deviceId: d.deviceId,
    deviceName: d.deviceName,
    songCount: d.songs.length,
  }));
}

// --- Reverse Audio Streaming (stream-as-it-arrives) ---

/**
 * Stream audio from an edge device to an HTTP response.
 * Uses a PassThrough stream so data flows to the client as soon as it arrives
 * from the edge device via WebSocket binary frames, while simultaneously
 * caching to disk for future requests.
 *
 * Returns true if streaming was initiated, false if it failed immediately.
 */
export async function streamAudioFromEdge(
  deviceId: string,
  localPath: string,
  res: Response,
): Promise<boolean> {
  // Check cache first
  const cachePath = getAudioCachePath(deviceId, localPath);
  if (fs.existsSync(cachePath)) {
    return false; // Caller should serve from cache using normal file streaming
  }

  const device = edgeDevices.get(deviceId);
  if (!device || device.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  const requestId = `${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = cachePath + '.tmp';

  // Ensure cache subdirectory exists
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  const passThrough = new PassThrough();
  const writeStream = fs.createWriteStream(tempPath);

  // Pipe PassThrough to both HTTP response and cache file
  passThrough.pipe(writeStream);

  const pending: PendingStream = {
    requestId,
    passThrough,
    tempPath,
    writeStream,
    mimeType: null,
    fileSize: null,
    resolved: false,
    resolve: () => {},
    reject: () => {},
    timeout: setTimeout(() => {
      if (!pending.resolved) {
        pending.resolved = true;
        passThrough.destroy(new Error('Stream timeout'));
        writeStream.destroy();
        cleanupTempFile(tempPath);
        pendingStreams.delete(requestId);
        removeActiveRequest(deviceId, requestId);
        if (currentStreamingRequest.get(deviceId) === requestId) {
          currentStreamingRequest.delete(deviceId);
        }
      }
    }, STREAM_TIMEOUT),
    metadataResolve: null,
  };

  // Set up completion promise
  const completionPromise = new Promise<void>((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;
  });

  pendingStreams.set(requestId, pending);
  if (!activeRequests.has(deviceId)) {
    activeRequests.set(deviceId, new Set());
  }
  activeRequests.get(deviceId)!.add(requestId);

  // When the PassThrough ends successfully, move temp to cache
  writeStream.on('finish', () => {
    if (!pending.resolved) return;
    try {
      if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, cachePath);
      }
    } catch (err) {
      console.error('[Federation] Failed to finalize cache file:', err);
      cleanupTempFile(tempPath);
    }
  });

  // Send request to edge device
  const requestMsg: ServerWsMessage = {
    type: 'request-audio',
    requestId,
    localPath,
  };
  device.ws.send(JSON.stringify(requestMsg));

  // Wait for the metadata response (edge-audio-response) before piping to HTTP.
  // handleEdgeAudioResponse() resolves metadataPromise when metadata arrives.
  const metadataPromise = new Promise<void>((resolve) => {
    pending.metadataResolve = resolve;
  });

  try {
    await Promise.race([
      metadataPromise,
      completionPromise.catch(() => {}),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Metadata timeout')), STREAM_TIMEOUT)
      ),
    ]);
  } catch {
    if (!pending.resolved) {
      pending.resolved = true;
      clearTimeout(pending.timeout);
      passThrough.destroy();
      writeStream.destroy();
      cleanupTempFile(tempPath);
      pendingStreams.delete(requestId);
      removeActiveRequest(deviceId, requestId);
    }
    return false;
  }

  if (pending.resolved || pending.mimeType === null) {
    return false;
  }

  // Set response headers and pipe
  res.setHeader('Content-Type', pending.mimeType);
  if (pending.fileSize) {
    res.setHeader('Content-Length', pending.fileSize);
  }
  passThrough.pipe(res);

  // Handle client disconnect
  res.on('close', () => {
    // Don't destroy the passThrough — let it continue so the cache file completes
  });

  return true;
}

/**
 * Handle the edge-audio-response metadata message.
 * Called from the WS message router when the edge device responds with file info.
 */
export function handleEdgeAudioResponse(requestId: string, mimeType: string, fileSize: number): void {
  const pending = pendingStreams.get(requestId);
  if (!pending || pending.resolved) return;

  pending.mimeType = mimeType;
  pending.fileSize = fileSize;

  // Mark this request as the one currently receiving binary frames from its device.
  // The edge device processes requests sequentially, so the most recent
  // edge-audio-response always identifies the active binary stream.
  for (const [devId, reqIds] of activeRequests) {
    if (reqIds.has(requestId)) {
      currentStreamingRequest.set(devId, requestId);
      break;
    }
  }

  // Notify streamAudioFromEdge() that metadata is available
  if (pending.metadataResolve) {
    pending.metadataResolve();
    pending.metadataResolve = null;
  }
}

/**
 * Handle incoming binary WebSocket frame for an active stream.
 * Called from the WS message router when binary data arrives from an edge device.
 */
export function handleEdgeBinaryFrame(deviceId: string, data: Buffer): void {
  const requestId = currentStreamingRequest.get(deviceId);
  if (!requestId) return;

  const pending = pendingStreams.get(requestId);
  if (!pending || pending.resolved) return;

  if (data.length === 0) {
    // Empty frame = stream complete signal
    pending.resolved = true;
    clearTimeout(pending.timeout);
    pending.passThrough.end();
    pendingStreams.delete(requestId);
    removeActiveRequest(deviceId, requestId);
    currentStreamingRequest.delete(deviceId);
    pending.resolve();
  } else {
    // Write chunk to PassThrough (which pipes to both HTTP response and cache file)
    pending.passThrough.write(data);
  }
}

// --- Reverse Art Streaming ---

/**
 * Request album art from an edge device.
 * Returns base64 data or null if no art is available.
 */
export function requestArtFromEdge(deviceId: string, localPath: string): Promise<string | null> {
  const device = edgeDevices.get(deviceId);
  if (!device || device.ws.readyState !== WebSocket.OPEN) {
    return Promise.resolve(null);
  }

  const requestId = `art-${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      artRequests.delete(requestId);
      resolve(null);
    }, 10_000);

    artRequests.set(requestId, { resolve, timeout });

    const msg: ServerWsMessage = {
      type: 'request-art',
      requestId,
      localPath,
    };
    device.ws.send(JSON.stringify(msg));
  });
}

const artRequests = new Map<string, {
  resolve: (data: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/** Handle the edge-art-response message. */
export function handleEdgeArtResponse(requestId: string, data: string | null): void {
  const pending = artRequests.get(requestId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  artRequests.delete(requestId);
  pending.resolve(data);
}

// --- Cache helpers ---

/** Get the cache path for an edge device's audio file. */
export function getAudioCachePath(deviceId: string, localPath: string): string {
  // Use a safe filename derived from the local path
  const safeName = Buffer.from(localPath).toString('base64url');
  return path.join(CACHE_DIR, deviceId, safeName);
}

/** Check if a cached copy exists for an edge device's audio file. */
export function hasAudioCache(deviceId: string, localPath: string): boolean {
  return fs.existsSync(getAudioCachePath(deviceId, localPath));
}

/** Get cache stats for a device. */
export function getCacheStats(): { totalFiles: number; totalSizeBytes: number } {
  let totalFiles = 0;
  let totalSizeBytes = 0;

  if (!fs.existsSync(CACHE_DIR)) return { totalFiles, totalSizeBytes };

  try {
    const deviceDirs = fs.readdirSync(CACHE_DIR);
    for (const dir of deviceDirs) {
      const devicePath = path.join(CACHE_DIR, dir);
      if (!fs.statSync(devicePath).isDirectory()) continue;
      const files = fs.readdirSync(devicePath);
      for (const file of files) {
        if (file.endsWith('.tmp')) continue;
        try {
          const stat = fs.statSync(path.join(devicePath, file));
          totalFiles++;
          totalSizeBytes += stat.size;
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  return { totalFiles, totalSizeBytes };
}

/** Clear all cached edge audio files. */
export function clearCache(): void {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// --- Internal helpers ---

/**
 * Find an alternative source for a song by hash.
 * Searches the host DB and other edge device libraries for the same hash.
 * Returns a Song with a working path, or null if no alternative exists.
 */
function findAlternativeSource(hash: string, excludeDeviceId: string): Song | null {
  if (!hash) return null;

  // Check other edge devices
  for (const [devId, device] of edgeDevices) {
    if (devId === excludeDeviceId) continue;
    if (device.ws.readyState !== WebSocket.OPEN) continue;

    const match = device.songs.find(s => s.hash === hash);
    if (match) {
      const songs = mapEdgeSongs([match], devId, device.deviceName, true);
      return songs[0];
    }
  }

  // No alternative found (host songs don't need source-lost handling)
  return null;
}

// Debounce library broadcasts so rapid-fire changes (e.g., hash batches arriving
// from edge devices) don't cause the host UI to flicker. Accumulates all changes
// within the window and sends a single broadcast.
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
const BROADCAST_DEBOUNCE_MS = 300;

// Device names that need an 'edge-sync-done' after the next library broadcast
const pendingSyncDone = new Set<string>();

async function broadcastUnifiedLibrary(): Promise<void> {
  if (!broadcastFn) return;

  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    try {
      const library = await getUnifiedLibrary();
      broadcastFn!({ type: 'library', data: library });

      // Send deferred sync-done notifications after the library update
      if (pendingSyncDone.size > 0) {
        for (const deviceName of pendingSyncDone) {
          broadcastFn!({ type: 'edge-sync-done', deviceName });
        }
        pendingSyncDone.clear();
      }
    } catch (err) {
      console.error('[Federation] Failed to broadcast unified library:', err);
    }
  }, BROADCAST_DEBOUNCE_MS);
}

/** Immediately broadcast the unified library (bypasses debounce). Used for welcome messages. */
export async function getUnifiedLibraryNow(): Promise<Song[]> {
  // Cancel any pending debounced broadcast since we're sending fresh data
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
  return getUnifiedLibrary();
}

/** Remove a single requestId from the per-device active request set. */
function removeActiveRequest(deviceId: string, requestId: string): void {
  const reqIds = activeRequests.get(deviceId);
  if (!reqIds) return;
  reqIds.delete(requestId);
  if (reqIds.size === 0) {
    activeRequests.delete(deviceId);
  }
}

function cleanupTempFile(tempPath: string): void {
  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch { /* best effort */ }
}

/** @internal Reset all module state. Only for use in tests. */
export function __resetForTesting(): void {
  edgeDevices.clear();
  pendingStreams.clear();
  activeRequests.clear();
  currentStreamingRequest.clear();
  artRequests.clear();
  pendingSyncDone.clear();
  broadcastFn = null;
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
}
