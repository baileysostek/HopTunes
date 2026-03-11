import { useState, useEffect } from 'react';
import { getApiBase } from '../types/song';

interface ArtistImageResult {
  banner: string | null;
  thumb: string | null;
  fanart: string | null;
  wideThumb: string | null;
}

const cache = new Map<string, ArtistImageResult>();
const pending = new Map<string, Promise<ArtistImageResult>>();

const EMPTY: ArtistImageResult = { banner: null, thumb: null, fanart: null, wideThumb: null };

function fetchArtistImage(artistName: string): Promise<ArtistImageResult> {
  if (pending.has(artistName)) return pending.get(artistName)!;

  const promise = fetch(
    `${getApiBase()}/api/artist-image?s=${encodeURIComponent(artistName)}`
  )
    .then(r => r.json())
    .then(data => {
      const artist = data.artists?.[0];
      const result: ArtistImageResult = {
        banner: artist?.strArtistBanner || null,
        thumb: artist?.strArtistThumb || null,
        fanart: artist?.strArtistFanart || null,
        wideThumb: artist?.strArtistWideThumb || null,
      };
      cache.set(artistName, result);
      pending.delete(artistName);
      return result;
    })
    .catch(() => {
      cache.set(artistName, EMPTY);
      pending.delete(artistName);
      return EMPTY;
    });

  pending.set(artistName, promise);
  return promise;
}

/**
 * Fetches artist artwork from TheAudioDB.
 * Returns the best available image URL (banner > fanart > wideThumb > thumb)
 * with in-memory caching and deduplication.
 */
export function useArtistImage(artistName: string): string | null {
  const cached = cache.get(artistName);
  const [result, setResult] = useState<ArtistImageResult>(cached ?? EMPTY);

  useEffect(() => {
    if (cache.has(artistName)) {
      setResult(cache.get(artistName)!);
      return;
    }

    let cancelled = false;
    fetchArtistImage(artistName).then(r => {
      if (!cancelled) setResult(r);
    });
    return () => { cancelled = true; };
  }, [artistName]);

  return result.banner || result.fanart || result.wideThumb || result.thumb;
}
