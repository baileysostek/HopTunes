import React from 'react';
import { create } from 'zustand';
import { Box, Typography } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';

interface ReindexState {
  active: boolean;
  found: number;
  added: number;
  skipped: number;
  start: () => void;
  stop: () => void;
  setProgress: (found: number, added: number, skipped: number) => void;
}

export const useReindexStore = create<ReindexState>((set) => ({
  active: false,
  found: 0,
  added: 0,
  skipped: 0,
  start: () => set({ active: true, found: 0, added: 0, skipped: 0 }),
  stop: () => set({ active: false, found: 0, added: 0, skipped: 0 }),
  setProgress: (found, added, skipped) => set({ active: true, found, added, skipped }),
}));

const ReindexOverlay: React.FC = () => {
  const active = useReindexStore(s => s.active);
  const found = useReindexStore(s => s.found);
  const added = useReindexStore(s => s.added);
  const skipped = useReindexStore(s => s.skipped);
  const theme = useTheme();

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
          border: '3px solid',
          borderColor: 'divider',
          borderTopColor: theme.palette.primary.main,
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
        color: 'text.primary',
        letterSpacing: 0.5,
      }}>
        Indexing Library
      </Typography>
      <Typography sx={{
        fontSize: 13,
        color: 'text.secondary',
      }}>
        {found > 0
          ? `Found ${found.toLocaleString()} song${found === 1 ? '' : 's'}...`
          : 'Scanning folders for music files...'}
      </Typography>

      {/* Stats row — shows new vs already-in-library counts */}
      {(added > 0 || skipped > 0) && (
        <Box sx={{ display: 'flex', gap: 3, mt: 1 }}>
          {added > 0 && (
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{
                fontSize: 24,
                fontWeight: 700,
                color: theme.palette.primary.main,
                lineHeight: 1,
              }}>
                {added.toLocaleString()}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
                new
              </Typography>
            </Box>
          )}
          {skipped > 0 && (
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{
                fontSize: 24,
                fontWeight: 700,
                color: alpha(theme.palette.text.primary, 0.4),
                lineHeight: 1,
              }}>
                {skipped.toLocaleString()}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
                already in library
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default ReindexOverlay;
