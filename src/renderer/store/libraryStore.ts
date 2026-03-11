import { create } from 'zustand';
import axios from 'axios';
import { Song, getApiBase } from '../types/song';
import { AUDIO_PATH_PREFIX } from '../../shared/types';

interface LibraryState {
  songs: Song[];
  loading: boolean;
  searchQuery: string;
  selectedArtist: string | null;
  fetchLibrary: () => Promise<void>;
  hideSong: (song: Song) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedArtist: (artist: string | null) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  loading: false,
  searchQuery: '',
  selectedArtist: null,

  fetchLibrary: async () => {
    set({ loading: true });
    try {
      const response = await axios.get(`${getApiBase()}/api/library`);
      set({ songs: response.data, loading: false });
    } catch (error) {
      console.error('Failed to fetch library:', error);
      set({ loading: false });
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
}));
