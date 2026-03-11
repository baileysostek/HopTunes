import { app, BrowserWindow, Menu, session } from 'electron';
import { setupIpcHandlers } from './api';
import { initDatabase, getAllSongs, getCachedArtistImage, cacheArtistImage, getCachedAlbumArt, cacheAlbumArt } from './database';
import { indexLibrary } from './indexer';
import { SongInfo, getPlaybackState, onStateChange, removeDevice as removePlaybackDevice, broadcastState, registerDevice as registerPlaybackDevice } from './playback';
import playbackRouter from './routes/playback';
import {
  getPairingSecret,
  regeneratePairingSecret,
  isLocalAddress,
  validateDeviceToken,
  touchDevice,
  pairDevice,
  getRegisteredDevices,
  revokeDevice,
  revokeAllDevices,
  validatePairingSecret,
  getLanAddress,
} from './auth';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import QRCode from 'qrcode';

import express from "express";

// Track device ID → WebSocket so we can force-close on revocation
const deviceWebSockets = new Map<string, WebSocket>();

function closeDeviceWebSocket(deviceId: string): void {
  const ws = deviceWebSockets.get(deviceId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(4001, 'revoked');
  }
  deviceWebSockets.delete(deviceId);
}
import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

const MUSIC_DIR = path.resolve("C:/Users/Bailey Sostek/Music");

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: http://127.0.0.1:3000 http://localhost:3000 https://r2.theaudiodb.com https://www.theaudiodb.com",
  "connect-src 'self' http://127.0.0.1:3000 http://localhost:3000 ws://127.0.0.1:3000 ws://localhost:3000 ws://*:3000 ws://localhost:9000",
  "media-src 'self' http://127.0.0.1:3000 http://localhost:3000",
].join('; ');

