// Shared types used by both the main (host) process and renderer (edge) clients.
// Single source of truth — avoids duplicate definitions drifting out of sync.

/** URL prefix used for audio streaming endpoints. */
export const AUDIO_PATH_PREFIX = '/api/audio/';

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
  | { type: 'welcome'; state: ServerPlaybackState; library: Song[] }
  | { type: 'state'; data: ServerPlaybackState }
  | { type: 'library'; data: Song[] }
  | { type: 'reindex-progress'; found: number };

export type ClientWsMessage =
  | { type: 'ping' }
  | { type: 'heartbeat'; deviceId: string };
