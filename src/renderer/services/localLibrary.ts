// Client-side local library orchestrator for edge (Capacitor) devices.
// Scans local music via the LocalLibrary Capacitor plugin, syncs with the host
// via the NativeWebSocket plugin, and persists to local SQLite for offline use.
//
// Reverse streaming (request-audio / request-art) is handled entirely in native
// Java by NativeWebSocketManager — no JS involvement needed.

import { registerPlugin } from '@capacitor/core';
import { EdgeSongMeta, ClientWsMessage } from '../../shared/types';
import { isCapacitor } from '../utils/platform';
import { edgeDatabase, initEdgeDatabase } from './edgeDatabase';
import { useSyncStore } from '../components/SyncBanner';
import { NativeWebSocket } from './nativeWebSocket';

// --- Capacitor plugin interface ---

interface HashResult {
  localPath: string;
  hash: string;
  hasArt: boolean;
}

interface LocalLibraryPlugin {
  selectFolder(): Promise<{ path: string | null }>;
  scanLibrary(options?: { paths?: string[] }): Promise<{ songs: LocalScanResult[] }>;
  computeHashes(options: { paths: string[] }): Promise<{ results: HashResult[] }>;
  getFileBytes(options: { localPath: string }): Promise<{ chunks: string[]; mimeType: string; fileSize: number }>;
  getEmbeddedArt(options: { localPath: string }): Promise<{ data: string | null }>;
}

interface LocalScanResult {
  localPath: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  trackNumber: number;
  mimeType: string;
  fileSize: number;
  hasArt: boolean;
  hash: string;
}

const LocalLibrary = registerPlugin<LocalLibraryPlugin>('LocalLibrary');

// --- State ---

let initialized = false;
let dbInitialized = false;
let lastScanTime = 0;
let localSongs: EdgeSongMeta[] = [];
let deviceId: string = '';

const MIN_RESCAN_INTERVAL = 5 * 60 * 1000; // 5 minutes
async function ensureDbInitialized(): Promise<void> {
  if (dbInitialized) return;
  await initEdgeDatabase();
  dbInitialized = true;
}

// --- Public API ---

/**
 * Initialize the local library service.
 * Only runs on Capacitor (Android) — no-op on desktop/web.
 */
export async function initLocalLibrary(
  edgeDeviceId: string,
): Promise<void> {
  if (!isCapacitor()) return;

  deviceId = edgeDeviceId;

  if (initialized) {
    // Already initialized — re-announce via native WS on reconnect
    if (localSongs.length > 0 && deviceId) {
      announceToHost();
      console.log(`[LocalLibrary] Re-announced ${localSongs.length} songs on reconnect`);
    }
    return;
  }

  initialized = true;

  // Initialize the edge SQLite database
  await ensureDbInitialized();

  // Scan local library and announce to host
  await scanAndAnnounce();

  // Re-scan when app returns to foreground (if enough time has passed)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const elapsed = Date.now() - lastScanTime;
      if (elapsed > MIN_RESCAN_INTERVAL) {
        scanAndAnnounce();
      }
    }
  });
}

/** Get the list of locally scanned songs (for offline playback). */
export function getLocalSongs(): EdgeSongMeta[] {
  return localSongs;
}

/**
 * Manually trigger a local library scan from the UI.
 * Works even without a host connection — stores to local SQLite.
 * Returns the number of songs found.
 */
export async function scanLocalLibrary(): Promise<number> {
  if (!isCapacitor()) return 0;
  await scanAndAnnounce();
  return localSongs.length;
}

/**
 * Open the native folder picker and add the selected directory as a media location.
 * Returns the selected path, or null if the user cancelled.
 */
export async function selectMusicFolder(): Promise<string | null> {
  if (!isCapacitor()) return null;
  await ensureDbInitialized();

  const result = await LocalLibrary.selectFolder();
  if (!result.path) return null;

  await edgeDatabase.addMediaLocation(result.path);
  return result.path;
}

/** Get saved media locations from local SQLite. */
export async function getMediaLocations(): Promise<string[]> {
  if (!isCapacitor()) return [];
  await ensureDbInitialized();
  return edgeDatabase.getMediaLocations();
}

/** Remove a media location and re-scan. */
export async function removeMusicFolder(path: string): Promise<void> {
  if (!isCapacitor()) return;
  await ensureDbInitialized();
  await edgeDatabase.removeMediaLocation(path);
}

/**
 * Get a local file URL for direct playback on this device.
 * Uses Capacitor's file access to bypass the server.
 */
export function getLocalFileUrl(localPath: string): string {
  // Capacitor's WebView can access local files via this URL scheme
  const cap = (window as any).Capacitor;
  if (cap && typeof cap.convertFileSrc === 'function') {
    return cap.convertFileSrc(localPath);
  }
  // Fallback: file:// URL (may not work in all WebViews)
  return `file://${localPath}`;
}

// --- Internal ---

