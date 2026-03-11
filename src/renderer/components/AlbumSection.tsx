import React from 'react';
import { Box, Typography } from '@mui/material';
import TrackRow from './TrackRow';
import { Song, getMediaUrl } from '../types/song';
import { usePlayerStore } from '../store/playerStore';
import { useAlbumImage } from '../hooks/useAlbumImage';
import { useAlbumContextMenuStore } from './AlbumContextMenu';

interface AlbumSectionProps {
  albumName: string;
  tracks: Song[];
  artUrl: string | null;
  artistName: string;
}

function formatTotalDuration(songs: Song[]): string {
  const totalSeconds = songs.reduce((sum, s) => sum + (s.duration || 0), 0);
  if (totalSeconds === 0) return '';
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const AlbumSection: React.FC<AlbumSectionProps> = ({ albumName, tracks, artUrl, artistName }) => {
  const play = usePlayerStore(s => s.play);
  const showAlbumMenu = useAlbumContextMenuStore(s => s.show);
  const externalArt = useAlbumImage(artUrl ? '' : artistName, artUrl ? '' : albumName);

  const sortedTracks = [...tracks].sort((a, b) => {
    if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
    return a.title.localeCompare(b.title);
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showAlbumMenu(artistName, albumName, e.clientX, e.clientY);
  };

  return (
    <Box
      onContextMenu={handleContextMenu}
      sx={{
        display: 'flex',
        mb: 2,
        bgcolor: 'rgba(255,255,255,0.03)',
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'background 0.2s',
        '&:hover': {
          bgcolor: 'rgba(255,255,255,0.05)',
        },
      }}
    >
      {/* Album Art */}
      <Box sx={{
        width: 160,
        minWidth: 160,
        minHeight: 160,
        bgcolor: '#1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        alignSelf: 'flex-start',
      }}>
        {artUrl ? (
          <Box
            component="img"
            src={getMediaUrl(artUrl)}
            alt={albumName}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : externalArt ? (
          <Box
            component="img"
            src={externalArt}
            alt={albumName}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Box sx={{ color: 'rgba(255,255,255,0.2)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </Box>
        )}
      </Box>

      {/* Track List */}
      <Box sx={{ flex: 1, py: 1.5, px: 2, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'white', fontSize: 24 }}>
            {albumName}
          </Typography>
          <Box
            onClick={() => play(sortedTracks[0], sortedTracks)}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: '#1db954',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              opacity: 0.85,
              transition: 'opacity 0.15s, transform 0.1s',
              '&:hover': { opacity: 1, transform: 'scale(1.08)' },
              ml: 'auto',
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="white">
              <polygon points="3,1 13,8 3,15" />
            </svg>
          </Box>
        </Box>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', mb: 1 }}>
          {sortedTracks.length} track{sortedTracks.length !== 1 ? 's' : ''}
          {formatTotalDuration(sortedTracks) && ` \u00B7 ${formatTotalDuration(sortedTracks)}`}
        </Typography>
        {sortedTracks.map((track, idx) => (
          <TrackRow
            key={track.path}
            track={track}
            index={idx + 1}
            onPlay={() => play(track, sortedTracks)}
          />
        ))}
      </Box>
    </Box>
  );
};

export default AlbumSection;
