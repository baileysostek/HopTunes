// Shared database schema, SQL constants, and adapter interface.
// Used by both the host (sqlite3 on Node.js) and edge (capacitor-community/sqlite on Android).

// --- Shared row type ---

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

// --- SQL constants ---

export const CREATE_SONGS_TABLE = `
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
`;

export const CREATE_SONGS_FILE_PATH_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_songs_file_path ON songs(file_path)';

export const CREATE_SONGS_HASH_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_songs_hash ON songs(hash)';

export const CREATE_MEDIA_LOCATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS media_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL
  )
`;

export const UPSERT_SONG_SQL = `
  INSERT INTO songs (file_path, title, artist, album, duration, has_art, file_modified_at, track_number, hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(file_path) DO UPDATE SET
    title = excluded.title,
    artist = excluded.artist,
    album = excluded.album,
    duration = excluded.duration,
    has_art = excluded.has_art,
    file_modified_at = excluded.file_modified_at,
    track_number = excluded.track_number,
    hash = excluded.hash
`;

export const GET_ALL_SONGS_SQL =
  'SELECT * FROM songs WHERE hidden = 0 ORDER BY artist, album, track_number, title';

export const GET_ALL_SONGS_INCLUDING_HIDDEN_SQL =
  'SELECT * FROM songs ORDER BY artist, album, track_number, title';

export const RESET_HIDDEN_SQL = 'UPDATE songs SET hidden = 0';

export const MARK_DUPLICATES_HIDDEN_SQL = `
  UPDATE songs SET hidden = 1
  WHERE hash != ''
    AND id NOT IN (
      SELECT MIN(id) FROM songs WHERE hash != '' GROUP BY hash
    )
`;

export const HIDE_SONG_BY_PATH_SQL = 'UPDATE songs SET hidden = 1 WHERE file_path = ?';

export const SET_SONG_HIDDEN_SQL = 'UPDATE songs SET hidden = ? WHERE file_path = ?';

export const GET_ALBUM_SONGS_SQL =
  'SELECT * FROM songs WHERE artist = ? AND album = ? ORDER BY track_number, title';

export const GET_SONG_MODIFIED_AT_SQL =
  'SELECT file_modified_at FROM songs WHERE file_path = ?';

export const GET_ALL_FILE_PATHS_SQL = 'SELECT file_path FROM songs';

export const DELETE_SONG_BY_PATH_SQL = 'DELETE FROM songs WHERE file_path = ?';

export const GET_MEDIA_LOCATIONS_SQL = 'SELECT path FROM media_locations ORDER BY id';

export const ADD_MEDIA_LOCATION_SQL = 'INSERT OR IGNORE INTO media_locations (path) VALUES (?)';

export const DELETE_MEDIA_LOCATION_SQL = 'DELETE FROM media_locations WHERE path = ?';

// --- Abstract adapter interface ---

export interface DatabaseAdapter {
  upsertSong(song: Omit<SongRow, 'id' | 'hidden'>): Promise<void>;
  getAllSongs(includeHidden?: boolean): Promise<SongRow[]>;
  markDuplicatesHidden(): Promise<number>;
  hideSongByPath(filePath: string): Promise<void>;
  setSongHidden(filePath: string, hidden: boolean): Promise<void>;
  getAlbumSongs(artist: string, album: string): Promise<SongRow[]>;
  getSongModifiedAt(filePath: string): Promise<number | null>;
  removeDeletedSongs(existingPaths: Set<string>): Promise<number>;
  getMediaLocations(): Promise<string[]>;
  addMediaLocation(path: string): Promise<void>;
  removeMediaLocation(locationPath: string): Promise<void>;
}
