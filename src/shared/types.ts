// Shared types used by both the main (host) process and renderer (edge) clients.
// Single source of truth — avoids duplicate definitions drifting out of sync.

/** URL prefix used for audio streaming endpoints. */
export const AUDIO_PATH_PREFIX = '/api/audio/';

/** Current WS protocol version. Bump when making breaking message changes. */
export const WS_PROTOCOL_VERSION = 1;

/**
 * Minimum WS protocol version the host will accept from edge clients.
 * Allows rolling upgrades: bump WS_PROTOCOL_VERSION for new features while
 * keeping MIN_WS_PROTOCOL_VERSION at the oldest compatible version.
 */
export const MIN_WS_PROTOCOL_VERSION = 1;

export interface SongOrigin {
  deviceId: string;
  deviceName: string;
  available: boolean;
}

export interface Song {
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  trackNumber: number;
  path: string;
  art: string | null;
  hash: string;
  hidden: boolean;
  /** undefined = host-local (backward compatible). Present = from an edge device. */
  origin?: SongOrigin;
}

/** Metadata sent from an edge device to the host to announce its local library. */
export interface EdgeSongMeta {
  localPath: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  trackNumber: number;
  hash: string;
  hasArt: boolean;
  mimeType: string;
  fileSize: number;
}

export type DeviceType = 'desktop' | 'mobile' | 'web';

export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType;
  lastSeen: number;
}

export interface PlaybackState {
  currentSong: Song | null;
  status: 'playing' | 'paused' | 'stopped';
  position: number;       // seconds into the current song
  updatedAt: number;      // Date.now() when position was last set
  queue: Song[];
  history: Song[];
}

export interface ServerPlaybackState extends PlaybackState {
  estimatedPosition: number;
  activeDeviceId: string | null;
  devices: DeviceInfo[];
}

// --- WebSocket message protocol ---

export type ServerWsMessage =
  | { type: 'welcome'; protocolVersion: number; state: ServerPlaybackState; library: Song[] }
  | { type: 'state'; data: ServerPlaybackState }
  | { type: 'library'; data: Song[] }
  | { type: 'reindex-progress'; found: number }
  // Federation: host notifies clients about edge device sync status
  | { type: 'edge-sync-start'; deviceName: string; songCount: number }
  | { type: 'edge-sync-done'; deviceName: string; newSongCount: number }
  // Federation: host asks edge device for audio/art
  | { type: 'request-audio'; requestId: string; localPath: string }
  | { type: 'request-art'; requestId: string; localPath: string };

export type ClientWsMessage =
  | { type: 'ping' }
  | { type: 'heartbeat'; deviceId: string; name?: string; deviceType?: DeviceType }
  // Federation: edge device announces its library
  | { type: 'edge-library'; deviceId: string; songs: EdgeSongMeta[]; syncing?: boolean }
  | { type: 'edge-library-update'; deviceId: string; updates: { localPath: string; hash: string }[] }
  // Federation: edge device responds to host requests
  | { type: 'edge-audio-response'; requestId: string; mimeType: string; fileSize: number }
  | { type: 'edge-art-response'; requestId: string; data: string | null };
