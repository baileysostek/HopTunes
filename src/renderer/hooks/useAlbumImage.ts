import { useState, useEffect } from 'react';
import { getApiBase } from '../types/song';

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function cacheKey(artist: string, album: string): string {
  return `${artist}\0${album}`;
}

function fetchAlbumImage(artist: string, album: string): Promise<string | null> {
  const key = cacheKey(artist, album);
  if (pending.has(key)) return pending.get(key)!;

  const base = getApiBase();

  const promise = fetch(
    `${base}/api/album-art?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
  )
    .then(r => r.json())
    .then(data => {
      let thumb: string | null = data.thumb || null;
      // The server may return a local /api/art/... path (from host or edge device)
      // instead of an external URL — resolve it to a full URL
      if (thumb && thumb.startsWith('/api/')) {
        thumb = `${base}${thumb}`;
      }
      cache.set(key, thumb);
      pending.delete(key);
      return thumb;
    })
    .catch(() => {
      cache.set(key, null);
      pending.delete(key);
      return null;
    });

  pending.set(key, promise);
  return promise;
}

/**
 * Fetches album cover art when no embedded art is available.
 * Resolution order: host library → edge devices → TheAudioDB (last resort).
 * Results are permanently cached in SQLite (never expires) and in-memory.
 */
/** Invalidate the in-memory cache for a specific album so the next render re-fetches. */
export function invalidateAlbumImage(artist: string, album: string): void {
  const key = cacheKey(artist, album);
  cache.delete(key);
  pending.delete(key);
}

export function useAlbumImage(artist: string, album: string): string | null {
  const key = cacheKey(artist, album);
  const cached = cache.get(key);
  const [result, setResult] = useState<string | null>(cached ?? null);

  useEffect(() => {
    if (!artist || !album) return;

    if (cache.has(key)) {
      setResult(cache.get(key)!);
      return;
    }

    let cancelled = false;
    fetchAlbumImage(artist, album).then(r => {
      if (!cancelled) setResult(r);
    });
    return () => { cancelled = true; };
  }, [artist, album]);

  return result;
}
