import { app, BrowserWindow, Menu, session } from 'electron';
import { setupIpcHandlers } from './api';
import { initDatabase, getMediaLocations, addMediaLocation } from './database';
import { indexLibrary } from './indexer';
import { getPlaybackState, onStateChange, removeDevice as removePlaybackDevice, broadcastState, registerDevice as registerPlaybackDevice } from './playback';
import { isLocalAddress, validateDeviceToken, touchDevice, flushDeviceRegistry } from './auth';
import { PORT, MUSIC_DIR, buildCsp } from './config';
import { ServerWsMessage, DeviceInfo, WS_PROTOCOL_VERSION, MIN_WS_PROTOCOL_VERSION } from '../shared/types';
import {
  setFederationBroadcast,
  updateEdgeDeviceWs,
  unregisterEdgeDevice,
  getUnifiedLibraryNow,
  handleEdgeBinaryFrame,
} from './federation';
import { dispatchWsMessage, WsConnectionContext } from './wsHandlers';

import playbackRouter from './routes/playback';
import { createConnectRouter } from './routes/connect';
import { createLibraryRouter } from './routes/library';

import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import express from 'express';

// --- Rate-limited WS parse error logger ---
let wsParseErrorCount = 0;
let wsParseErrorLastLog = 0;
const WS_ERROR_LOG_INTERVAL = 5_000; // log at most once per 5 seconds

function logWsParseError(err: unknown): void {
  wsParseErrorCount++;
  const now = Date.now();
  if (now - wsParseErrorLastLog >= WS_ERROR_LOG_INTERVAL) {
    const count = wsParseErrorCount;
    wsParseErrorCount = 0;
    wsParseErrorLastLog = now;
    console.warn(`[WS] ${count} malformed message(s) in the last ${WS_ERROR_LOG_INTERVAL / 1000}s:`, err);
  }
}

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

// --- WebSocket liveness tracking (typed alternative to bolting isAlive onto ws) ---

const wsMissedPings = new Map<WebSocket, number>();

// --- WebSocket device tracking ---

const deviceWebSockets = new Map<string, WebSocket>();

// --- Edge device grace period ---
// When an edge device's WebSocket drops (e.g. phone screen off), delay
// unregistration so the library stays available and playback isn't disrupted.
// If the device reconnects within the window, the timer is cancelled.
const EDGE_GRACE_PERIOD_MS = 60_000; // 60 seconds
const edgeGracePeriodTimers = new Map<string, ReturnType<typeof setTimeout>>();

function closeDeviceWebSocket(deviceId: string): void {
  const ws = deviceWebSockets.get(deviceId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(4001, 'revoked');
  }
  deviceWebSockets.delete(deviceId);
}

function closeAllDeviceWebSockets(): void {
  const deviceIds = [...deviceWebSockets.keys()];
  for (const id of deviceIds) {
    closeDeviceWebSocket(id);
    removePlaybackDevice(id);
  }
}

let wss: WebSocketServer | null = null;

