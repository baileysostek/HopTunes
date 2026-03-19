import { Router, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { parseFile } from 'music-metadata';
import { ServerWsMessage, AUDIO_PATH_PREFIX } from '../../shared/types';
import { mapHostSongRows } from '../../shared/federation';
import { getAllSongs, hideSongByPath, hideEdgeSongByHash, setSongHidden, getAlbumSongs, getCachedArtistImage, cacheArtistImage, getCachedAlbumArt, cacheAlbumArt, getMediaLocations, addMediaLocation, removeMediaLocation, findSongWithArtForAlbum } from '../database';
import { indexLibrary, indexSingleFolder } from '../indexer';
import { MUSIC_DIR } from '../config';
import { isLocalAddress } from '../auth';
import {
  getUnifiedLibrary,
  streamAudioFromEdge,
  requestArtFromEdge,
  getAudioCachePath,
  isEdgeDeviceOnline,
  getConnectedEdgeDevices,
  findEdgeSongWithArtForAlbum,
} from '../federation';

// --- Persistent art cache on disk ---
const ART_CACHE_DIR = path.join(app.getPath('userData'), 'art-cache');
fs.mkdirSync(ART_CACHE_DIR, { recursive: true });

/** Get the cache path for a given art source key (file path or device+path). */
function getArtCachePath(key: string): string {
  const safeName = Buffer.from(key).toString('base64url');
  return path.join(ART_CACHE_DIR, safeName);
}

/** Try to serve art from the disk cache. Returns true if served. */
function serveArtFromCache(key: string, res: Response): boolean {
  const cachePath = getArtCachePath(key);
  if (!fs.existsSync(cachePath)) return false;
  try {
    const data = fs.readFileSync(cachePath);
    // Detect image type from magic bytes
    const isJpeg = data[0] === 0xFF && data[1] === 0xD8;
    const isPng = data[0] === 0x89 && data[1] === 0x50;
    const contentType = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(data);
    return true;
  } catch {
    return false;
  }
}

/** Write art data to the disk cache (fire-and-forget). */
function cacheArtToDisk(key: string, data: Buffer | Uint8Array): void {
  try {
    const cachePath = getArtCachePath(key);
    fs.writeFileSync(cachePath, data);
  } catch {
    // Caching is best-effort
  }
}

export interface LibraryRouterDeps {
  broadcastToClients: (message: ServerWsMessage) => void;
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

  // GET /api/library — unified library (host + edge devices, deduplicated)
  router.get('/library', async (_req: Request, res: Response) => {
    try {
      const library = await getUnifiedLibrary();
      res.json(library);
    } catch (err) {
      console.error('Failed to query library:', err);
      res.status(500).json({ error: 'Failed to load library' });
    }
  });

  // POST /api/library/hide — hide a song by file path (host) or hash (edge)
  router.post('/library/hide', async (req: Request, res: Response) => {
    const { path: songPath, hash } = req.body;
    if ((!songPath || typeof songPath !== 'string') && (!hash || typeof hash !== 'string')) {
      res.status(400).json({ error: 'missing path or hash' });
      return;
    }
    try {
      if (hash) {
        await hideEdgeSongByHash(hash);
      } else {
        await hideSongByPath(songPath);
      }
      const library = await getUnifiedLibrary();
      deps.broadcastToClients({ type: 'library', data: library });
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
      res.json(mapHostSongRows(rows));
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
      const library = await getUnifiedLibrary();
      deps.broadcastToClients({ type: 'library', data: library });
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
      await indexLibrary(dirs, ({ found, added, skipped }) => {
        deps.broadcastToClients({ type: 'reindex-progress', found, added, skipped });
      });
      const library = await getUnifiedLibrary();
      deps.broadcastToClients({ type: 'library', data: library });
      res.json({ indexed: library.length });
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

  // POST /api/library/locations — add a media location, then reindex (localhost only)
  router.post('/library/locations', async (req: Request, res: Response) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const { path: locationPath } = req.body;
    if (!locationPath || typeof locationPath !== 'string') {
      res.status(400).json({ error: 'missing path' });
      return;
    }
    try {
      const resolvedDrop = path.resolve(locationPath);
      const existingLocations = await getMediaLocations();

      // Check if this path is already within an existing library location
      const isSubdirectory = existingLocations.some(loc => {
        const resolvedLoc = path.resolve(loc);
        return resolvedDrop.startsWith(resolvedLoc + path.sep) || resolvedDrop === resolvedLoc;
      });

      if (!isSubdirectory) {
        await addMediaLocation(locationPath);
      }

      const folderName = path.basename(locationPath);
      // Index the folder in background with per-song progress
      indexSingleFolder(locationPath, (song) => {
        deps.broadcastToClients({ type: 'folder-import-song', ...song });
      }).then(async ({ added, skipped }) => {
        deps.broadcastToClients({ type: 'folder-import-done', folderName, added, skipped });
        const library = await getUnifiedLibrary();
        deps.broadcastToClients({ type: 'library', data: library });
      }).catch(err => console.error('Folder import failed:', err));
      const locations = await getMediaLocations();
      res.json(locations);
    } catch (err) {
      console.error('Failed to add media location:', err);
      res.status(500).json({ error: 'Failed to add media location' });
    }
  });

  // DELETE /api/library/locations — remove a media location, then reindex (localhost only)
  router.delete('/library/locations', async (req: Request, res: Response) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const { path: locationPath } = req.body;
    if (!locationPath || typeof locationPath !== 'string') {
      res.status(400).json({ error: 'missing path' });
      return;
    }
    try {
      // removeMediaLocation also deletes songs under that directory
      await removeMediaLocation(locationPath);
      // Broadcast the updated library immediately
      const library = await getUnifiedLibrary();
      deps.broadcastToClients({ type: 'library', data: library });
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

  // GET /api/album-art — album art lookup
  // Resolution order: SQLite cache → host library → edge devices → TheAudioDB (last resort)
  router.get('/album-art', async (req: Request, res: Response) => {
    const artist = req.query.artist as string | undefined;
    const album = req.query.album as string | undefined;
    if (!artist || !album) {
      res.status(400).json({ error: 'missing ?artist= and ?album= parameters' });
      return;
    }
    try {
      // 1. Check SQLite cache (includes previous TheAudioDB results)
      const cached = await getCachedAlbumArt(artist, album);
      if (cached !== undefined) {
        res.json({ thumb: cached });
        return;
      }

      // 2. Search host library for a song with embedded art for this album
      const hostSongPath = await findSongWithArtForAlbum(artist, album);
      if (hostSongPath) {
        const thumb = `/api/art/${encodeURIComponent(hostSongPath)}`;
        await cacheAlbumArt(artist, album, thumb);
        res.json({ thumb });
        return;
      }

      // 3. Search connected edge devices for art
      const edgeMatch = findEdgeSongWithArtForAlbum(artist, album);
      if (edgeMatch) {
        const thumb = `/api/art/remote/${edgeMatch.deviceId}/${encodeURIComponent(edgeMatch.localPath)}`;
        await cacheAlbumArt(artist, album, thumb);
        res.json({ thumb });
        return;
      }

      // 4. Last resort: TheAudioDB
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

  // POST /api/album-art/set — set custom album art from base64 image data
  router.post('/album-art/set', async (req: Request, res: Response) => {
    const { artist, album, data } = req.body as { artist?: string; album?: string; data?: string };
    if (!artist || !album || !data) {
      res.status(400).json({ error: 'missing artist, album, or data' });
      return;
    }
    try {
      const buffer = Buffer.from(data, 'base64');
      const cacheKey = `custom:${artist}:${album}`;
      cacheArtToDisk(cacheKey, buffer);
      const thumb = `/api/art/custom?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`;
      await cacheAlbumArt(artist, album, thumb);
      res.json({ ok: true, thumb });
    } catch (err) {
      console.error('Failed to set album art:', err);
      res.status(500).json({ error: 'Failed to set album art' });
    }
  });

  // GET /api/art/custom — serve custom album art
  router.get('/art/custom', (req: Request, res: Response) => {
    const artist = req.query.artist as string | undefined;
    const album = req.query.album as string | undefined;
    if (!artist || !album) {
      res.status(400).json({ error: 'missing ?artist= and ?album= parameters' });
      return;
    }
    const cacheKey = `custom:${artist}:${album}`;
    if (!serveArtFromCache(cacheKey, res)) {
      res.status(404).send('No custom artwork');
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
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // GET /api/audio/remote/:deviceId/:file — stream audio from an edge device (reverse streaming)
  router.get('/audio/remote/:deviceId/:file', async (req: Request, res: Response) => {
    const { deviceId, file } = req.params;
    const localPath = decodeURIComponent(file);

    // Try cache first
    const cachePath = getAudioCachePath(deviceId, localPath);
    if (fs.existsSync(cachePath)) {
      // Serve from cache using standard file streaming with Range support
      const stat = fs.statSync(cachePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const contentType = 'audio/mpeg'; // Cached files — mime unknown, default to mpeg

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(cachePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': fileSize });
        fs.createReadStream(cachePath).pipe(res);
      }
      return;
    }

    // Not cached — check if device is online
    if (!isEdgeDeviceOnline(deviceId)) {
      res.status(503).json({ error: 'Edge device is offline and file is not cached' });
      return;
    }

    // Stream from edge device (stream-as-it-arrives)
    try {
      const handled = await streamAudioFromEdge(deviceId, localPath, res);
      if (!handled) {
        // streamAudioFromEdge returned false — device went offline or error
        if (!res.headersSent) {
          res.status(503).json({ error: 'Failed to stream from edge device' });
        }
      }
    } catch (err) {
      console.error('[Federation] Remote audio stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' });
      }
    }
  });

  // GET /api/art/remote/:deviceId/:file — get album art from an edge device
  // Art is cached to disk so disconnected devices' art is still available.
  router.get('/art/remote/:deviceId/:file', async (req: Request, res: Response) => {
    const { deviceId, file } = req.params;
    const localPath = decodeURIComponent(file);

    // Check disk cache first
    const cacheKey = `edge:${deviceId}:${localPath}`;
    if (serveArtFromCache(cacheKey, res)) return;

    try {
      const base64Data = await requestArtFromEdge(deviceId, localPath);
      if (base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        // Cache to disk for future requests
        cacheArtToDisk(cacheKey, buffer);
        // Detect image type from magic bytes
        const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
        const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
        const contentType = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
      } else {
        res.status(404).send('No artwork');
      }
    } catch {
      res.status(502).send('Failed to fetch artwork from edge device');
    }
  });

  // GET /api/art/:file — extract embedded album art (with path traversal protection)
  // Art is cached to disk on first extraction so subsequent requests skip parsing.
  router.get('/art/:file', async (req: Request, res: Response) => {
    const filePath = decodeURIComponent(req.params.file);

    if (!await isPathWithinMediaLocations(filePath)) {
      res.status(403).json({ error: 'access denied' });
      return;
    }

    // Check disk cache first
    const cacheKey = `host:${filePath}`;
    if (serveArtFromCache(cacheKey, res)) return;

    try {
      const metadata = await parseFile(filePath);
      const picture = metadata.common.picture?.[0];
      if (picture) {
        // Cache to disk for future requests
        cacheArtToDisk(cacheKey, picture.data);
        res.setHeader('Content-Type', picture.format);
        res.setHeader('Cache-Control', 'public, max-age=86400');
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
