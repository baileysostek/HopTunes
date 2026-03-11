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

async function walkAndIndex(dir: string, allPaths: Set<string>, onProgress?: (found: number) => void): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  console.log(`[Indexer] Scanning directory: ${dir}`);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    console.log(`[Indexer] Could not read directory: ${dir}`);
    return { added, updated };
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const sub = await walkAndIndex(fullPath, allPaths, onProgress);
      added += sub.added;
      updated += sub.updated;
    } else if (AUDIO_EXTENSIONS.test(entry.name)) {
      allPaths.add(fullPath);
      onProgress?.(allPaths.size);

      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;

      const existingMtime = await getSongModifiedAt(fullPath);
      if (existingMtime !== null && existingMtime === mtime) {
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
        added++;
      } else {
        updated++;
      }
    }
  }

  return { added, updated };
}

export async function indexLibrary(musicDirs: string[], onProgress?: (found: number) => void): Promise<void> {
  console.log(`Indexing library: ${musicDirs.join(', ')}`);
  const startTime = Date.now();

  const allPaths = new Set<string>();
  let totalAdded = 0;
  let totalUpdated = 0;

  for (const dir of musicDirs) {
    const { added, updated } = await walkAndIndex(dir, allPaths, onProgress);
    totalAdded += added;
    totalUpdated += updated;
  }

  const removed = await removeDeletedSongs(allPaths);
  const hidden = await markDuplicatesHidden();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Indexing complete in ${elapsed}s: ${totalAdded} added, ${totalUpdated} updated, ${removed} removed, ${hidden} duplicates hidden`);
}
