import sqlite3 from 'sqlite3';
import path from 'path';
import { app } from 'electron';
import {
  SongRow,
  CREATE_SONGS_TABLE,
  CREATE_SONGS_FILE_PATH_INDEX,
  CREATE_SONGS_HASH_INDEX,
  CREATE_MEDIA_LOCATIONS_TABLE,
  UPSERT_SONG_SQL,
  GET_ALL_SONGS_SQL,
  GET_ALL_SONGS_INCLUDING_HIDDEN_SQL,
  RESET_HIDDEN_SQL,
  MARK_DUPLICATES_HIDDEN_SQL,
  HIDE_SONG_BY_PATH_SQL,
  SET_SONG_HIDDEN_SQL,
  GET_ALBUM_SONGS_SQL,
  GET_SONG_MODIFIED_AT_SQL,
  GET_ALL_FILE_PATHS_SQL,
  DELETE_SONG_BY_PATH_SQL,
  GET_MEDIA_LOCATIONS_SQL,
  ADD_MEDIA_LOCATION_SQL,
  DELETE_MEDIA_LOCATION_SQL,
  CREATE_HIDDEN_EDGE_SONGS_TABLE,
  HIDE_EDGE_SONG_SQL,
  UNHIDE_EDGE_SONG_SQL,
  GET_HIDDEN_EDGE_HASHES_SQL,
  DELETE_HIDDEN_EDGE_HASHES_SQL,
} from '../shared/db-schema';

// Re-export SongRow so existing imports from './database' still work
export type { SongRow } from '../shared/db-schema';

let db: sqlite3.Database | null = null;

