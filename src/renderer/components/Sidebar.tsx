import React, { useMemo } from 'react';
import { Box, Typography, List, ListItemButton, ListItemText } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/libraryStore';
import { getMediaUrl } from '../types/song';

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
  </svg>
);

const ConnectIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z"/>
  </svg>
);

interface SidebarProps {
  onConnectClick?: () => void;
  onSettingsClick?: () => void;
  onNavigate?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onConnectClick, onSettingsClick, onNavigate }) => {
  const songs = useLibraryStore(s => s.songs);
  const selectedArtist = useLibraryStore(s => s.selectedArtist);
  const setSelectedArtist = useLibraryStore(s => s.setSelectedArtist);
  const navigate = useNavigate();

  // Build artist list with their first available album art
  const artists = useMemo(() => {
    const artistMap = new Map<string, string | null>();
    for (const song of songs) {
      if (!artistMap.has(song.artist)) {
        artistMap.set(song.artist, song.art);
      } else if (!artistMap.get(song.artist) && song.art) {
        artistMap.set(song.artist, song.art);
      }
    }
    return [...artistMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [songs]);

  return (
    <Box sx={{
      width: 240,
      minWidth: 240,
      bgcolor: 'background.default',
      borderRight: '1px solid',
      borderRightColor: 'divider',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* App title — draggable like a title bar */}
      <Box sx={{ px: 2.5, pt: 2.5, pb: 1, WebkitAppRegion: 'drag' }}>
        <Typography sx={{ fontSize: 22, fontWeight: 800, color: 'text.primary', letterSpacing: -0.5 }}>
          OpenTunes
        </Typography>
      </Box>

      {/* Section label */}
      <Box sx={{ px: 2.5, py: 1 }}>
        <Typography sx={{
          fontSize: 11,
          fontWeight: 700,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
          Artists
        </Typography>
      </Box>

      {/* Artist list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <List disablePadding sx={{ px: 1 }}>
          {/* All Artists option */}
          <ListItemButton
            selected={selectedArtist === null}
            onClick={() => { setSelectedArtist(null); navigate('/'); onNavigate?.(); }}
            sx={{
              borderRadius: 1,
              mb: 0.25,
              py: 0.75,
              '&.Mui-selected': {
                bgcolor: 'action.selected',
                '&:hover': { bgcolor: 'action.selected' },
              },
              '&:hover': { bgcolor: 'divider' },
            }}
          >
            <Box sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              bgcolor: selectedArtist === null ? 'primary.main' : 'action.selected',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mr: 1.5,
              flexShrink: 0,
              color: selectedArtist === null ? 'text.primary' : 'text.secondary',
              transition: 'all 0.15s',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
              </svg>
            </Box>
            <ListItemText
              primary="All Artists"
              primaryTypographyProps={{
                fontSize: 14,
                fontWeight: selectedArtist === null ? 600 : 400,
                color: 'text.primary',
              }}
            />
          </ListItemButton>

          {artists.map(([artist, artUrl]) => (
            <ListItemButton
              key={artist}
              selected={selectedArtist === artist}
              onClick={() => { setSelectedArtist(artist); navigate('/'); onNavigate?.(); }}
              sx={{
                borderRadius: 1,
                mb: 0.25,
                py: 0.75,
                '&.Mui-selected': {
                  bgcolor: 'action.selected',
                  '&:hover': { bgcolor: 'action.selected' },
                },
                '&:hover': { bgcolor: 'divider' },
              }}
            >
              <Box sx={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                bgcolor: 'background.paper',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mr: 1.5,
                flexShrink: 0,
              }}>
                {artUrl ? (
                  <Box
                    component="img"
                    src={getMediaUrl(artUrl)}
                    alt={artist}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <Typography sx={{ fontSize: 14, color: 'text.secondary', fontWeight: 600 }}>
                    {artist.charAt(0).toUpperCase()}
                  </Typography>
                )}
              </Box>
              <ListItemText
                primary={artist}
                primaryTypographyProps={{
                  fontSize: 14,
                  fontWeight: selectedArtist === artist ? 600 : 400,
                  color: 'text.primary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>

      {/* Bottom: song count + connect + settings */}
      <Box sx={{ px: 2.5, py: 2, borderTop: '1px solid', borderTopColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
          {songs.length} song{songs.length !== 1 ? 's' : ''}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {onConnectClick && (
            <Box
              onClick={onConnectClick}
              sx={{
                cursor: 'pointer',
                color: 'text.disabled',
                '&:hover': { color: 'primary.main' },
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.15s',
              }}
            >
              <ConnectIcon />
            </Box>
          )}
          <Box
            onClick={onSettingsClick}
            sx={{
              cursor: 'pointer',
              color: 'text.disabled',
              '&:hover': { color: 'text.secondary' },
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
          >
            <SettingsIcon />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Sidebar;
