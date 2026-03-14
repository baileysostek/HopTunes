import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import {
  getPairingSecret,
  regeneratePairingSecret,
  isLocalAddress,
  pairDevice,
  getLastPairing,
  getRegisteredDevices,
  revokeDevice,
  revokeAllDevices,
  getLanAddress,
} from '../auth';
import { removeDevice as removePlaybackDevice, broadcastState } from '../playback';
import { unregisterEdgeDevice, getConnectedEdgeDevices } from '../federation';
import { PORT } from '../config';

export interface ConnectRouterDeps {
  closeDeviceWebSocket: (deviceId: string) => void;
  closeAllDeviceWebSockets: () => void;
}

// --- Rate limiter for the pairing endpoint ---

const pairAttempts = new Map<string, { count: number; resetAt: number }>();
const PAIR_RATE_LIMIT = 5;        // max attempts
const PAIR_RATE_WINDOW_MS = 60_000; // per minute

function isPairRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = pairAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    pairAttempts.set(ip, { count: 1, resetAt: now + PAIR_RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > PAIR_RATE_LIMIT;
}

// Periodically clean up expired entries to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of pairAttempts) {
    if (now >= entry.resetAt) pairAttempts.delete(ip);
  }
}, PAIR_RATE_WINDOW_MS);

// --- Helpers ---

function localhostOnly(req: Request, res: Response): boolean {
  if (!isLocalAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'forbidden' });
    return true;
  }
  return false;
}

async function generateQrResponse(res: Response): Promise<void> {
  const lanIp = getLanAddress();
  const connectData = JSON.stringify({
    host: `http://${lanIp}:${PORT}`,
    secret: getPairingSecret(),
  });
  try {
    const qrDataUrl = await QRCode.toDataURL(connectData, {
      width: 280,
      margin: 2,
      color: { dark: '#ffffff', light: '#00000000' },
    });
    res.json({ qr: qrDataUrl, host: `http://${lanIp}:${PORT}` });
  } catch {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
}

// --- Factory ---

export function createConnectRouter(deps: ConnectRouterDeps): Router {
  const router = Router();

  // GET /api/connect/qr — QR code with pairing secret (localhost only)
  router.get('/qr', async (req, res) => {
    if (localhostOnly(req, res)) return;
    await generateQrResponse(res);
  });

  // POST /api/connect/pair — exchange pairing secret for a device token
  router.post('/pair', (req, res) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (isPairRateLimited(clientIp)) {
      res.status(429).json({ error: 'too many pairing attempts, try again later' });
      return;
    }

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

  // GET /api/connect/last-pairing — poll for a recent pairing event (localhost only)
  router.get('/last-pairing', (req, res) => {
    if (localhostOnly(req, res)) return;
    const since = parseInt(req.query.since as string, 10);
    if (isNaN(since)) {
      res.status(400).json({ error: 'since parameter required' });
      return;
    }
    const event = getLastPairing(since);
    res.json(event);
  });

  // POST /api/connect/regenerate — regenerate pairing secret (localhost only)
  router.post('/regenerate', async (req, res) => {
    if (localhostOnly(req, res)) return;
    regeneratePairingSecret();
    await generateQrResponse(res);
  });

  // GET /api/connect/devices — list registered devices (localhost only)
  router.get('/devices', (req, res) => {
    if (localhostOnly(req, res)) return;
    const devices = getRegisteredDevices().map(({ token, ...rest }) => rest);
    res.json(devices);
  });

  // DELETE /api/connect/devices/:id — revoke a single device (localhost only)
  router.delete('/devices/:id', async (req, res) => {
    if (localhostOnly(req, res)) return;
    const targetId = req.params.id;
    const ok = revokeDevice(targetId);
    if (!ok) {
      res.status(404).json({ error: 'device not found' });
      return;
    }
    removePlaybackDevice(targetId);
    deps.closeDeviceWebSocket(targetId);
    await unregisterEdgeDevice(targetId);
    broadcastState();
    const devices = getRegisteredDevices().map(({ token, ...rest }) => rest);
    res.json(devices);
  });

  // POST /api/connect/revoke-all — revoke all devices (localhost only)
  router.post('/revoke-all', async (req, res) => {
    if (localhostOnly(req, res)) return;
    const edgeDeviceIds = getConnectedEdgeDevices().map(d => d.deviceId);
    deps.closeAllDeviceWebSockets();
    revokeAllDevices();
    await Promise.all(edgeDeviceIds.map(id => unregisterEdgeDevice(id)));
    broadcastState();
    res.json([]);
  });

  return router;
}