async function scanAndAnnounce(): Promise<void> {
  const sync = useSyncStore.getState();
  try {
    await ensureDbInitialized();

    // Read user-selected media locations
    const locations = await edgeDatabase.getMediaLocations();
    if (locations.length === 0) {
      console.log('[LocalLibrary] No media locations configured, skipping scan');
      localSongs = [];
      return;
    }

    // Phase 1: Fast metadata scan (MediaStore only, no file I/O)
    sync.startScan();
    console.log(`[LocalLibrary] Scanning ${locations.length} folder(s)...`);
    const result = await LocalLibrary.scanLibrary({ paths: locations });
    lastScanTime = Date.now();

    // Read previously computed hashes from local SQLite
    const existingRows = await edgeDatabase.getAllSongs(true);
    const dbLookup = new Map<string, { hash: string; hasArt: boolean }>();
    for (const row of existingRows) {
      if (row.hash) {
        dbLookup.set(row.file_path, { hash: row.hash, hasArt: !!row.has_art });
      }
    }

    localSongs = result.songs.map(s => {
      const cached = dbLookup.get(s.localPath);
      return {
        localPath: s.localPath,
        title: s.title,
        artist: s.artist,
        album: s.album,
        duration: s.duration,
        trackNumber: s.trackNumber,
        hash: cached?.hash ?? '',
        hasArt: cached?.hasArt ?? s.hasArt,
        mimeType: s.mimeType,
        fileSize: s.fileSize,
      };
    });

    const newSongCount = localSongs.filter(s => !s.hash).length;
    console.log(`[LocalLibrary] Found ${localSongs.length} local songs (${localSongs.length - newSongCount} cached, ${newSongCount} new)`);

    // Persist to local SQLite for offline use
    await persistToLocalDb(localSongs);

    // Announce to host — most songs already have hashes from the DB
    const hasNewSongs = newSongCount > 0;
    announceToHost(hasNewSongs); // syncing=true if still computing hashes

    // Only compute hashes for songs that don't have one yet
    if (hasNewSongs) {
      computeHashesAndReannounce();
    } else {
      sync.finish();
    }
  } catch (err) {
    console.error('[LocalLibrary] Scan failed:', err);
    sync.finish();
  }
}

/** Send the current localSongs to the host via the native WebSocket. */
function announceToHost(syncing = false): void {
  if (!deviceId || localSongs.length === 0) return;

  const msg: ClientWsMessage = {
    type: 'edge-library',
    deviceId,
    songs: localSongs,
    syncing,
  };
  const json = JSON.stringify(msg);

  // Send via native WS and cache for reconnect re-announcement
  NativeWebSocket.sendMessage({ message: json });
  NativeWebSocket.cacheEdgeLibrary({ json });
}

const HASH_BATCH_SIZE = 50;

/** Compute SHA256 hashes and art flags for new songs in batches, then re-announce once. */
async function computeHashesAndReannounce(): Promise<void> {
  const sync = useSyncStore.getState();
  try {
    const needsHash = localSongs.filter(s => !s.hash);
    const total = needsHash.length;
    console.log(`[LocalLibrary] Computing hashes for ${total} new songs...`);
    sync.startHashing(total);

    // Process in batches so the progress bar updates incrementally
    const hashMap = new Map<string, { hash: string; hasArt: boolean }>();
    for (let i = 0; i < needsHash.length; i += HASH_BATCH_SIZE) {
      const batch = needsHash.slice(i, i + HASH_BATCH_SIZE);
      const paths = batch.map(s => s.localPath);

      const { results } = await LocalLibrary.computeHashes({ paths });
      for (const r of results) {
        hashMap.set(r.localPath, { hash: r.hash, hasArt: r.hasArt });
      }

      useSyncStore.getState().setHashProgress(Math.min(i + batch.length, total));
    }

    // Update localSongs in place
    let changed = false;
    for (const song of localSongs) {
      const info = hashMap.get(song.localPath);
      if (info) {
        if (song.hash !== info.hash || song.hasArt !== info.hasArt) {
          song.hash = info.hash;
          song.hasArt = info.hasArt;
          changed = true;
        }
      }
    }

    if (changed) {
      console.log('[LocalLibrary] Hashes computed, re-announcing to host');
      await persistToLocalDb(localSongs);
      announceToHost();
    } else {
      console.log('[LocalLibrary] Hashes computed, no changes');
    }

    sync.finish();
  } catch (err) {
    console.error('[LocalLibrary] Hash computation failed:', err);
    useSyncStore.getState().finish();
  }
}

async function persistToLocalDb(songs: EdgeSongMeta[]): Promise<void> {
  const existingPaths = new Set(songs.map(s => s.localPath));

  // Remove songs no longer on device
  await edgeDatabase.removeDeletedSongs(existingPaths);

  // Upsert all scanned songs
  for (const song of songs) {
    await edgeDatabase.upsertSong({
      file_path: song.localPath,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      has_art: song.hasArt ? 1 : 0,
      file_modified_at: Date.now(),
      track_number: song.trackNumber,
      hash: song.hash,
    });
  }

  await edgeDatabase.markDuplicatesHidden();
}
