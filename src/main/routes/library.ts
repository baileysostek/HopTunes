import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { parseFile } from 'music-metadata';
import { Song, ServerWsMessage } from '../../shared/types';
import { SongRow } from '../database';
import { getAllSongs, getCachedArtistImage, cacheArtistImage, getCachedAlbumArt, cacheAlbumArt } from '../database';
import { indexLibrary } from '../indexer';
import { MUSIC_DIR } from '../config';

export interface LibraryRouterDeps {
  broadcastToClients: (message: ServerWsMessage) => void;
}

/** Map database rows to Song objects for API responses. */
export function mapSongRows(rows: SongRow[]): Song[] {
  return rows.map((row) => ({
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    trackNumber: row.track_number || 0,
    path: `/api/audio/${encodeURIComponent(row.file_path)}`,
    art: row.has_art ? `/api/art/${encodeURIComponent(row.file_path)}` : null,
  }));
}

/** Validate that a resolved file path is within the music directory. */
function isPathWithinMusicDir(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const musicDir = path.resolve(MUSIC_DIR);
  return resolved.startsWith(musicDir + path.sep) || resolved === musicDir;
}

export function createLibraryRouter(deps: LibraryRouterDeps): Router {
  const router = Router();

  // GET /api/library — all songs from the database
  router.get('/library', async (_req: Request, res: Response) => {
    try {
      const rows = await getAllSongs();
      res.json(mapSongRows(rows));
    } catch (err) {
      console.error('Failed to query library:', err);
      res.status(500).json({ error: 'Failed to load library' });
    }
  });

  // POST /api/reindex — trigger a library re-index
  router.post('/reindex', async (_req: Request, res: Response) => {
    try {
      await indexLibrary(MUSIC_DIR);
      const rows = await getAllSongs();
      deps.broadcastToClients({ type: 'library', data: mapSongRows(rows) });
      res.json({ indexed: rows.length });
    } catch (err) {
      console.error('Failed to reindex:', err);
      res.status(500).json({ error: 'Failed to reindex' });
    }
  });

  // GET /api/artist-image — proxy artist image lookup with caching
  router.get('/artist-image', async (req: Request, res: Response) => {
    const artist = req.query.s as string | undefined;
    if (!artist) {
      res.status(400).json({ error: 'missing ?s= parameter' });
      return;
    }
    try {
      const cached = await getCachedArtistImage(artist);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }
      const url = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(artist)}`;
      const response = await fetch(url);
      const data = await response.json();
      await cacheArtistImage(artist, JSON.stringify(data));
      res.json(data);
    } catch {
      res.status(502).json({ error: 'Failed to fetch artist data' });
    }
  });

  // GET /api/album-art — proxy album art lookup with caching
  router.get('/album-art', async (req: Request, res: Response) => {
    const artist = req.query.artist as string | undefined;
    const album = req.query.album as string | undefined;
    if (!artist || !album) {
      res.status(400).json({ error: 'missing ?artist= and ?album= parameters' });
      return;
    }
    try {
      const cached = await getCachedAlbumArt(artist, album);
      if (cached !== undefined) {
        res.json({ thumb: cached });
        return;
      }
      const url = `https://www.theaudiodb.com/api/v1/json/2/searchalbum.php?s=${encodeURIComponent(artist)}&a=${encodeURIComponent(album)}`;
      const response = await fetch(url);
      const data = await response.json();
      const thumb: string | null = data.album?.[0]?.strAlbumThumb || null;
      await cacheAlbumArt(artist, album, thumb);
      res.json({ thumb });
    } catch {
      res.status(502).json({ error: 'Failed to fetch album art' });
    }
  });

  // GET /api/audio/:file — stream an audio file (with path traversal protection)
  router.get('/audio/:file', (req: Request, res: Response) => {
    const filePath = decodeURIComponent(req.params.file);

    if (!isPathWithinMusicDir(filePath)) {
      res.status(403).json({ error: 'access denied' });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      res.status(404).json({ error: 'file not found' });
      return;
    }

    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
    };
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // GET /api/art/:file — extract embedded album art (with path traversal protection)
  router.get('/art/:file', async (req: Request, res: Response) => {
    const filePath = decodeURIComponent(req.params.file);

    if (!isPathWithinMusicDir(filePath)) {
      res.status(403).json({ error: 'access denied' });
      return;
    }

    try {
      const metadata = await parseFile(filePath);
      const picture = metadata.common.picture?.[0];
      if (picture) {
        res.setHeader('Content-Type', picture.format);
        res.send(picture.data);
      } else {
        res.status(404).send('No artwork');
      }
    } catch {
      res.status(500).send('Failed to extract artwork');
    }
  });

  return router;
}
