/**
 * On-disk art cache using IndexedDB.
 * Stores fetched album art images as base64 data-URLs keyed by their
 * API path (e.g. "/api/art/...") so they survive app restarts and are
 * available offline.
 */

const DB_NAME = 'opentunes_art_cache';
const STORE_NAME = 'art';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Get a cached data-URL for the given art path, or null. */
export async function getCachedArt(artPath: string): Promise<string | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(artPath);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Store a data-URL in the cache. */
export async function setCachedArt(artPath: string, dataUrl: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(dataUrl, artPath);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Caching is best-effort
  }
}

// In-memory layer so we don't hit IndexedDB on every render
const memCache = new Map<string, string>();

/**
 * Resolve an art path to a displayable URL.
 * Returns a cached data-URL if available, otherwise fetches from the
 * network, caches the result, and returns the data-URL.
 * Returns null if the image can't be loaded from either source.
 */
export async function resolveArt(
  artPath: string,
  fullUrl: string,
): Promise<string | null> {
  // 1. In-memory cache
  if (memCache.has(artPath)) return memCache.get(artPath)!;

  // 2. IndexedDB cache
  const cached = await getCachedArt(artPath);
  if (cached) {
    memCache.set(artPath, cached);
    return cached;
  }

  // 3. Network fetch → cache
  try {
    const resp = await fetch(fullUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await blobToDataUrl(blob);
    memCache.set(artPath, dataUrl);
    setCachedArt(artPath, dataUrl); // fire-and-forget
    return dataUrl;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
