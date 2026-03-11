import React, { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Box, Typography } from '@mui/material';
import { Song } from '../types/song';
import { AUDIO_PATH_PREFIX } from '../../shared/types';
import { usePlayerStore } from '../store/playerStore';
import { useLibraryStore } from '../store/libraryStore';
import { isElectron } from '../utils/platform';

interface ContextMenuState {
  song: Song | null;
  x: number;
  y: number;
  visible: boolean;
  show: (song: Song, x: number, y: number) => void;
  hide: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  song: null,
  x: 0,
  y: 0,
  visible: false,
  show: (song, x, y) => set({ song, x, y, visible: true }),
  hide: () => set({ visible: false }),
}));

function getExplorerName(): string {
  const platform = navigator.platform?.toLowerCase() || '';
  if (platform.includes('mac')) return 'Finder';
  if (platform.includes('linux')) return 'File Manager';
  return 'Explorer';
}

const MenuItem: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <Box
    onClick={onClick}
    sx={{
      px: 2,
      py: 0.75,
      cursor: 'pointer',
      '&:hover': {
        bgcolor: 'action.selected',
      },
    }}
  >
    <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{label}</Typography>
  </Box>
);

const SongContextMenu: React.FC = () => {
  const { song, x, y, visible, hide } = useContextMenuStore();
  const play = usePlayerStore(s => s.play);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const hideSong = useLibraryStore(s => s.hideSong);
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp menu position so it stays within the viewport
  useEffect(() => {
    if (!visible || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    let adjustedX = x;
    let adjustedY = y;
    if (x + rect.width > window.innerWidth) {
      adjustedX = window.innerWidth - rect.width - 4;
    }
    if (y + rect.height > window.innerHeight) {
      adjustedY = window.innerHeight - rect.height - 4;
    }
    if (adjustedX !== x || adjustedY !== y) {
      el.style.left = `${adjustedX}px`;
      el.style.top = `${adjustedY}px`;
    }
  }, [visible, x, y]);

  // Close on any click or right-click outside
  useEffect(() => {
    if (!visible) return;
    const handleClose = () => hide();
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    // Defer listeners so the triggering right-click doesn't immediately close the menu
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClose);
      window.addEventListener('contextmenu', handleClose);
      window.addEventListener('keydown', handleEscape);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClose);
      window.removeEventListener('contextmenu', handleClose);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [visible, hide]);

  if (!visible || !song) return null;

  const handlePlay = () => {
    play(song);
    hide();
  };

  const handleAddToQueue = () => {
    addToQueue(song);
    hide();
  };

  const handleHide = () => {
    hideSong(song);
    hide();
  };

  const handleShowInExplorer = () => {
    // song.path is an API path like "/api/audio/C%3A%5CUsers%5C..." — extract and decode the real disk path
    const diskPath = decodeURIComponent(song.path.replace(AUDIO_PATH_PREFIX, ''));
    window.electronAPI.showItemInFolder(diskPath);
    hide();
  };

  return (
    <Box
      ref={menuRef}
      sx={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        bgcolor: 'background.paper',
        borderRadius: 1,
        py: 0.5,
        minWidth: 180,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <MenuItem label="Play" onClick={handlePlay} />
      <MenuItem label="Add to Queue" onClick={handleAddToQueue} />
      <MenuItem label="Hide Song" onClick={handleHide} />
      {isElectron() && (
        <MenuItem label={`Show in ${getExplorerName()}`} onClick={handleShowInExplorer} />
      )}
    </Box>
  );
};

export default SongContextMenu;
