import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light' | 'oled';

export interface AccentColor {
  name: string;
  value: string;
}

export const ACCENT_PRESETS: AccentColor[] = [
  { name: 'Green',  value: '#1db954' },
  { name: 'Blue',   value: '#1e88e5' },
  { name: 'Purple', value: '#9c27b0' },
  { name: 'Red',    value: '#e53935' },
  { name: 'Orange', value: '#ff6d00' },
  { name: 'Pink',   value: '#e91e63' },
  { name: 'Teal',   value: '#00897b' },
  { name: 'Yellow', value: '#fdd835' },
];

interface ThemeState {
  mode: ThemeMode;
  accent: string;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
}

const STORAGE_KEY = 'opentunes_theme';

function loadFromStorage(): { mode: ThemeMode; accent: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mode: parsed.mode || 'dark',
        accent: parsed.accent || '#1db954',
      };
    }
  } catch { /* ignore */ }
  return { mode: 'dark', accent: '#1db954' };
}

function saveToStorage(mode: ThemeMode, accent: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, accent }));
}

const initial = loadFromStorage();

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initial.mode,
  accent: initial.accent,
  setMode: (mode) => set((s) => {
    saveToStorage(mode, s.accent);
    return { mode };
  }),
  setAccent: (accent) => set((s) => {
    saveToStorage(s.mode, accent);
    return { accent };
  }),
}));
