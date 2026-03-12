// Pure functions for merging and deduplicating libraries from multiple devices.
// No side effects — safe to use on both host and edge.

import { Song, EdgeSongMeta, SongOrigin, AUDIO_PATH_PREFIX } from './types';
import { SongRow } from './db-schema';

// --- Mapping helpers ---

/** Map host database rows to Song objects (no origin = host-local). */
export function mapHostSongRows(rows: SongRow[]): Song[] {
  return rows.map((row) => ({
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    trackNumber: row.track_number,
    path: AUDIO_PATH_PREFIX + encodeURIComponent(row.file_path),
    art: row.has_art ? `/api/art/${encodeURIComponent(row.file_path)}` : null,
    hash: row.hash,
    hidden: !!row.hidden,
    // origin: undefined → host-local
  }));
}

/** Map edge device song metadata to Song objects with origin info. */
export function mapEdgeSongs(
  songs: EdgeSongMeta[],
  deviceId: string,
  deviceName: string,
  available: boolean,
): Song[] {
  const origin: SongOrigin = { deviceId, deviceName, available };
  return songs.map((s) => ({
    title: s.title,
    artist: s.artist,
    album: s.album,
    duration: s.duration,
    trackNumber: s.trackNumber,
    path: `/api/audio/remote/${deviceId}/${encodeURIComponent(s.localPath)}`,
    art: s.hasArt ? `/api/art/remote/${deviceId}/${encodeURIComponent(s.localPath)}` : null,
    hash: s.hash,
    hidden: false,
    origin,
  }));
}

// --- Deduplication ---

/**
 * Deduplicate a merged song list.
 * - Primary: hash match (prefer host copy, i.e. songs without origin)
 * - Fallback: metadata match (title + artist + |duration difference| < 2s)
 * Returns the deduplicated list.
 */
export function deduplicateSongs(songs: Song[]): Song[] {
  const result: Song[] = [];
  const seenHashes = new Set<string>();
  const seenMeta = new Set<string>();

  for (const song of songs) {
    // Hash-based dedup (skip empty hashes)
    if (song.hash) {
      if (seenHashes.has(song.hash)) continue;
      seenHashes.add(song.hash);
    }

    // Metadata-based dedup (fallback for songs without hash)
    const metaKey = `${song.title.toLowerCase()}|${song.artist.toLowerCase()}|${Math.round(song.duration ?? 0)}`;
    if (!song.hash && seenMeta.has(metaKey)) continue;
    seenMeta.add(metaKey);

    result.push(song);
  }

  return result;
}

// --- Library merging ---

export interface EdgeLibraryEntry {
  deviceId: string;
  deviceName: string;
  songs: EdgeSongMeta[];
}

/**
 * Merge host songs with all edge device libraries into a unified, deduplicated list.
 * Host songs come first (so they win in dedup), followed by each edge device's songs.
 * Songs from offline devices are included but marked as unavailable.
 */
export function mergeLibraries(
  hostSongs: Song[],
  edgeLibraries: Map<string, EdgeLibraryEntry>,
  onlineDevices: Set<string>,
): Song[] {
  // Host songs first — they get priority in dedup
  const all: Song[] = [...hostSongs];

  for (const [deviceId, entry] of edgeLibraries) {
    const available = onlineDevices.has(deviceId);
    const edgeSongs = mapEdgeSongs(entry.songs, deviceId, entry.deviceName, available);
    all.push(...edgeSongs);
  }

  const deduped = deduplicateSongs(all);

  // Sort: artist, album, trackNumber, title (matching host DB ORDER BY)
  deduped.sort((a, b) =>
    a.artist.localeCompare(b.artist)
    || a.album.localeCompare(b.album)
    || a.trackNumber - b.trackNumber
    || a.title.localeCompare(b.title)
  );

  return deduped;
}
