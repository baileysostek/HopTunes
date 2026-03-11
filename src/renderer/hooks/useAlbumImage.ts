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

  const promise = fetch(
    `${getApiBase()}/api/album-art?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
  )
    .then(r => r.json())
    .then(data => {
      const thumb: string | null = data.thumb || null;
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
 * Fetches album cover art from TheAudioDB when no embedded art is available.
 * Results are permanently cached in SQLite (never expires) and in-memory.
 */
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
