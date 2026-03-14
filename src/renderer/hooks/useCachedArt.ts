import { useState, useEffect } from 'react';
import { getMediaUrl } from '../types/song';
import { resolveArt } from '../services/artCache';
import { isCapacitor } from '../utils/platform';

/**
 * Given an art API path (e.g. "/api/art/..."), returns a displayable URL.
 * On Capacitor (Android), images are cached to IndexedDB so they're
 * available offline. On Electron/web, returns the normal network URL
 * since the host is local.
 */
export function useCachedArt(artPath: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!artPath) {
      setSrc(null);
      return;
    }

    // On non-Capacitor platforms, skip caching — host is local
    if (!isCapacitor()) {
      setSrc(getMediaUrl(artPath));
      return;
    }

    let cancelled = false;
    const fullUrl = getMediaUrl(artPath);

    resolveArt(artPath, fullUrl).then((resolved) => {
      if (!cancelled) {
        // Fall back to network URL if caching fails (online case)
        setSrc(resolved ?? fullUrl);
      }
    });

    return () => { cancelled = true; };
  }, [artPath]);

  return src;
}