function broadcastToClients(message: ServerWsMessage): void {
  if (!wss) return;
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Create route modules with their dependencies
const connectRouter = createConnectRouter({
  closeDeviceWebSocket,
  closeAllDeviceWebSockets,
});

const libraryRouter = createLibraryRouter({
  broadcastToClients,
});

// --- Electron window ---

const CSP = buildCsp(PORT);

const createWindow = async (): Promise<void> => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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

  // Prevent Electron from navigating to files dropped onto the window
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  await initDatabase();
  // Seed the default music directory if no locations are configured yet
  const locations = await getMediaLocations();
  if (locations.length === 0) {
    await addMediaLocation(MUSIC_DIR);
  }
  getMediaLocations().then(dirs => indexLibrary(dirs));

  // --- Express + WebSocket server ---

  const expressApp = express();
  expressApp.use(cors());
  expressApp.use(express.json());

  // Auth middleware — local requests pass through, remote requests need a token
  expressApp.use('/api', (req, res, next) => {
    if (req.path === '/connect/pair') return next();
    if (isLocalAddress(req.socket.remoteAddress)) return next();

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7)
      : (req.query.token as string | undefined);
    const device = validateDeviceToken(token);
    if (device) {
      touchDevice(device);
      registerPlaybackDevice(device.id, device.name, device.type);
      return next();
    }
    res.status(401).json({ error: 'unauthorized' });
  });

  // Mount route modules
  expressApp.use('/api/connect', connectRouter);
  expressApp.use('/api/playback', playbackRouter);
  expressApp.use('/api', libraryRouter);

  expressApp.get('/', (req, res) => {
    res.json({ hello: 'world' });
  });

  try {
    // @ts-ignore - @types/node v24 generics incompatible with TS 4.5
    const server = http.createServer(expressApp);
    wss = new WebSocketServer({ server, perMessageDeflate: true });

    // Wire federation broadcast so it can push unified library updates
    setFederationBroadcast(broadcastToClients);

    wss.on('connection', (ws, req) => {
      const addr = req.socket.remoteAddress;
      const isLocal = isLocalAddress(addr);
      console.log(`[WS] Client connected from ${addr} (local: ${isLocal}), total: ${wss!.clients.size}`);
      let connectedDeviceId: string | null = null;
      let connectedDeviceName: string | null = null;
      let localClientDeviceId: string | null = null;

      wsMissedPings.set(ws, 0);
      ws.on('pong', () => { wsMissedPings.set(ws, 0); });

      const url = new URL(req.url || '', `http://${req.headers.host}`);

      // Authenticate remote (edge) clients
      if (!isLocal) {
        const token = url.searchParams.get('token');
        const device = validateDeviceToken(token || undefined);
        if (!device) {
          console.log('[WS] Rejected unauthorized client');
          ws.close(4001, 'unauthorized');
          return;
        }

        // Protocol version negotiation — reject incompatible edge clients
        // Missing version defaults to MIN so existing clients without ?v= still connect
        const rawVersion = url.searchParams.get('v');
        const clientVersion = rawVersion ? parseInt(rawVersion, 10) : MIN_WS_PROTOCOL_VERSION;
        if (isNaN(clientVersion) || clientVersion < MIN_WS_PROTOCOL_VERSION || clientVersion > WS_PROTOCOL_VERSION) {
          console.log(`[WS] Rejected client with incompatible protocol version: ${clientVersion || 'none'} (expected ${MIN_WS_PROTOCOL_VERSION}–${WS_PROTOCOL_VERSION})`);
          ws.close(4002, `unsupported protocol version, expected ${MIN_WS_PROTOCOL_VERSION}-${WS_PROTOCOL_VERSION}`);
          return;
        }

        // Cancel any pending grace-period unregistration from a prior disconnect
        const gracePeriodTimer = edgeGracePeriodTimers.get(device.id);
        if (gracePeriodTimer) {
          clearTimeout(gracePeriodTimer);
          edgeGracePeriodTimers.delete(device.id);
          console.log(`[WS] Edge device ${device.name} reconnected within grace period`);
        }

        touchDevice(device);
        connectedDeviceId = device.id;
        connectedDeviceName = device.name;
        deviceWebSockets.set(device.id, ws);
        registerPlaybackDevice(device.id, device.name, device.type);
        updateEdgeDeviceWs(device.id, ws);
        broadcastState();

        // Always show sync banner when an edge device connects.
        broadcastToClients({ type: 'edge-sync-start', deviceName: device.name, songCount: 0 });
      } else {
        // Local (desktop) clients: register immediately via query params so the
        // device appears in the device list before the welcome message is built.
        // Previously this relied on an async HTTP POST that could race with the welcome.
        const localDeviceId = url.searchParams.get('deviceId');
        const localDeviceName = url.searchParams.get('deviceName') || 'Desktop';
        const localDeviceType = (url.searchParams.get('deviceType') as DeviceInfo['type']) || 'desktop';
        if (localDeviceId) {
          localClientDeviceId = localDeviceId;
          registerPlaybackDevice(localDeviceId, localDeviceName, localDeviceType);
          broadcastState();
        }
      }

      // Handle incoming messages from edge devices (bidirectional protocol)
      const ctx: WsConnectionContext = {
        get connectedDeviceId() { return connectedDeviceId; },
        get connectedDeviceName() { return connectedDeviceName; },
        ws,
      };

      ws.on('message', (raw, isBinary) => {
        // Binary frames are routed to active reverse-streaming requests
        if (isBinary) {
          if (connectedDeviceId) {
            handleEdgeBinaryFrame(connectedDeviceId, raw as Buffer, ws);
          }
          return;
        }

        try {
          const parsed = JSON.parse(raw.toString());
          const error = dispatchWsMessage(parsed, ctx);
          if (error) {
            logWsParseError(new Error(error));
          }
        } catch (err) {
          logWsParseError(err);
        }
      });

      ws.on('close', (code) => {
        wsMissedPings.delete(ws);
        if (connectedDeviceId) {
          // Silently dismiss any active sync banner for this device.
          // The renderer ignores this if no sync is in progress for this device.
          if (connectedDeviceName) {
            broadcastToClients({ type: 'edge-sync-cancel', deviceName: connectedDeviceName });
          }
          deviceWebSockets.delete(connectedDeviceId);
          if (code === 4001) {
            // Revocation — unregister immediately
            removePlaybackDevice(connectedDeviceId);
            unregisterEdgeDevice(connectedDeviceId);
            broadcastState();
          } else {
            // Non-revocation disconnect (e.g. phone screen off, network hiccup).
            // Remove from the playback device list immediately so the "Select a
            // device" popup updates in real time. Defer federation unregistration
            // (edge library/songs) to give the device time to reconnect.
            const deviceId = connectedDeviceId;
            removePlaybackDevice(deviceId);

            const existing = edgeGracePeriodTimers.get(deviceId);
            if (existing) clearTimeout(existing);

            console.log(`[WS] Edge device ${deviceId} disconnected, grace period ${EDGE_GRACE_PERIOD_MS / 1000}s`);
            edgeGracePeriodTimers.set(deviceId, setTimeout(async () => {
              edgeGracePeriodTimers.delete(deviceId);
              console.log(`[WS] Grace period expired for ${deviceId}, unregistering`);
              await unregisterEdgeDevice(deviceId);
              broadcastState();
              // unregisterEdgeDevice broadcasts library via debounce, but also
              // send an immediate one to ensure clients see songs removed
              const library = await getUnifiedLibraryNow();
              broadcastToClients({ type: 'library', data: library });
            }, EDGE_GRACE_PERIOD_MS));

            // Broadcast state so the device list updates immediately, and
            // re-broadcast the library so edge songs are removed right away
            // (the grace period only preserves queue/playback, not browsing).
            broadcastState();
            getUnifiedLibraryNow().then(library => {
              broadcastToClients({ type: 'library', data: library });
            }).catch(() => {});
          }
        } else if (localClientDeviceId) {
          // Local client disconnected — remove from device list immediately
          removePlaybackDevice(localClientDeviceId);
          broadcastState();
        }
        console.log(`[WS] Client disconnected (code: ${code}), remaining: ${wss!.clients.size}`);
      });

      // Send welcome message with full state + library
      (async () => {
        try {
          const library = await getUnifiedLibraryNow();
          if (ws.readyState !== WebSocket.OPEN) return;
          const welcome: ServerWsMessage = {
            type: 'welcome',
            protocolVersion: WS_PROTOCOL_VERSION,
            state: getPlaybackState(),
            library,
          };
          ws.send(JSON.stringify(welcome));
        } catch (err) {
          console.error('[WS] Failed to send welcome:', err);
        }
      })();
    });

    // Ping all clients every 3s terminate after 2 missed pongs (~20s)
    setInterval(() => {
      for (const client of wss!.clients) {
        const missed = (wsMissedPings.get(client) ?? 0) + 1;
        if (missed > 5) {
          console.log(`[WS] Client missed ${missed - 1} pings, terminating`);
          wsMissedPings.delete(client);
          client.terminate();
          continue;
        }
        wsMissedPings.set(client, missed);
        client.ping();
      }
    }, 3000);

    // Broadcast playback state on any state change
    onStateChange(() => {
      broadcastToClients({ type: 'state', data: getPlaybackState() });
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Music server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start Express:', err);
  }
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Flush debounced device registry writes on shutdown
app.on('before-quit', () => {
  flushDeviceRegistry();
});
