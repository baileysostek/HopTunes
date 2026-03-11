import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Button, Checkbox } from '@mui/material';
import axios from 'axios';
import { Song, getApiBase } from '../types/song';

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
  </svg>
);

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface AlbumEditModalProps {
  artist: string;
  album: string;
  open: boolean;
  onClose: () => void;
}

const AlbumEditModal: React.FC<AlbumEditModalProps> = ({ artist, album, open, onClose }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [hiddenMap, setHiddenMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(false);

  const fetchSongs = useCallback(async () => {
    if (!artist || !album) return;
    setLoading(true);
    try {
      const res = await axios.get(`${getApiBase()}/api/library/album-songs`, {
        params: { artist, album },
      });
      const data: Song[] = res.data;
      setSongs(data);
      const map: Record<string, boolean> = {};
      for (const s of data) {
        map[s.path] = s.hidden;
      }
      setHiddenMap(map);
    } catch (err) {
      console.error('Failed to fetch album songs:', err);
    } finally {
      setLoading(false);
    }
  }, [artist, album]);

  useEffect(() => {
    if (open) {
      fetchSongs();
      setClosing(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [open, fetchSongs]);

  const triggerClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 300);
  }, [onClose]);

  const toggleHidden = (path: string) => {
    setHiddenMap(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const hasChanges = songs.some(s => s.hidden !== hiddenMap[s.path]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const changes = songs
        .filter(s => s.hidden !== hiddenMap[s.path])
        .map(s => ({ path: s.path, hidden: hiddenMap[s.path] }));
      await axios.post(`${getApiBase()}/api/library/set-hidden`, { songs: changes });
      triggerClose();
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!open && !closing) return null;

  const showContent = visible && !closing;

  return (
    <Box
      onClick={triggerClose}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: showContent ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0)',
        backdropFilter: showContent ? 'blur(8px)' : 'blur(0px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
        transition: 'background-color 0.3s ease, backdrop-filter 0.3s ease',
      }}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          bgcolor: '#1a1a1a',
          borderRadius: 3,
          position: 'relative',
          maxWidth: 620,
          width: '90%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          transform: showContent ? 'scale(1)' : 'scale(0.5)',
          opacity: showContent ? 1 : 0,
          transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease',
        }}
      >
        {/* Header */}
        <Box sx={{ px: 3, pt: 3, pb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Box>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'white' }}>
              {album}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              {artist} &middot; {songs.length} track{songs.length !== 1 ? 's' : ''}
            </Typography>
          </Box>
          <Box
            onClick={triggerClose}
            sx={{
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)',
              '&:hover': { color: 'white' },
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
          >
            <CloseIcon />
          </Box>
        </Box>

        {/* Song list */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2 }}>
          {loading ? (
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, py: 2 }}>Loading...</Typography>
          ) : songs.length === 0 ? (
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, py: 2 }}>No songs found.</Typography>
          ) : (
            <>
              {/* Column headers */}
              <Box sx={{ display: 'flex', alignItems: 'center', pb: 1, mb: 1, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <Box sx={{ width: 42 }}>
                  <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Visible
                  </Typography>
                </Box>
                <Box sx={{ width: 32 }}>
                  <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                    #
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, ml: 1.5 }}>
                  <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Title
                  </Typography>
                </Box>
                <Box sx={{ width: 80, ml: 1 }}>
                  <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Hash
                  </Typography>
                </Box>
                <Box sx={{ width: 50, textAlign: 'right' }}>
                  <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Time
                  </Typography>
                </Box>
              </Box>

              {songs.map((song, idx) => {
                const isHidden = hiddenMap[song.path] ?? song.hidden;
                return (
                  <Box
                    key={song.path}
                    onClick={() => toggleHidden(song.path)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      py: 0.5,
                      px: 0.5,
                      borderRadius: 1,
                      cursor: 'pointer',
                      opacity: isHidden ? 0.4 : 1,
                      transition: 'background 0.15s, opacity 0.15s',
                      '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.05)',
                      },
                    }}
                  >
                    <Box sx={{ width: 42, display: 'flex', justifyContent: 'center' }}>
                      <Checkbox
                        checked={!isHidden}
                        size="small"
                        sx={{
                          p: 0,
                          color: 'rgba(255,255,255,0.3)',
                          '&.Mui-checked': { color: '#1db954' },
                        }}
                      />
                    </Box>
                    <Typography sx={{
                      width: 32,
                      fontSize: 13,
                      textAlign: 'right',
                      color: 'rgba(255,255,255,0.4)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {idx + 1}
                    </Typography>
                    <Typography sx={{
                      flex: 1,
                      fontSize: 14,
                      color: isHidden ? 'rgba(255,255,255,0.4)' : 'white',
                      ml: 1.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textDecoration: isHidden ? 'line-through' : 'none',
                    }}>
                      {song.title}
                    </Typography>
                    <Typography sx={{
                      width: 80,
                      fontSize: 11,
                      ml: 1,
                      color: 'rgba(255,255,255,0.2)',
                      fontFamily: 'monospace',
                    }}>
                      {song.hash?.slice(0, 8)}
                    </Typography>
                    <Typography sx={{
                      width: 50,
                      fontSize: 13,
                      textAlign: 'right',
                      color: 'rgba(255,255,255,0.4)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {formatDuration(song.duration)}
                    </Typography>
                  </Box>
                );
              })}
            </>
          )}
        </Box>

        {/* Footer */}
        <Box sx={{
          px: 3,
          py: 2,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
        }}>
          <Button
            variant="outlined"
            size="small"
            onClick={triggerClose}
            sx={{
              color: 'rgba(255,255,255,0.6)',
              borderColor: 'rgba(255,255,255,0.15)',
              '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.05)' },
              textTransform: 'none',
              fontSize: 13,
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            sx={{
              bgcolor: '#1db954',
              '&:hover': { bgcolor: '#1ed760' },
              '&.Mui-disabled': { bgcolor: 'rgba(29,185,84,0.3)', color: 'rgba(255,255,255,0.4)' },
              textTransform: 'none',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default AlbumEditModal;
