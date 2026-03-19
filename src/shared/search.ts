import type { Song } from './types';

/** Strip common punctuation so "its only" matches "it's only", etc. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[''`\-.,!?]/g, '');
}

export interface SearchHints {
  artist?: string;
  album?: string;
  title?: string;
  focus?: string;
}

/**
 * Score and rank songs against a query string with optional structured hints
 * (e.g. from Android voice search extras). Returns songs sorted by relevance.
 */
export function searchSongs(songs: Song[], query: string, hints?: SearchHints): Song[] {
  const q = normalize(query.trim());
  if (!q && !hints?.artist && !hints?.album && !hints?.title) return [];

  const scored: { song: Song; score: number }[] = [];

  for (const song of songs) {
    let score = 0;
    const titleNorm = normalize(song.title);
    const artistNorm = normalize(song.artist);
    const albumNorm = normalize(song.album);

    // Structured hints from voice search get high priority
    if (hints?.title && titleNorm.includes(normalize(hints.title))) score += 100;
    if (hints?.artist && artistNorm.includes(normalize(hints.artist))) score += 50;
    if (hints?.album && albumNorm.includes(normalize(hints.album))) score += 30;

    // Unstructured query matching
    if (q) {
      if (titleNorm === q) score += 80;
      else if (titleNorm.startsWith(q)) score += 60;
      else if (titleNorm.includes(q)) score += 40;

      if (artistNorm === q) score += 70;
      else if (artistNorm.includes(q)) score += 35;

      if (albumNorm === q) score += 50;
      else if (albumNorm.includes(q)) score += 25;
    }

    if (score > 0) scored.push({ song, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.song);
}

/**
 * Build a playback queue from a matched song based on the voice search focus.
 * - Artist focus: all songs by that artist
 * - Album focus: all songs from that album
 * - Default: the matched song's album
 */
export function buildSearchQueue(allSongs: Song[], matchedSong: Song, focus?: string): Song[] {
  if (focus === 'vnd.android.cursor.item/artist') {
    return allSongs
      .filter((s) => s.artist === matchedSong.artist)
      .sort((a, b) => a.album.localeCompare(b.album) || a.trackNumber - b.trackNumber);
  }
  if (focus === 'vnd.android.cursor.item/album') {
    return allSongs
      .filter((s) => s.album === matchedSong.album && s.artist === matchedSong.artist)
      .sort((a, b) => a.trackNumber - b.trackNumber);
  }
  // Default: queue the matched song's album
  return allSongs
    .filter((s) => s.album === matchedSong.album && s.artist === matchedSong.artist)
    .sort((a, b) => a.trackNumber - b.trackNumber);
}