function run(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db!.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function runWithChanges(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  return new Promise((resolve, reject) => {
    db!.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db!.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export async function initDatabase(): Promise<void> {
  const dbPath = path.join(app.getPath('userData'), 'library.db');
  console.log('Opening database at:', dbPath);

  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        await run(CREATE_SONGS_TABLE);
        await run(CREATE_SONGS_FILE_PATH_INDEX);
        await run(CREATE_SONGS_HASH_INDEX);
        await run(`
          CREATE TABLE IF NOT EXISTS artist_images (
            artist TEXT PRIMARY KEY NOT NULL,
            data TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
          )
        `);
        await run(`
          CREATE TABLE IF NOT EXISTS album_art (
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            thumb_url TEXT,
            PRIMARY KEY (artist, album)
          )
        `);
        await run(CREATE_MEDIA_LOCATIONS_TABLE);
        await run(CREATE_HIDDEN_EDGE_SONGS_TABLE);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function upsertSong(song: Omit<SongRow, 'id' | 'hidden'>): Promise<void> {
  await run(UPSERT_SONG_SQL, [
    song.file_path, song.title, song.artist, song.album,
    song.duration, song.has_art, song.file_modified_at, song.track_number, song.hash,
  ]);
}

export async function getAllSongs(includeHidden = false): Promise<SongRow[]> {
  return all<SongRow>(includeHidden ? GET_ALL_SONGS_INCLUDING_HIDDEN_SQL : GET_ALL_SONGS_SQL);
}

/**
 * For each group of songs sharing the same hash, keep the one with the
 * lowest id visible and mark the rest as hidden.  Songs with an empty
 * hash are never hidden (we can't determine duplicates without a hash).
 */
export async function markDuplicatesHidden(): Promise<number> {
  await run(RESET_HIDDEN_SQL);
  const result = await runWithChanges(MARK_DUPLICATES_HIDDEN_SQL);
  return result.changes;
}

export async function hideSongByPath(filePath: string): Promise<void> {
  await run(HIDE_SONG_BY_PATH_SQL, [filePath]);
}

export async function setSongHidden(filePath: string, hidden: boolean): Promise<void> {
  await run(SET_SONG_HIDDEN_SQL, [hidden ? 1 : 0, filePath]);
}

// --- Hidden edge songs ---

export async function hideEdgeSongByHash(hash: string): Promise<void> {
  await run(HIDE_EDGE_SONG_SQL, [hash]);
}

export async function unhideEdgeSongByHash(hash: string): Promise<void> {
  await run(UNHIDE_EDGE_SONG_SQL, [hash]);
}

export async function getHiddenEdgeHashes(): Promise<Set<string>> {
  const rows = await all<{ hash: string }>(GET_HIDDEN_EDGE_HASHES_SQL);
  return new Set(rows.map(r => r.hash));
}

export async function removeHiddenEdgeHashes(hashes: string[]): Promise<void> {
  if (hashes.length === 0) return;
  const placeholders = hashes.map(() => '?').join(',');
  await run(`${DELETE_HIDDEN_EDGE_HASHES_SQL}(${placeholders})`, hashes);
}

export async function getAlbumSongs(artist: string, album: string): Promise<SongRow[]> {
  return all<SongRow>(GET_ALBUM_SONGS_SQL, [artist, album]);
}

/**
 * Find a host song with embedded art for the given artist+album.
 * Returns the file_path of the first matching song, or null.
 */
export async function findSongWithArtForAlbum(artist: string, album: string): Promise<string | null> {
  const rows = await all<{ file_path: string }>(
    'SELECT file_path FROM songs WHERE artist = ? AND album = ? AND has_art = 1 AND hidden = 0 LIMIT 1',
    [artist, album]
  );
  return rows.length > 0 ? rows[0].file_path : null;
}

export async function getSongModifiedAt(filePath: string): Promise<number | null> {
  const rows = await all<{ file_modified_at: number }>(GET_SONG_MODIFIED_AT_SQL, [filePath]);
  return rows.length > 0 ? rows[0].file_modified_at : null;
}

// --- Artist image cache (host-only) ---

const ARTIST_IMAGE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function getCachedArtistImage(artist: string): Promise<string | null> {
  const rows = await all<{ data: string; fetched_at: number }>(
    'SELECT data, fetched_at FROM artist_images WHERE artist = ?',
    [artist]
  );
  if (rows.length === 0) return null;
  if (Date.now() - rows[0].fetched_at > ARTIST_IMAGE_TTL) return null;
  return rows[0].data;
}

export async function cacheArtistImage(artist: string, data: string): Promise<void> {
  await run(
    `INSERT INTO artist_images (artist, data, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(artist) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
    [artist, data, Date.now()]
  );
}

// --- Album art cache (host-only, permanent, no TTL) ---

export async function getCachedAlbumArt(artist: string, album: string): Promise<string | null | undefined> {
  const rows = await all<{ thumb_url: string | null }>(
    'SELECT thumb_url FROM album_art WHERE artist = ? AND album = ?',
    [artist, album]
  );
  if (rows.length === 0) return undefined; // not cached yet
  return rows[0].thumb_url; // null means "looked up but no art found"
}

export async function cacheAlbumArt(artist: string, album: string, thumbUrl: string | null): Promise<void> {
  await run(
    `INSERT INTO album_art (artist, album, thumb_url) VALUES (?, ?, ?)
     ON CONFLICT(artist, album) DO UPDATE SET thumb_url = excluded.thumb_url`,
    [artist, album, thumbUrl]
  );
}

// --- Media locations ---

export async function getMediaLocations(): Promise<string[]> {
  const rows = await all<{ path: string }>(GET_MEDIA_LOCATIONS_SQL);
  return rows.map(r => r.path);
}

export async function addMediaLocation(locationPath: string): Promise<void> {
  await run(ADD_MEDIA_LOCATION_SQL, [locationPath]);
}

export async function removeMediaLocation(locationPath: string): Promise<void> {
  await run(DELETE_MEDIA_LOCATION_SQL, [locationPath]);
  // Remove all songs whose file path falls under the removed directory
  const prefix = locationPath.endsWith('/') || locationPath.endsWith('\\') ? locationPath : locationPath + path.sep;
  await run('DELETE FROM songs WHERE file_path LIKE ? ESCAPE ?', [
    prefix.replace(/[%_\\]/g, '\\$&') + '%',
    '\\',
  ]);
}

export async function removeDeletedSongs(existingPaths: Set<string>): Promise<number> {
  const allSongs = await all<{ file_path: string }>(GET_ALL_FILE_PATHS_SQL);
  let removed = 0;
  for (const song of allSongs) {
    if (!existingPaths.has(song.file_path)) {
      await run(DELETE_SONG_BY_PATH_SQL, [song.file_path]);
      removed++;
    }
  }
  return removed;
}
