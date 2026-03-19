import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, Button, Checkbox } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import axios from 'axios';
import { Song, getApiBase } from '../types/song';
import { useAlbumImage, invalidateAlbumImage } from '../hooks/useAlbumImage';
import { isElectron } from '../utils/platform';

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
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
  const theme = useTheme();
  const [songs, setSongs] = useState<Song[]>([]);
  const [hiddenMap, setHiddenMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [artDragging, setArtDragging] = useState(false);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [artChanged, setArtChanged] = useState(false);
  const [pendingArtBase64, setPendingArtBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentArt = useAlbumImage(artist, album);
  const displayArt = artPreview || currentArt;

  /** Read a File object as base64 and stage it for upload. */
  const stageImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setArtPreview(dataUrl);
      // Strip the data:image/...;base64, prefix to get raw base64
      const base64 = dataUrl.split(',')[1];
      setPendingArtBase64(base64);
      setArtChanged(true);
    };
    reader.readAsDataURL(file);
  }, []);

  /** Open the native file picker (Electron) or trigger the hidden input (web). */
  const handlePickImage = useCallback(async () => {
    if (isElectron() && window.electronAPI.selectImage) {
      const base64 = await window.electronAPI.selectImage();
      if (base64) {
        setArtPreview(`data:image/jpeg;base64,${base64}`);
        setPendingArtBase64(base64);
        setArtChanged(true);
      }
    } else {
      fileInputRef.current?.click();
    }
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) stageImageFile(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [stageImageFile]);

  /** Upload the staged art to the backend. */
  const uploadArt = useCallback(async () => {
    if (!pendingArtBase64) return;
    await axios.post(`${getApiBase()}/api/album-art/set`, {
      artist,
      album,
      data: pendingArtBase64,
    });
    invalidateAlbumImage(artist, album);
  }, [artist, album, pendingArtBase64]);

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
      setArtPreview(null);
      setPendingArtBase64(null);
      setArtChanged(false);
      setArtDragging(false);
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

  const hasChanges = artChanged || songs.some(s => s.hidden !== hiddenMap[s.path]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save art if changed
      if (artChanged && pendingArtBase64) {
        await uploadArt();
      }
      // Save song visibility changes
      const changes = songs
        .filter(s => s.hidden !== hiddenMap[s.path])
        .map(s => ({ path: s.path, hidden: hiddenMap[s.path] }));
      if (changes.length > 0) {
        await axios.post(`${getApiBase()}/api/library/set-hidden`, { songs: changes });
      }
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
          bgcolor: 'background.paper',
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
        {/* Hidden file input for non-Electron environments */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />

        {/* Header */}
        <Box sx={{ px: 3, pt: 3, pb: 2, display: 'flex', alignItems: 'flex-start', gap: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          {/* Album Art */}
          <Box
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setArtDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setArtDragging(false); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setArtDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) stageImageFile(file);
            }}
            onClick={handlePickImage}
            sx={{
              width: 80,
              height: 80,
              minWidth: 80,
              borderRadius: 2,
              overflow: 'hidden',
              position: 'relative',
              cursor: 'pointer',
              border: artDragging ? '2px dashed' : '2px solid transparent',
              borderColor: artDragging ? 'primary.main' : 'transparent',
              bgcolor: 'action.hover',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              '&:hover': {
                boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.4)}`,
              },
              '&:hover .art-edit-overlay': {
                opacity: 1,
              },
            }}
          >
            {displayArt ? (
              <Box
                component="img"
                src={displayArt}
                alt="Album art"
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill={theme.palette.text.disabled}>
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </Box>
            )}
            {/* Edit overlay */}
            <Box
              className="art-edit-overlay"
              sx={{
                position: 'absolute',
                inset: 0,
                bgcolor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: artDragging ? 1 : 0,
                transition: 'opacity 0.15s',
                color: 'white',
              }}
            >
              <EditIcon />
            </Box>
          </Box>

          {/* Title / Artist */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {album}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {artist} &middot; {songs.length} track{songs.length !== 1 ? 's' : ''}
            </Typography>
          </Box>

          {/* Close button */}
          <Box
            onClick={triggerClose}
            sx={{
              cursor: 'pointer',
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
              mt: 0.5,
            }}
          >
            <CloseIcon />
          </Box>
        </Box>

        {/* Song list */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2 }}>
          {loading ? (
            <Typography sx={{ color: 'text.secondary', fontSize: 14, py: 2 }}>Loading...</Typography>
          ) : songs.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', fontSize: 14, py: 2 }}>No songs found.</Typography>
          ) : (
            <>
              {/* Column headers */}
              <Box sx={{ display: 'flex', alignItems: 'center', pb: 1, mb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ width: 42 }}>
                  <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Visible
                  </Typography>
                </Box>
                <Box sx={{ width: 32 }}>
                  <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                    #
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, ml: 1.5 }}>
                  <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Title
                  </Typography>
                </Box>
                <Box sx={{ width: 80, ml: 1 }}>
                  <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Hash
                  </Typography>
                </Box>
                <Box sx={{ width: 50, textAlign: 'right' }}>
                  <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 1 }}>
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
                        bgcolor: 'action.hover',
                      },
                    }}
                  >
                    <Box sx={{ width: 42, display: 'flex', justifyContent: 'center' }}>
                      <Checkbox
                        checked={!isHidden}
                        size="small"
                        sx={{
                          p: 0,
                          color: 'text.disabled',
                          '&.Mui-checked': { color: 'primary.main' },
                        }}
                      />
                    </Box>
                    <Typography sx={{
                      width: 32,
                      fontSize: 13,
                      textAlign: 'right',
                      color: 'text.secondary',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {idx + 1}
                    </Typography>
                    <Typography sx={{
                      flex: 1,
                      fontSize: 14,
                      color: isHidden ? 'text.secondary' : 'text.primary',
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
                      color: 'text.disabled',
                      fontFamily: 'monospace',
                    }}>
                      {song.hash?.slice(0, 8)}
                    </Typography>
                    <Typography sx={{
                      width: 50,
                      fontSize: 13,
                      textAlign: 'right',
                      color: 'text.secondary',
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
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
        }}>
          <Button
            variant="outlined"
            size="small"
            onClick={triggerClose}
            sx={{
              color: 'text.secondary',
              borderColor: 'divider',
              '&:hover': { borderColor: 'text.disabled', bgcolor: 'action.hover' },
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
              bgcolor: 'primary.main',
              '&:hover': { bgcolor: 'primary.light' },
              '&.Mui-disabled': { bgcolor: alpha(theme.palette.primary.main, 0.3), color: 'text.secondary' },
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
