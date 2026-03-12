import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Box, LinearProgress, SvgIcon, Typography } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';

const CheckIcon: React.FC<{ sx?: object }> = ({ sx }) => (
  <SvgIcon sx={sx} viewBox="0 0 24 24">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-5.83l6.59-6.59L18 9l-8 8-4-4 1.41-1.41L10 14.17z" />
  </SvgIcon>
);

type SyncPhase = 'scanning' | 'hashing' | 'syncing' | 'done';

interface SyncState {
  active: boolean;
  phase: SyncPhase;
  deviceName: string;
  songCount: number;
  hashProgress: number; // 0–1
  hashTotal: number;
  hashCompleted: number;
  startScan: () => void;
  startHashing: (total: number) => void;
  setHashProgress: (completed: number) => void;
  /** Host-side: an edge device is syncing with us. */
  startEdgeSync: (deviceName: string, songCount: number) => void;
  /** Host-side: edge device sync is complete. */
  finishEdgeSync: (deviceName: string) => void;
  finish: () => void;
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null;
const DISMISS_DELAY = 3000;

export const useSyncStore = create<SyncState>((set, get) => ({
  active: false,
  phase: 'scanning',
  deviceName: '',
  songCount: 0,
  hashProgress: 0,
  hashTotal: 0,
  hashCompleted: 0,
  startScan: () => {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    set({ active: true, phase: 'scanning', deviceName: '', songCount: 0, hashProgress: 0, hashTotal: 0, hashCompleted: 0 });
  },
  startHashing: (total) => set({ phase: 'hashing', hashTotal: total, hashCompleted: 0, hashProgress: 0 }),
  setHashProgress: (completed) => set((s) => ({
    hashCompleted: completed,
    hashProgress: s.hashTotal > 0 ? completed / s.hashTotal : 0,
  })),
  startEdgeSync: (deviceName, songCount) => {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    set({ active: true, phase: 'syncing', deviceName, songCount });
  },
  finishEdgeSync: (deviceName) => {
    const state = get();
    if (state.phase === 'syncing' && state.deviceName === deviceName) {
      set({ phase: 'done' });
      dismissTimer = setTimeout(() => {
        dismissTimer = null;
        set({ active: false });
      }, DISMISS_DELAY);
    }
  },
  finish: () => {
    set({ phase: 'done' });
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      set({ active: false });
    }, DISMISS_DELAY);
  },
}));

const SyncBanner: React.FC = () => {
  const active = useSyncStore(s => s.active);
  const phase = useSyncStore(s => s.phase);
  const deviceName = useSyncStore(s => s.deviceName);
  const songCount = useSyncStore(s => s.songCount);
  const hashProgress = useSyncStore(s => s.hashProgress);
  const hashTotal = useSyncStore(s => s.hashTotal);
  const hashCompleted = useSyncStore(s => s.hashCompleted);
  const theme = useTheme();

  // Animate the dismiss countdown as a draining progress bar
  const [dismissProgress, setDismissProgress] = useState(100);
  useEffect(() => {
    if (phase !== 'done') {
      setDismissProgress(100);
      return;
    }
    // Animate from 100 → 0 over DISMISS_DELAY
    setDismissProgress(100);
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.max(0, 100 - (elapsed / DISMISS_DELAY) * 100);
      setDismissProgress(pct);
      if (pct > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Collapse animation — render but shrink out
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (active) {
      setVisible(true);
    } else {
      // Already hidden, no transition needed
      setVisible(false);
    }
  }, [active]);

  if (!visible && !active) return null;

  const isDone = phase === 'done';
  const accentColor = isDone ? theme.palette.success.main : theme.palette.primary.main;

  let label: string;
  switch (phase) {
    case 'scanning':
      label = 'Scanning local library...';
      break;
    case 'hashing':
      label = `Computing hashes (${hashCompleted}/${hashTotal})`;
      break;
    case 'syncing':
      label = songCount > 0
        ? `Syncing ${songCount} songs from ${deviceName}...`
        : `Syncing with ${deviceName}...`;
      break;
    case 'done':
      label = songCount > 0
        ? `Synced ${songCount} songs from ${deviceName}`
        : `Synced with ${deviceName}`;
      break;
    default:
      label = 'Syncing...';
  }

  const isIndeterminate = phase === 'scanning' || phase === 'syncing';

  return (
    <Box
      sx={{
        overflow: 'hidden',
        transition: 'max-height 0.3s ease-out, opacity 0.3s ease-out',
        maxHeight: active ? 48 : 0,
        opacity: active ? 1 : 0,
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          bgcolor: alpha(accentColor, 0.1),
          borderBottom: `1px solid ${alpha(accentColor, 0.2)}`,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          minHeight: 36,
          transition: 'background-color 0.4s ease, border-color 0.4s ease',
        }}
      >
        {isDone && (
          <CheckIcon
            sx={{
              fontSize: 18,
              color: 'success.main',
              animation: 'syncCheckPop 0.3s ease-out',
              '@keyframes syncCheckPop': {
                '0%': { transform: 'scale(0)', opacity: 0 },
                '60%': { transform: 'scale(1.2)' },
                '100%': { transform: 'scale(1)', opacity: 1 },
              },
            }}
          />
        )}
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 500,
            color: isDone ? 'success.main' : 'text.secondary',
            whiteSpace: 'nowrap',
            transition: 'color 0.4s ease',
          }}
        >
          {label}
        </Typography>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {isDone ? (
            <LinearProgress
              variant="determinate"
              value={dismissProgress}
              sx={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.success.main, 0.15),
                '& .MuiLinearProgress-bar': {
                  borderRadius: 2,
                  bgcolor: 'success.main',
                  transition: 'none',
                },
              }}
            />
          ) : (
            <LinearProgress
              variant={isIndeterminate ? 'indeterminate' : 'determinate'}
              value={hashProgress * 100}
              sx={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.15),
                '& .MuiLinearProgress-bar': {
                  borderRadius: 2,
                },
              }}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default SyncBanner;
