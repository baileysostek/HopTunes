import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const AUTH_FILE = path.join(app.getPath('userData'), 'auth.json');
const DEVICES_FILE = path.join(app.getPath('userData'), 'devices.json');

// --- Pairing secret (used in QR codes for initial handshake only) ---

export interface RegisteredDevice {
  id: string;         // device's self-reported ID
  token: string;      // unique auth token for this device
  name: string;       // 'Android', 'iOS', 'Browser', etc.
  type: 'desktop' | 'mobile' | 'web';
  firstSeen: number;  // timestamp of first pairing
  lastSeen: number;   // timestamp of most recent authenticated request
}

function loadOrCreatePairingSecret(): string {
  // Always generate a fresh secret on startup. The pairing secret is ephemeral —
  // device tokens in devices.json are the persistent credentials. Only a SHA-256
  // hash is written to disk so the raw secret is never persisted.
  const secret = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ secretHash: hash }), 'utf-8');
  return secret;
}

let pairingSecret = loadOrCreatePairingSecret();

export function getPairingSecret(): string {
  return pairingSecret;
}

/** Regenerate the pairing secret. Does NOT revoke existing device tokens. */
export function regeneratePairingSecret(): string {
  pairingSecret = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(pairingSecret).digest('hex');
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ secretHash: hash }), 'utf-8');
  return pairingSecret;
}

export function validatePairingSecret(secret: string | undefined): boolean {
  if (!secret) return false;
  return secret === pairingSecret;
}

// --- Device registry (persisted to disk) ---

let deviceRegistry: Map<string, RegisteredDevice> = new Map();
// O(1) token → device lookup index (maintained alongside deviceRegistry)
let tokenIndex: Map<string, RegisteredDevice> = new Map();

function rebuildTokenIndex(): void {
  tokenIndex = new Map();
  for (const device of deviceRegistry.values()) {
    tokenIndex.set(device.token, device);
  }
}

function loadDeviceRegistry(): void {
  try {
    const data = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf-8'));
    if (Array.isArray(data)) {
      deviceRegistry = new Map(data.map((d: RegisteredDevice) => [d.id, d]));
    }
  } catch {
    // File doesn't exist or is corrupt — start fresh
    deviceRegistry = new Map();
  }
  rebuildTokenIndex();
}

function saveDeviceRegistry(): void {
  fs.writeFileSync(DEVICES_FILE, JSON.stringify([...deviceRegistry.values()], null, 2), 'utf-8');
}

// Debounced save — coalesces rapid touchDevice calls into a single disk write.
// Flushes at most once every 30 seconds.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveTime = 0;
const SAVE_DEBOUNCE_MS = 30_000;

function debouncedSave(): void {
  const now = Date.now();
  if (now - lastSaveTime >= SAVE_DEBOUNCE_MS) {
    // Enough time has passed — save immediately
    lastSaveTime = now;
    saveDeviceRegistry();
    return;
  }
  // Schedule a trailing save if one isn't already pending
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      lastSaveTime = Date.now();
      saveDeviceRegistry();
    }, SAVE_DEBOUNCE_MS - (now - lastSaveTime));
  }
}

/** Flush any pending debounced save to disk (call on app shutdown). */
export function flushDeviceRegistry(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveDeviceRegistry();
}

// Load on startup
loadDeviceRegistry();

/** Last successful pairing event (for the ConnectModal to poll). */
let lastPairingEvent: { device: { name: string; type: string }; timestamp: number } | null = null;

/** Returns the last pairing event if it occurred after `since`, otherwise null. */
export function getLastPairing(since: number): { device: { name: string; type: string }; timestamp: number } | null {
  if (lastPairingEvent && lastPairingEvent.timestamp >= since) return lastPairingEvent;
  return null;
}

/** Pair a new device: validate the pairing secret, generate a unique token, persist. */
export function pairDevice(
  secret: string,
  deviceId: string,
  name: string,
  type: RegisteredDevice['type']
): { token: string } | null {
  if (secret !== pairingSecret) return null;

  // If device already exists, remove old token from index before re-pairing
  const existing = deviceRegistry.get(deviceId);
  if (existing) {
    tokenIndex.delete(existing.token);
  }

  const now = Date.now();
  const token = crypto.randomBytes(32).toString('hex');

  const device: RegisteredDevice = {
    id: deviceId,
    token,
    name,
    type,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  };

  deviceRegistry.set(deviceId, device);
  tokenIndex.set(token, device);
  saveDeviceRegistry();

  lastPairingEvent = { device: { name, type }, timestamp: now };

  return { token };
}

/** Validate a device token. Returns the device if valid, null otherwise. O(1) lookup. */
export function validateDeviceToken(token: string | undefined): RegisteredDevice | null {
  if (!token) return null;
  return tokenIndex.get(token) ?? null;
}

/** Update lastSeen for a device (called from auth middleware on each request). */
export function touchDevice(device: RegisteredDevice): void {
  device.lastSeen = Date.now();
  debouncedSave();
}

/** Get all registered devices (for the settings UI). */
export function getRegisteredDevices(): RegisteredDevice[] {
  return [...deviceRegistry.values()];
}

/** Revoke a single device by ID. Returns true if found and removed. */
export function revokeDevice(deviceId: string): boolean {
  const device = deviceRegistry.get(deviceId);
  if (!device) return false;
  tokenIndex.delete(device.token);
  deviceRegistry.delete(deviceId);
  saveDeviceRegistry();
  return true;
}

/** Revoke all devices. */
export function revokeAllDevices(): void {
  deviceRegistry.clear();
  tokenIndex.clear();
  saveDeviceRegistry();
}

// --- Network helpers ---

export function isLocalAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

export function getLanAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/** @internal Reset all module state. Only for use in tests. */
export function __resetForTesting(): void {
  deviceRegistry.clear();
  tokenIndex.clear();
  lastPairingEvent = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  lastSaveTime = 0;
  pairingSecret = crypto.randomBytes(32).toString('hex');
}
