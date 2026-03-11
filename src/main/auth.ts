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
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    if (data.token && typeof data.token === 'string') {
      return data.token;
    }
  } catch {
    // File doesn't exist or is corrupt — generate a new secret
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ token: secret }), 'utf-8');
  return secret;
}

let pairingSecret = loadOrCreatePairingSecret();

export function getPairingSecret(): string {
  return pairingSecret;
}

/** Regenerate the pairing secret. Does NOT revoke existing device tokens. */
export function regeneratePairingSecret(): string {
  pairingSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ token: pairingSecret }), 'utf-8');
  return pairingSecret;
}

export function validatePairingSecret(secret: string | undefined): boolean {
  if (!secret) return false;
  return secret === pairingSecret;
}

// --- Device registry (persisted to disk) ---

let deviceRegistry: Map<string, RegisteredDevice> = new Map();

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
}

function saveDeviceRegistry(): void {
  fs.writeFileSync(DEVICES_FILE, JSON.stringify([...deviceRegistry.values()], null, 2), 'utf-8');
}

// Load on startup
loadDeviceRegistry();

/** Pair a new device: validate the pairing secret, generate a unique token, persist. */
export function pairDevice(
  secret: string,
  deviceId: string,
  name: string,
  type: RegisteredDevice['type']
): { token: string } | null {
  if (secret !== pairingSecret) return null;

  // If device already exists, issue a new token (re-pairing)
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('hex');
  const existing = deviceRegistry.get(deviceId);

  deviceRegistry.set(deviceId, {
    id: deviceId,
    token,
    name,
    type,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  });

  saveDeviceRegistry();
  return { token };
}

/** Validate a device token. Returns the device if valid, null otherwise. */
export function validateDeviceToken(token: string | undefined): RegisteredDevice | null {
  if (!token) return null;
  for (const device of deviceRegistry.values()) {
    if (device.token === token) {
      return device;
    }
  }
  return null;
}

/** Update lastSeen for a device (called from auth middleware on each request). */
export function touchDevice(device: RegisteredDevice): void {
  device.lastSeen = Date.now();
  // Persist periodically — we batch this by saving only if >60s since last save
  // For simplicity, save on every touch (the file is small)
  saveDeviceRegistry();
}

/** Get all registered devices (for the settings UI). */
export function getRegisteredDevices(): RegisteredDevice[] {
  return [...deviceRegistry.values()];
}

/** Revoke a single device by ID. Returns true if found and removed. */
export function revokeDevice(deviceId: string): boolean {
  const existed = deviceRegistry.delete(deviceId);
  if (existed) saveDeviceRegistry();
  return existed;
}

/** Revoke all devices. */
export function revokeAllDevices(): void {
  deviceRegistry.clear();
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
