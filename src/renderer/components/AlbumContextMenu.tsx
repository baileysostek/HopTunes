import React, { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Box, Typography } from '@mui/material';

interface AlbumContextMenuState {
  artist: string;
  album: string;
  x: number;
  y: number;
  visible: boolean;
  show: (artist: string, album: string, x: number, y: number) => void;
  hide: () => void;
}

export const useAlbumContextMenuStore = create<AlbumContextMenuState>((set) => ({
  artist: '',
  album: '',
  x: 0,
  y: 0,
  visible: false,
  show: (artist, album, x, y) => set({ artist, album, x, y, visible: true }),
  hide: () => set({ visible: false }),
}));

const MenuItem: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <Box
    onClick={onClick}
    sx={{
      px: 2,
      py: 0.75,
      cursor: 'pointer',
      '&:hover': {
        bgcolor: 'rgba(255,255,255,0.1)',
      },
    }}
  >
    <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{label}</Typography>
  </Box>
);

interface AlbumContextMenuProps {
  onEditAlbum: (artist: string, album: string) => void;
}

const AlbumContextMenu: React.FC<AlbumContextMenuProps> = ({ onEditAlbum }) => {
  const { artist, album, x, y, visible, hide } = useAlbumContextMenuStore();
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

  if (!visible) return null;

  const handleEdit = () => {
    onEditAlbum(artist, album);
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
        bgcolor: '#282828',
        borderRadius: 1,
        py: 0.5,
        minWidth: 180,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <MenuItem label="Edit Album" onClick={handleEdit} />
    </Box>
  );
};

export default AlbumContextMenu;
