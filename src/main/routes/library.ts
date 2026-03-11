import { Router, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseFile } from 'music-metadata';
import { Song, ServerWsMessage, AUDIO_PATH_PREFIX } from '../../shared/types';
import { SongRow } from '../database';
import { getAllSongs, hideSongByPath, setSongHidden, getAlbumSongs, getCachedArtistImage, cacheArtistImage, getCachedAlbumArt, cacheAlbumArt, getMediaLocations, addMediaLocation, removeMediaLocation } from '../database';
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
    path: `${AUDIO_PATH_PREFIX}${encodeURIComponent(row.file_path)}`,
    art: row.has_art ? `/api/art/${encodeURIComponent(row.file_path)}` : null,
    hash: row.hash || '',
    hidden: row.hidden === 1,
  }));
}

/** Validate that a resolved file path is within any registered media location. */
async function isPathWithinMediaLocations(filePath: string): Promise<boolean> {
  const resolved = path.resolve(filePath);
  const locations = await getMediaLocations();
  // Fall back to default MUSIC_DIR if no locations are configured
  const dirs = locations.length > 0 ? locations : [MUSIC_DIR];
  return dirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
  });
}

/** Get the list of directories to index (media locations or default MUSIC_DIR). */
async function getIndexDirs(): Promise<string[]> {
  const locations = await getMediaLocations();
  return locations.length > 0 ? locations : [MUSIC_DIR];
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

  // POST /api/library/hide — hide a song by its file path
  router.post('/library/hide', async (req: Request, res: Response) => {
    const { path: songPath } = req.body;
    if (!songPath || typeof songPath !== 'string') {
      res.status(400).json({ error: 'missing path' });
      return;
    }
    try {
      await hideSongByPath(songPath);
      const rows = await getAllSongs();
      const songs = mapSongRows(rows);
      deps.broadcastToClients({ type: 'library', data: songs });
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to hide song:', err);
      res.status(500).json({ error: 'Failed to hide song' });
    }
  });

  // GET /api/library/album-songs — all songs (including hidden) for a given artist+album
  router.get('/library/album-songs', async (req: Request, res: Response) => {
    const artist = req.query.artist as string | undefined;
    const album = req.query.album as string | undefined;
    if (!artist || !album) {
      res.status(400).json({ error: 'missing ?artist= and ?album= parameters' });
      return;
    }
    try {
      const rows = await getAlbumSongs(artist, album);
      res.json(mapSongRows(rows));
    } catch (err) {
      console.error('Failed to get album songs:', err);
      res.status(500).json({ error: 'Failed to get album songs' });
    }
  });

  // POST /api/library/set-hidden — batch update hidden state for songs
  router.post('/library/set-hidden', async (req: Request, res: Response) => {
    const { songs } = req.body as { songs?: { path: string; hidden: boolean }[] };
    if (!Array.isArray(songs)) {
      res.status(400).json({ error: 'missing songs array' });
      return;
    }
    try {
      for (const { path: songPath, hidden } of songs) {
        const diskPath = decodeURIComponent(songPath.replace(AUDIO_PATH_PREFIX, ''));
        await setSongHidden(diskPath, hidden);
      }
      const rows = await getAllSongs();
      const mapped = mapSongRows(rows);
      deps.broadcastToClients({ type: 'library', data: mapped });
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to set hidden state:', err);
      res.status(500).json({ error: 'Failed to update songs' });
    }
  });

  // POST /api/reindex — trigger a library re-index
  router.post('/reindex', async (_req: Request, res: Response) => {
    try {
      const dirs = await getIndexDirs();
      await indexLibrary(dirs, (found) => {
        deps.broadcastToClients({ type: 'reindex-progress', found });
      });
      const rows = await getAllSongs();
      deps.broadcastToClients({ type: 'library', data: mapSongRows(rows) });
      res.json({ indexed: rows.length });
    } catch (err) {
      console.error('Failed to reindex:', err);
      res.status(500).json({ error: 'Failed to reindex' });
    }
  });

  // GET /api/library/locations — list media locations
  router.get('/library/locations', async (_req: Request, res: Response) => {
    try {
      const locations = await getMediaLocations();
      res.json({ locations, serverName: os.hostname() });
    } catch (err) {
      console.error('Failed to get media locations:', err);
      res.status(500).json({ error: 'Failed to get media locations' });
    }
  });

  // POST /api/library/locations — add a media location, then reindex
  router.post('/library/locations', async (req: Request, res: Response) => {
    const { path: locationPath } = req.body;
    if (!locationPath || typeof locationPath !== 'string') {
      res.status(400).json({ error: 'missing path' });
      return;
    }
    try {
      await addMediaLocation(locationPath);
      const dirs = await getIndexDirs();
      // Reindex in background so the response is fast
      indexLibrary(dirs, (found) => {
        deps.broadcastToClients({ type: 'reindex-progress', found });
      }).then(async () => {
        const rows = await getAllSongs();
        deps.broadcastToClients({ type: 'library', data: mapSongRows(rows) });
      }).catch(err => console.error('Reindex after add failed:', err));
      const locations = await getMediaLocations();
      res.json(locations);
    } catch (err) {
      console.error('Failed to add media location:', err);
      res.status(500).json({ error: 'Failed to add media location' });
    }
  });

  // DELETE /api/library/locations — remove a media location, then reindex
  router.delete('/library/locations', async (req: Request, res: Response) => {
    const { path: locationPath } = req.body;
    if (!locationPath || typeof locationPath !== 'string') {
      res.status(400).json({ error: 'missing path' });
      return;
    }
    try {
      // removeMediaLocation also deletes songs under that directory
      await removeMediaLocation(locationPath);
      // Broadcast the updated library immediately
      const rows = await getAllSongs();
      deps.broadcastToClients({ type: 'library', data: mapSongRows(rows) });
      const locations = await getMediaLocations();
      res.json(locations);
    } catch (err) {
      console.error('Failed to remove media location:', err);
      res.status(500).json({ error: 'Failed to remove media location' });
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
  router.get('/audio/:file', async (req: Request, res: Response) => {
    const filePath = decodeURIComponent(req.params.file);

    if (!await isPathWithinMediaLocations(filePath)) {
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

    if (!await isPathWithinMediaLocations(filePath)) {
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