const createWindow = async (): Promise<void> => {
  // Override CSP headers so dev-server/sandbox headers don't block API access
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Strip any existing CSP headers (case-insensitive) so webpack dev server's
    // lowercase 'content-security-policy' doesn't conflict with ours
    const filtered = Object.fromEntries(
      Object.entries(details.responseHeaders || {}).filter(
        ([key]) => key.toLowerCase() !== 'content-security-policy'
      )
    );
    callback({
      responseHeaders: {
        ...filtered,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  const mainWindow = new BrowserWindow({
    height: 800,
    width: 1200,
    minHeight: 600,
    minWidth: 900,
    frame: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  setupIpcHandlers(mainWindow);
  Menu.setApplicationMenu(null);

  // F12 to toggle dev tools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Initialize database and index the library
  await initDatabase();
  indexLibrary(MUSIC_DIR); // runs in background, doesn't block window

  const expressApp = express();

  expressApp.use(cors());
  expressApp.use(express.json());

  // Auth middleware — local requests pass through, remote requests need a registered device token
  // The pairing endpoint is exempt since the device doesn't have a token yet
  expressApp.use('/api', (req, res, next) => {
    if (req.path === '/connect/pair') return next();
    if (isLocalAddress(req.socket.remoteAddress)) {
      return next();
    }
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7)
      : (req.query.token as string | undefined);
    const device = validateDeviceToken(token);
    if (device) {
      touchDevice(device);
      // Keep the in-memory playback device map in sync — ensures edge devices
      // stay visible in the device list even after being pruned by the 30s timeout.
      registerPlaybackDevice(device.id, device.name, device.type);
      return next();
    }
    res.status(401).json({ error: 'unauthorized' });
  });

  // Connection info endpoint — localhost only, returns QR code with pairing secret
  expressApp.get('/api/connect/qr', async (req, res) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const lanIp = getLanAddress();
    const connectData = JSON.stringify({
      host: `http://${lanIp}:3000`,
      secret: getPairingSecret(),
    });
    try {
      const qrDataUrl = await QRCode.toDataURL(connectData, {
        width: 280,
        margin: 2,
        color: { dark: '#ffffff', light: '#00000000' },
      });
      res.json({ qr: qrDataUrl, host: `http://${lanIp}:3000` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  });

  // Pair a device — exchange pairing secret for a unique device token
  // No auth middleware needed: the pairing secret IS the authentication
  expressApp.post('/api/connect/pair', (req, res) => {
    const { secret, deviceId, name, type } = req.body as {
      secret: string; deviceId: string; name: string; type: string;
    };
    if (!secret || !deviceId || !name) {
      res.status(400).json({ error: 'secret, deviceId, and name are required' });
      return;
    }
    const result = pairDevice(secret, deviceId, name, (type as any) || 'web');
    if (!result) {
      res.status(401).json({ error: 'invalid pairing secret' });
      return;
    }
    res.json({ token: result.token });
  });

  // Regenerate pairing secret — localhost only, does NOT revoke existing devices
  expressApp.post('/api/connect/regenerate', async (req, res) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    regeneratePairingSecret();
    const lanIp = getLanAddress();
    const connectData = JSON.stringify({
      host: `http://${lanIp}:3000`,
      secret: getPairingSecret(),
    });
    try {
      const qrDataUrl = await QRCode.toDataURL(connectData, {
        width: 280,
        margin: 2,
        color: { dark: '#ffffff', light: '#00000000' },
      });
      res.json({ qr: qrDataUrl, host: `http://${lanIp}:3000` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  });

  // List registered devices — localhost only
  expressApp.get('/api/connect/devices', (req, res) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    // Strip tokens from the response — settings page doesn't need them
    const devices = getRegisteredDevices().map(({ token, ...rest }) => rest);
    res.json(devices);
  });

  // Revoke a device — localhost only
  expressApp.delete('/api/connect/devices/:id', (req, res) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const targetId = req.params.id;
    const ok = revokeDevice(targetId);
    if (!ok) {
      res.status(404).json({ error: 'device not found' });
      return;
    }
    // Also remove from playback devices, close its WebSocket, and broadcast
    removePlaybackDevice(targetId);
    closeDeviceWebSocket(targetId);
    broadcastState();
    const devices = getRegisteredDevices().map(({ token, ...rest }) => rest);
    res.json(devices);
  });

  // Revoke all devices — localhost only
  expressApp.post('/api/connect/revoke-all', (req, res) => {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    // Snapshot IDs before closing (closing mutates the map)
    const deviceIds = [...deviceWebSockets.keys()];
    for (const deviceId of deviceIds) {
      closeDeviceWebSocket(deviceId);
      removePlaybackDevice(deviceId);
    }
    revokeAllDevices();
    broadcastState();
    res.json([]);
  });

  expressApp.use('/api/playback', playbackRouter);

  // Serve library from the SQLite database
  expressApp.get("/api/library", async (req, res) => {
    try {
      const rows = await getAllSongs();
      const library: SongInfo[] = rows.map((row) => ({
        title: row.title,
        artist: row.artist,
        album: row.album,
        duration: row.duration,
        trackNumber: row.track_number || 0,
        path: `/api/audio/${encodeURIComponent(row.file_path)}`,
        art: row.has_art ? `/api/art/${encodeURIComponent(row.file_path)}` : null,
      }));
      res.json(library);
    } catch (err) {
      console.error('Failed to query library:', err);
      res.status(500).json({ error: 'Failed to load library' });
    }
  });

  // Trigger a re-index
  expressApp.post("/api/reindex", async (req, res) => {
    try {
      await indexLibrary(MUSIC_DIR);
      const rows = await getAllSongs();
      res.json({ indexed: rows.length });
    } catch (err) {
      console.error('Failed to reindex:', err);
      res.status(500).json({ error: 'Failed to reindex' });
    }
  });

  // Proxy artist image lookups to TheAudioDB with SQLite caching (7-day TTL)
  expressApp.get("/api/artist-image", async (req, res) => {
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

  // Proxy album art lookups to TheAudioDB with permanent SQLite caching
  expressApp.get("/api/album-art", async (req, res) => {
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

  expressApp.get("/", (req, res) => {
    res.json({ hello: "world" });
  });

  expressApp.get("/api/audio/:file", (req, res) => {
    const filePath = decodeURIComponent(req.params.file);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeTypes: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".flac": "audio/flac",
      ".ogg": "audio/ogg",
      ".wav": "audio/wav",
    };
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "audio/mpeg";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  expressApp.get("/api/art/:file", async (req, res) => {
    const filePath = decodeURIComponent(req.params.file);
    try {
      const metadata = await parseFile(filePath);
      const picture = metadata.common.picture?.[0];
      if (picture) {
        res.setHeader("Content-Type", picture.format);
        res.send(picture.data);
      } else {
        res.status(404).send("No artwork");
      }
    } catch {
      res.status(500).send("Failed to extract artwork");
    }
  });

  try {
    // @ts-ignore - @types/node v24 generics incompatible with TS 4.5
    const server = http.createServer(expressApp);

    // WebSocket server on the same HTTP server
    const wss = new WebSocketServer({ server });

    // Authenticate WebSocket connections
    wss.on('connection', (ws, req) => {
      const addr = req.socket.remoteAddress;
      const isLocal = isLocalAddress(addr);
      console.log(`[WS] Client connected from ${addr} (local: ${isLocal}), total: ${wss.clients.size}`);
      let connectedDeviceId: string | null = null;
      // Track ping/pong liveness — starts true (just connected)
      (ws as any).isAlive = true;
      ws.on('pong', () => { (ws as any).isAlive = true; });

      if (!isLocal) {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const device = validateDeviceToken(token || undefined);
        if (!device) {
          console.log('[WS] Rejected unauthorized client');
          ws.close(4001, 'unauthorized');
          return;
        }
        touchDevice(device);
        connectedDeviceId = device.id;
        deviceWebSockets.set(device.id, ws);
        // Register in playback map immediately so the host sees the device
        // as soon as the WebSocket connects, not after the HTTP registration.
        registerPlaybackDevice(device.id, device.name, device.type);
        broadcastState();
      }
      ws.on('close', (code) => {
        if (connectedDeviceId) {
          deviceWebSockets.delete(connectedDeviceId);
          // Immediately remove from playback devices so the host knows
          // the edge device is gone — no need to wait for the 30s prune.
          // Skip if this was a deliberate revocation (already handled).
          if (code !== 4001) {
            removePlaybackDevice(connectedDeviceId);
            broadcastState();
          }
        }
        console.log(`[WS] Client disconnected (code: ${code}), remaining: ${wss.clients.size}`);
      });
    });

    // Ping all clients every 10s — if a client hasn't ponged since the last
    // ping, it's dead (e.g. device powered off). Terminate the connection
    // so the close handler fires and removes it from the device list.
    setInterval(() => {
      for (const client of wss.clients) {
        if (!(client as any).isAlive) {
          console.log('[WS] Client failed ping, terminating');
          client.terminate();
          continue;
        }
        (client as any).isAlive = false;
        client.ping();
      }
    }, 5000);

    // Broadcast playback state to all connected clients on any state change
    onStateChange(() => {
      const state = JSON.stringify(getPlaybackState());
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(state);
        }
      }
    });

    server.listen(3000, "0.0.0.0", () => {
      console.log("Music server running at http://localhost:3000");
    });
  } catch (err) {
    console.error("Failed to start Express:", err);
  }
};

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
