import { create } from 'zustand';
import axios from 'axios';
import { Song, getApiBase } from '../types/song';

interface LibraryState {
  songs: Song[];
  loading: boolean;
  searchQuery: string;
  selectedArtist: string | null;
  fetchLibrary: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedArtist: (artist: string | null) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
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

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedArtist: (artist) => set({ selectedArtist: artist }),
}));
