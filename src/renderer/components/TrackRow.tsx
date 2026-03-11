import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Song } from '../types/song';
import { usePlayerStore } from '../store/playerStore';
import { useContextMenuStore } from './SongContextMenu';

interface TrackRowProps {
  track: Song;
  index: number;
  onPlay: () => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const TrackRow: React.FC<TrackRowProps> = ({ track, index, onPlay }) => {
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const showContextMenu = useContextMenuStore(s => s.show);
  const isActive = currentTrack?.path === track.path;
  const theme = useTheme();

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showContextMenu(track, e.clientX, e.clientY);
  };

  return (
    <Box
      onClick={onPlay}
      onContextMenu={handleContextMenu}
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 0.75,
        px: 1.5,
        borderRadius: 1,
        cursor: 'pointer',
        color: isActive ? 'primary.main' : 'text.secondary',
        transition: 'background 0.15s',
        '&:hover': {
          bgcolor: 'divider',
          color: isActive ? 'primary.main' : 'text.primary',
        },
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
      }}>
        {track.title}
      </Typography>
      <Typography sx={{
        fontSize: 11,
        ml: 2,
        color: 'text.disabled',
        fontFamily: 'monospace',
      }}>
        {track.hash?.slice(0, 8)}
      </Typography>
      <Typography sx={{
        fontSize: 13,
        ml: 2,
        color: 'text.secondary',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {formatDuration(track.duration)}
      </Typography>
    </Box>
  );
};

export default TrackRow;
