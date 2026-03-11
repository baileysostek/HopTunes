import fs from 'fs';
import path from 'path';
import { parseFile } from 'music-metadata';
import { upsertSong, getSongModifiedAt, removeDeletedSongs } from './database';

const AUDIO_EXTENSIONS = /\.(mp3|flac|ogg|wav)$/i;

async function walkAndIndex(dir: string, allPaths: Set<string>): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { added, updated };
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const sub = await walkAndIndex(fullPath, allPaths);
      added += sub.added;
      updated += sub.updated;
    } else if (AUDIO_EXTENSIONS.test(entry.name)) {
      allPaths.add(fullPath);

      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;

      const existingMtime = await getSongModifiedAt(fullPath);
      if (existingMtime !== null && existingMtime === mtime) {
        continue; // file hasn't changed, skip
      }

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

      await upsertSong({
        file_path: fullPath,
        title,
        artist,
        album,
        duration,
        has_art: hasArt,
        track_number: trackNumber,
        file_modified_at: mtime,
      });

      if (existingMtime === null) {
        added++;
      } else {
        updated++;
      }
    }
  }

  return { added, updated };
}

export async function indexLibrary(musicDir: string): Promise<void> {
  console.log(`Indexing library: ${musicDir}`);
  const startTime = Date.now();

  const allPaths = new Set<string>();
  const { added, updated } = await walkAndIndex(musicDir, allPaths);
  const removed = await removeDeletedSongs(allPaths);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Indexing complete in ${elapsed}s: ${added} added, ${updated} updated, ${removed} removed`);
}
