import React from 'react';
import { Box, Typography } from '@mui/material';
import { Song } from '../types/song';
import { usePlayerStore } from '../store/playerStore';

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
  const isActive = currentTrack?.path === track.path;

  return (
    <Box
      onClick={onPlay}
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 0.75,
        px: 1.5,
        borderRadius: 1,
        cursor: 'pointer',
        color: isActive ? '#1db954' : 'rgba(255,255,255,0.7)',
        transition: 'background 0.15s',
        '&:hover': {
          bgcolor: 'rgba(255,255,255,0.08)',
          color: isActive ? '#1db954' : 'white',
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
        fontSize: 13,
        ml: 2,
        color: 'rgba(255,255,255,0.4)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {formatDuration(track.duration)}
      </Typography>
    </Box>
  );
};

export default TrackRow;
