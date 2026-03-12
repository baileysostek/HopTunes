import { create } from 'zustand';
import axios from 'axios';
import { Song, getApiBase } from '../types/song';
import { AUDIO_PATH_PREFIX } from '../../shared/types';
import { mapHostSongRows } from '../../shared/federation';
import { isCapacitor } from '../utils/platform';

type LibrarySource = 'server' | 'local';

interface LibraryState {
  songs: Song[];
  loading: boolean;
  searchQuery: string;
  selectedArtist: string | null;
  source: LibrarySource;
  fetchLibrary: () => Promise<void>;
  hideSong: (song: Song) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedArtist: (artist: string | null) => void;
  switchToLocalLibrary: () => Promise<void>;
  switchToServerLibrary: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  loading: false,
  searchQuery: '',
  selectedArtist: null,
  source: 'server' as LibrarySource,

  fetchLibrary: async () => {
    set({ loading: true });
    try {
      const response = await axios.get(`${getApiBase()}/api/library`);
      set({ songs: response.data, loading: false, source: 'server' });
    } catch (error) {
      console.error('Failed to fetch library:', error);
      set({ loading: false });
      // If fetch fails on Capacitor, try local library
      if (isCapacitor()) {
        get().switchToLocalLibrary();
      }
    }
  },

  hideSong: async (song) => {
    const diskPath = decodeURIComponent(song.path.replace(AUDIO_PATH_PREFIX, ''));
    try {
      await axios.post(`${getApiBase()}/api/library/hide`, { path: diskPath });
      // Optimistically remove from local state (server also broadcasts updated library)
      set({ songs: get().songs.filter(s => s.path !== song.path) });
    } catch (err) {
      console.error('Failed to hide song:', err);
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedArtist: (artist) => set({ selectedArtist: artist }),

  switchToLocalLibrary: async () => {
    if (!isCapacitor()) return;
    try {
      // Dynamically import to avoid loading Capacitor SQLite on desktop
      const { edgeDatabase } = await import('../services/edgeDatabase');
      const rows = await edgeDatabase.getAllSongs();
      const songs = mapHostSongRows(rows);
      set({ songs, loading: false, source: 'local' });
      console.log(`[Library] Switched to local library (${songs.length} songs)`);
    } catch (err) {
      console.error('[Library] Failed to load local library:', err);
      set({ songs: [], loading: false, source: 'local' });
    }
  },

  switchToServerLibrary: () => {
    // Called when reconnecting to the host — the welcome message will populate songs
    set({ source: 'server' });
  },
}));
