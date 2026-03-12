// DatabaseAdapter implementation for edge devices using @capacitor-community/sqlite.
// Provides the same interface as the host's sqlite3-based database, allowing
// shared code to work transparently on both platforms.

import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import {
  SongRow,
  DatabaseAdapter,
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
} from '../../shared/db-schema';

const DB_NAME = 'opentunes_edge';

let connection: SQLiteDBConnection | null = null;

async function getDb(): Promise<SQLiteDBConnection> {
  if (connection) return connection;

  const sqlite = new SQLiteConnection(CapacitorSQLite);

  // Check if connection exists, create if not
  const ret = await sqlite.checkConnectionsConsistency();
  const isConn = (await sqlite.isConnection(DB_NAME, false)).result;

  if (ret.result && isConn) {
    connection = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    connection = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  }

  await connection.open();

  // Create tables
  await connection.execute(CREATE_SONGS_TABLE);
  await connection.execute(CREATE_SONGS_FILE_PATH_INDEX);
  await connection.execute(CREATE_SONGS_HASH_INDEX);
  await connection.execute(CREATE_MEDIA_LOCATIONS_TABLE);

  return connection;
}

// Helper to run a query and return typed rows
async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  const result = await db.query(sql, params as any[]);
  return (result.values || []) as T[];
}

// Helper to execute a statement (no return values)
async function execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  const db = await getDb();
  const result = await db.run(sql, params as any[]);
  return { changes: result.changes?.changes || 0 };
}

export const edgeDatabase: DatabaseAdapter = {
  async upsertSong(song: Omit<SongRow, 'id' | 'hidden'>): Promise<void> {
    await execute(UPSERT_SONG_SQL, [
      song.file_path, song.title, song.artist, song.album,
      song.duration, song.has_art, song.file_modified_at, song.track_number, song.hash,
    ]);
  },

  async getAllSongs(includeHidden = false): Promise<SongRow[]> {
    return query<SongRow>(includeHidden ? GET_ALL_SONGS_INCLUDING_HIDDEN_SQL : GET_ALL_SONGS_SQL);
  },

  async markDuplicatesHidden(): Promise<number> {
    await execute(RESET_HIDDEN_SQL);
    const result = await execute(MARK_DUPLICATES_HIDDEN_SQL);
    return result.changes;
  },

  async hideSongByPath(filePath: string): Promise<void> {
    await execute(HIDE_SONG_BY_PATH_SQL, [filePath]);
  },

  async setSongHidden(filePath: string, hidden: boolean): Promise<void> {
    await execute(SET_SONG_HIDDEN_SQL, [hidden ? 1 : 0, filePath]);
  },

  async getAlbumSongs(artist: string, album: string): Promise<SongRow[]> {
    return query<SongRow>(GET_ALBUM_SONGS_SQL, [artist, album]);
  },

  async getSongModifiedAt(filePath: string): Promise<number | null> {
    const rows = await query<{ file_modified_at: number }>(GET_SONG_MODIFIED_AT_SQL, [filePath]);
    return rows.length > 0 ? rows[0].file_modified_at : null;
  },

  async removeDeletedSongs(existingPaths: Set<string>): Promise<number> {
    const allSongs = await query<{ file_path: string }>(GET_ALL_FILE_PATHS_SQL);
    let removed = 0;
    for (const song of allSongs) {
      if (!existingPaths.has(song.file_path)) {
        await execute(DELETE_SONG_BY_PATH_SQL, [song.file_path]);
        removed++;
      }
    }
    return removed;
  },

  async getMediaLocations(): Promise<string[]> {
    const rows = await query<{ path: string }>(GET_MEDIA_LOCATIONS_SQL);
    return rows.map(r => r.path);
  },

  async addMediaLocation(locationPath: string): Promise<void> {
    await execute(ADD_MEDIA_LOCATION_SQL, [locationPath]);
  },

  async removeMediaLocation(locationPath: string): Promise<void> {
    await execute(DELETE_MEDIA_LOCATION_SQL, [locationPath]);
  },
};

/** Initialize the edge database. Call once on app startup (Capacitor only). */
export async function initEdgeDatabase(): Promise<void> {
  await getDb();
}
