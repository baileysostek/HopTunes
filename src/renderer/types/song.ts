export interface Song {
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  trackNumber: number;
  path: string;
  art: string | null;
}

const DEFAULT_API_BASE = 'http://127.0.0.1:3000';
const STORAGE_KEY = 'opentunes_server_url';
const TOKEN_KEY = 'opentunes_auth_token';

export function getApiBase(): string {
  if (typeof window === 'undefined') return DEFAULT_API_BASE;
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_API_BASE;
}

export function setApiBase(url: string): void {
  localStorage.setItem(STORAGE_KEY, url);
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Clear stored server URL and auth token (used on device revocation). */
export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

/** Build a full URL with auth token as query param (for img/audio src) */
export function getMediaUrl(path: string): string {
  const base = `${getApiBase()}${path}`;
  const token = getAuthToken();
  if (!token) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

/** @deprecated Use getApiBase() for dynamic server URL support */
export const API_BASE = DEFAULT_API_BASE;
