import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseFile } from 'music-metadata';
import { upsertSong, getSongModifiedAt, removeDeletedSongs, markDuplicatesHidden } from './database';

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const AUDIO_EXTENSIONS = /\.(mp3|flac|ogg|wav)$/i;

export interface IndexProgress {
  found: number;
  added: number;
  skipped: number;
}

async function walkAndIndex(dir: string, allPaths: Set<string>, stats: { added: number; updated: number; skipped: number }, onProgress?: (progress: IndexProgress) => void): Promise<void> {

  console.log(`[Indexer] Scanning directory: ${dir}`);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    console.log(`[Indexer] Could not read directory: ${dir}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkAndIndex(fullPath, allPaths, stats, onProgress);
    } else if (AUDIO_EXTENSIONS.test(entry.name)) {
      allPaths.add(fullPath);

      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;

      const existingMtime = await getSongModifiedAt(fullPath);
      if (existingMtime !== null && existingMtime === mtime) {
        stats.skipped++;
        onProgress?.({ found: allPaths.size, added: stats.added, skipped: stats.skipped });
        continue; // file hasn't changed, skip
      }

      console.log(`[Indexer] Processing: ${fullPath}`);

      let title = path.basename(entry.name, path.extname(entry.name));
      let artist = 'Unknown Artist';
      let album = 'Unknown Album';
      let duration: number | null = null;
      let hasArt = 0;
      let trackNumber = 0;

      try {
        const metadata = await parseFile(fullPath);
        title = metadata.common.title || title;
        artist = metadata.common.artist || artist;
        album = metadata.common.album || album;
        duration = metadata.format.duration || null;
        hasArt = metadata.common.picture?.length ? 1 : 0;
        trackNumber = metadata.common.track?.no || 0;
      } catch {
        // metadata parsing failed, use defaults
      }

      let hash = '';
      try {
        hash = await hashFile(fullPath);
      } catch {
        // hashing failed, leave empty
      }

      await upsertSong({
        file_path: fullPath,
        title,
        artist,
        album,
        duration,
        has_art: hasArt,
        track_number: trackNumber,
        file_modified_at: mtime,
        hash,
      });

      if (existingMtime === null) {
        stats.added++;
      } else {
        stats.updated++;
      }
      onProgress?.({ found: allPaths.size, added: stats.added, skipped: stats.skipped });
    }
  }
}

export interface SongImportInfo {
  title: string;
  artist: string;
  album: string;
  isNew: boolean;
}

/**
 * Index a single folder with per-song callbacks for detailed import feedback.
 * Unlike indexLibrary, this only indexes the given folder and reports each song individually.
 */
export async function indexSingleFolder(
  dir: string,
  onSong: (song: SongImportInfo) => void,
): Promise<{ added: number; skipped: number }> {
  console.log(`[Indexer] Importing folder: ${dir}`);
  const startTime = Date.now();
  const allPaths = new Set<string>();
  let added = 0;
  let skipped = 0;

  async function walk(d: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (AUDIO_EXTENSIONS.test(entry.name)) {
        allPaths.add(fullPath);

        let title = path.basename(entry.name, path.extname(entry.name));
        let artist = 'Unknown Artist';
        let album = 'Unknown Album';
        let duration: number | null = null;
        let hasArt = 0;
        let trackNumber = 0;

        try {
          const metadata = await parseFile(fullPath);
          title = metadata.common.title || title;
          artist = metadata.common.artist || artist;
          album = metadata.common.album || album;
          duration = metadata.format.duration || null;
          hasArt = metadata.common.picture?.length ? 1 : 0;
          trackNumber = metadata.common.track?.no || 0;
        } catch {
          // metadata parsing failed, use defaults
        }

        const stat = fs.statSync(fullPath);
        const mtime = stat.mtimeMs;
        const existingMtime = await getSongModifiedAt(fullPath);
        const isNew = existingMtime === null;

        if (existingMtime !== null && existingMtime === mtime) {
          skipped++;
          onSong({ title, artist, album, isNew: false });
          continue;
        }

        let hash = '';
        try {
          hash = await hashFile(fullPath);
        } catch {
          // hashing failed, leave empty
        }

        await upsertSong({
          file_path: fullPath,
          title,
          artist,
          album,
          duration,
          has_art: hasArt,
          track_number: trackNumber,
          file_modified_at: mtime,
          hash,
        });

        if (isNew) {
          added++;
        } else {
          // updated — still report as not new
        }
        onSong({ title, artist, album, isNew });
      }
    }
  }

  await walk(dir);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Indexer] Folder import complete in ${elapsed}s: ${added} added, ${skipped} skipped`);
  return { added, skipped };
}

export async function indexLibrary(musicDirs: string[], onProgress?: (progress: IndexProgress) => void): Promise<void> {
  console.log(`Indexing library: ${musicDirs.join(', ')}`);
  const startTime = Date.now();

  const allPaths = new Set<string>();
  const stats = { added: 0, updated: 0, skipped: 0 };

  for (const dir of musicDirs) {
    await walkAndIndex(dir, allPaths, stats, onProgress);
  }

  const removed = await removeDeletedSongs(allPaths);
  const hidden = await markDuplicatesHidden();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Indexing complete in ${elapsed}s: ${stats.added} added, ${stats.updated} updated, ${removed} removed, ${hidden} duplicates hidden`);
}
