import React from 'react';
import { create } from 'zustand';
import { Box, Typography } from '@mui/material';

interface ReindexState {
  active: boolean;
  found: number;
  start: () => void;
  stop: () => void;
  setFound: (count: number) => void;
}

export const useReindexStore = create<ReindexState>((set) => ({
  active: false,
  found: 0,
  start: () => set({ active: true, found: 0 }),
  stop: () => set({ active: false, found: 0 }),
  setFound: (count) => set({ active: true, found: count }),
}));

const ReindexOverlay: React.FC = () => {
  const active = useReindexStore(s => s.active);
  const found = useReindexStore(s => s.found);

  if (!active) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        // Start below the titlebar area so window controls remain accessible
        top: 32,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1400,
        gap: 3,
      }}
    >
      {/* Spinner */}
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.1)',
          borderTopColor: '#1db954',
          animation: 'reindex-spin 0.8s linear infinite',
          '@keyframes reindex-spin': {
            '0%': { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' },
          },
        }}
      />
      <Typography sx={{
        fontSize: 18,
        fontWeight: 600,
        color: 'white',
        letterSpacing: 0.5,
      }}>
        Reindexing Library
      </Typography>
      <Typography sx={{
        fontSize: 13,
        color: 'rgba(255,255,255,0.4)',
      }}>
        {found > 0
          ? `Found ${found.toLocaleString()} song${found === 1 ? '' : 's'}...`
          : 'Scanning folders for music files...'}
      </Typography>
    </Box>
  );
};

export default ReindexOverlay;
