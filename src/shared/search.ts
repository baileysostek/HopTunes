import type { Song } from './types';

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
  const q = query.toLowerCase().trim();
  if (!q && !hints?.artist && !hints?.album && !hints?.title) return [];

  const scored: { song: Song; score: number }[] = [];

  for (const song of songs) {
    let score = 0;
    const titleLower = song.title.toLowerCase();
    const artistLower = song.artist.toLowerCase();
    const albumLower = song.album.toLowerCase();

    // Structured hints from voice search get high priority
    if (hints?.title && titleLower.includes(hints.title.toLowerCase())) score += 100;
    if (hints?.artist && artistLower.includes(hints.artist.toLowerCase())) score += 50;
    if (hints?.album && albumLower.includes(hints.album.toLowerCase())) score += 30;

    // Unstructured query matching
    if (q) {
      if (titleLower === q) score += 80;
      else if (titleLower.startsWith(q)) score += 60;
      else if (titleLower.includes(q)) score += 40;

      if (artistLower === q) score += 70;
      else if (artistLower.includes(q)) score += 35;

      if (albumLower === q) score += 50;
      else if (albumLower.includes(q)) score += 25;
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
