import sqlite3 from 'sqlite3';
import path from 'path';
import { app } from 'electron';

let db: sqlite3.Database | null = null;

export interface SongRow {
  id: number;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  has_art: number;
  track_number: number;
  file_modified_at: number;
  hash: string;
  hidden: number; // SQLite stores booleans as 0/1
}

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
        await run(`
          CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            duration REAL,
            has_art INTEGER NOT NULL DEFAULT 0,
            file_modified_at INTEGER NOT NULL,
            track_number INTEGER DEFAULT 0,
            hash TEXT NOT NULL DEFAULT '',
            hidden INTEGER NOT NULL DEFAULT 0
          )
        `);
        await run(`CREATE INDEX IF NOT EXISTS idx_songs_file_path ON songs(file_path)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_songs_hash ON songs(hash)`);
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
        await run(`
          CREATE TABLE IF NOT EXISTS media_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL
          )
        `);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function upsertSong(song: Omit<SongRow, 'id' | 'hidden'>): Promise<void> {
  await run(
    `INSERT INTO songs (file_path, title, artist, album, duration, has_art, file_modified_at, track_number, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       title = excluded.title,
       artist = excluded.artist,
       album = excluded.album,
       duration = excluded.duration,
       has_art = excluded.has_art,
       file_modified_at = excluded.file_modified_at,
       track_number = excluded.track_number,
       hash = excluded.hash`,
    [song.file_path, song.title, song.artist, song.album, song.duration, song.has_art, song.file_modified_at, song.track_number, song.hash]
  );
}

export async function getAllSongs(includeHidden = false): Promise<SongRow[]> {
  const where = includeHidden ? '' : 'WHERE hidden = 0';
  return all<SongRow>(`SELECT * FROM songs ${where} ORDER BY artist, album, track_number, title`);
}

/**
 * For each group of songs sharing the same hash, keep the one with the
 * lowest id visible and mark the rest as hidden.  Songs with an empty
 * hash are never hidden (we can't determine duplicates without a hash).
 */
export async function markDuplicatesHidden(): Promise<number> {
  // First, reset all songs to visible
  await run('UPDATE songs SET hidden = 0');
  // Then hide duplicates: any song whose hash is non-empty and whose id
  // is NOT the minimum id for that hash
  const result = await runWithChanges(
    `UPDATE songs SET hidden = 1
     WHERE hash != ''
       AND id NOT IN (
         SELECT MIN(id) FROM songs WHERE hash != '' GROUP BY hash
       )`
  );
  return result.changes;
}

export async function hideSongByPath(filePath: string): Promise<void> {
  await run('UPDATE songs SET hidden = 1 WHERE file_path = ?', [filePath]);
}

export async function setSongHidden(filePath: string, hidden: boolean): Promise<void> {
  await run('UPDATE songs SET hidden = ? WHERE file_path = ?', [hidden ? 1 : 0, filePath]);
}

export async function getAlbumSongs(artist: string, album: string): Promise<SongRow[]> {
  return all<SongRow>(
    'SELECT * FROM songs WHERE artist = ? AND album = ? ORDER BY track_number, title',
    [artist, album]
  );
}

export async function getSongModifiedAt(filePath: string): Promise<number | null> {
  const rows = await all<{ file_modified_at: number }>(
    'SELECT file_modified_at FROM songs WHERE file_path = ?',
    [filePath]
  );
  return rows.length > 0 ? rows[0].file_modified_at : null;
}

// --- Artist image cache ---

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

// --- Album art cache (permanent, no TTL) ---

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
  const rows = await all<{ path: string }>('SELECT path FROM media_locations ORDER BY id');
  return rows.map(r => r.path);
}

export async function addMediaLocation(locationPath: string): Promise<void> {
  await run(
    'INSERT OR IGNORE INTO media_locations (path) VALUES (?)',
    [locationPath]
  );
}

export async function removeMediaLocation(locationPath: string): Promise<void> {
  await run('DELETE FROM media_locations WHERE path = ?', [locationPath]);
  // Remove all songs whose file path falls under the removed directory
  const prefix = locationPath.endsWith('/') || locationPath.endsWith('\\') ? locationPath : locationPath + path.sep;
  await run('DELETE FROM songs WHERE file_path LIKE ? ESCAPE ?', [
    prefix.replace(/[%_\\]/g, '\\$&') + '%',
    '\\',
  ]);
}

export async function removeDeletedSongs(existingPaths: Set<string>): Promise<number> {
  const allSongs = await all<{ file_path: string }>('SELECT file_path FROM songs');
  let removed = 0;
  for (const song of allSongs) {
    if (!existingPaths.has(song.file_path)) {
      await run('DELETE FROM songs WHERE file_path = ?', [song.file_path]);
      removed++;
    }
  }
  return removed;
}
