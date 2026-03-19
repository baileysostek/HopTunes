import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Song } from '../types/song';
import { usePlayerStore } from '../store/playerStore';
import { useContextMenuStore } from './SongContextMenu';
import { isMobile } from '../utils/platform';
import ExplicitBadge, { stripExplicitTag } from './ExplicitBadge';

interface TrackRowProps {
  track: Song;
  index: number;
  onPlay: () => void;
  departing?: boolean;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const TrackRow: React.FC<TrackRowProps> = ({ track, index, onPlay, departing }) => {
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const showContextMenu = useContextMenuStore(s => s.show);
  const isActive = currentTrack?.path === track.path;
  const theme = useTheme();
  const mobile = isMobile();

  const { clean: titleClean, isExplicit } = stripExplicitTag(track.title);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showContextMenu(track, e.clientX, e.clientY);
  };

  return (
    <Box
      onClick={departing ? undefined : onPlay}
      onContextMenu={departing ? undefined : handleContextMenu}
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 0.75,
        px: 1.5,
        borderRadius: 1,
        cursor: departing ? 'default' : 'pointer',
        color: isActive ? 'primary.main' : 'text.secondary',
        transition: 'background 0.15s',
        '&:hover': {
          bgcolor: departing ? undefined : 'divider',
          color: departing ? undefined : (isActive ? 'primary.main' : 'text.primary'),
        },
        ...(departing && {
          '@keyframes trackShrinkOut': {
            '0%': { opacity: 1, transform: 'scaleY(1)' },
            '100%': { opacity: 0, transform: 'scaleY(0)' },
          },
          transformOrigin: 'top',
          animation: 'trackShrinkOut 350ms ease-out forwards',
          pointerEvents: 'none',
        }),
      }}
    >
      <Typography sx={{
        width: 28,
        fontSize: 13,
        textAlign: 'right',
        mr: 2,
        color: 'inherit',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {index}
      </Typography>
      <Typography sx={{
        flex: 1,
        fontSize: 14,
        fontWeight: isActive ? 600 : 400,
        color: 'inherit',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
      }}>
        {titleClean}
        {isExplicit && <ExplicitBadge size={13} />}
      </Typography>
      {!mobile && (
        <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
          <Typography sx={{
            fontSize: 11,
            color: 'text.disabled',
            fontFamily: 'monospace',
          }}>
            {track.hash?.slice(0, 8)}
          </Typography>
        </Box>
      )}
      <Typography sx={{
        fontSize: 13,
        ml: 2,
        color: 'text.secondary',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {formatDuration(track.duration)}
      </Typography>
      <Box sx={{ width: 21, ml: 1, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
        {track.origin && (
          <Tooltip title={track.origin.deviceName} arrow placement="top">
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', color: 'text.disabled' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
              </svg>
            </Box>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
};

export default TrackRow;
