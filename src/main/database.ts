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
}

function run(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db!.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
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
            file_modified_at INTEGER NOT NULL
          )
        `);
        await run(`CREATE INDEX IF NOT EXISTS idx_songs_file_path ON songs(file_path)`);
        // Migration: add track_number column if it doesn't exist
        try {
          await run(`ALTER TABLE songs ADD COLUMN track_number INTEGER DEFAULT 0`);
        } catch {
          // Column already exists
        }
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
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function upsertSong(song: Omit<SongRow, 'id'>): Promise<void> {
  await run(
    `INSERT INTO songs (file_path, title, artist, album, duration, has_art, file_modified_at, track_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       title = excluded.title,
       artist = excluded.artist,
       album = excluded.album,
       duration = excluded.duration,
       has_art = excluded.has_art,
       file_modified_at = excluded.file_modified_at,
       track_number = excluded.track_number`,
    [song.file_path, song.title, song.artist, song.album, song.duration, song.has_art, song.file_modified_at, song.track_number]
  );
}

export async function getAllSongs(): Promise<SongRow[]> {
  return all<SongRow>('SELECT * FROM songs ORDER BY artist, album, track_number, title');
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
