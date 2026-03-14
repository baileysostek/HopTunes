import React, { useRef, useEffect, useState } from 'react';
import { create } from 'zustand';
import { Box, Typography } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';

const DISMISS_DURATION = 4000;

interface ImportedSong {
  title: string;
  artist: string;
  album: string;
  isNew: boolean;
}

interface FolderImportState {
  active: boolean;
  songs: ImportedSong[];
  added: number;
  skipped: number;
  done: boolean;
  folderName: string;
  start: () => void;
  addSong: (song: ImportedSong) => void;
  finish: (folderName: string, added: number, skipped: number) => void;
  reset: () => void;
}

export const useFolderImportStore = create<FolderImportState>((set) => ({
  active: false,
  songs: [],
  added: 0,
  skipped: 0,
  done: false,
  folderName: '',
  start: () => set({ active: true, songs: [], added: 0, skipped: 0, done: false, folderName: '' }),
  addSong: (song) => set((s) => ({
    songs: [...s.songs, song],
    added: s.added + (song.isNew ? 1 : 0),
    skipped: s.skipped + (song.isNew ? 0 : 1),
  })),
  finish: (folderName, added, skipped) => set({ done: true, folderName, added, skipped }),
  reset: () => set({ active: false, songs: [], added: 0, skipped: 0, done: false, folderName: '' }),
}));

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
  </svg>
);

const FolderImportOverlay: React.FC = () => {
  const active = useFolderImportStore(s => s.active);
  const songs = useFolderImportStore(s => s.songs);
  const added = useFolderImportStore(s => s.added);
  const skipped = useFolderImportStore(s => s.skipped);
  const done = useFolderImportStore(s => s.done);
  const folderName = useFolderImportStore(s => s.folderName);
  const reset = useFolderImportStore(s => s.reset);
  const theme = useTheme();
  const listRef = useRef<HTMLDivElement>(null);

  // Animate in/out
  const [visible, setVisible] = useState(false);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      // Trigger grow-in on next frame
      requestAnimationFrame(() => requestAnimationFrame(() => setShowContent(true)));
    } else {
      setShowContent(false);
      // Wait for shrink-out transition before unmounting
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [active]);

  // Auto-scroll to bottom as songs arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [songs.length]);

  // Auto-dismiss after completion (with countdown bar)
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => {
        reset();
      }, DISMISS_DURATION);
      return () => clearTimeout(timer);
    }
  }, [done, reset]);

  if (!visible) return null;

  // Group songs by album
  const albumMap = new Map<string, ImportedSong[]>();
  for (const song of songs) {
    const key = `${song.artist} — ${song.album}`;
    if (!albumMap.has(key)) albumMap.set(key, []);
    albumMap.get(key)!.push(song);
  }

  return (
    <Box
      onClick={done ? reset : undefined}
      sx={{
        position: 'fixed',
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
        cursor: done ? 'pointer' : 'default',
        opacity: showContent ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      <Box sx={{
        width: '90%',
        maxWidth: 480,
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        bgcolor: 'background.paper',
        borderRadius: 3,
        p: 3,
        overflow: 'hidden',
        transform: showContent ? 'scale(1)' : 'scale(0.5)',
        opacity: showContent ? 1 : 0,
        transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease',
      }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center' }}>
          {!done && (
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '3px solid',
                borderColor: 'divider',
                borderTopColor: theme.palette.primary.main,
                animation: 'reindex-spin 0.8s linear infinite',
                '@keyframes reindex-spin': {
                  '0%': { transform: 'rotate(0deg)' },
                  '100%': { transform: 'rotate(360deg)' },
                },
                mx: 'auto',
                mb: 2,
              }}
            />
          )}
          {done && (
            <Box sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              bgcolor: alpha(theme.palette.primary.main, 0.15),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 2,
              color: theme.palette.primary.main,
              animation: 'popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
              '@keyframes popIn': {
                '0%': { transform: 'scale(0)', opacity: 0 },
                '100%': { transform: 'scale(1)', opacity: 1 },
              },
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            </Box>
          )}
          <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'text.primary' }}>
            {done
              ? `Import complete`
              : `Importing music${folderName ? ` from ${folderName}` : ''}...`}
          </Typography>
        </Box>

        {/* Stats */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: theme.palette.primary.main, lineHeight: 1 }}>
              {added}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>new</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: alpha(theme.palette.text.primary, 0.4), lineHeight: 1 }}>
              {skipped}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>already in library</Typography>
          </Box>
        </Box>

        {/* Song list grouped by album */}
        <Box
          ref={listRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.text.primary, 0.15), borderRadius: 3 },
          }}
        >
          {[...albumMap.entries()].map(([albumKey, albumSongs]) => {
            const newInAlbum = albumSongs.filter(s => s.isNew).length;
            const allNew = newInAlbum === albumSongs.length;
            const noneNew = newInAlbum === 0;
            return (
              <Box key={albumKey} sx={{
                bgcolor: alpha(theme.palette.text.primary, 0.04),
                borderRadius: 2,
                px: 2,
                py: 1.5,
                border: '1px solid',
                borderColor: allNew
                  ? alpha(theme.palette.primary.main, 0.2)
                  : 'divider',
              }}>
                {/* Album header */}
                <Typography sx={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: allNew ? theme.palette.primary.main : 'text.secondary',
                  mb: 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                }}>
                  {allNew ? <PlusIcon /> : noneNew ? <CheckIcon /> : null}
                  {albumKey}
                </Typography>
                {/* Songs */}
                {albumSongs.map((song, idx) => (
                  <Box key={idx} sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 0.25,
                  }}>
                    <Box sx={{
                      width: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: song.isNew ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.25),
                      flexShrink: 0,
                    }}>
                      {song.isNew ? <PlusIcon /> : <CheckIcon />}
                    </Box>
                    <Typography sx={{
                      fontSize: 12,
                      color: song.isNew ? 'text.primary' : alpha(theme.palette.text.primary, 0.4),
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {song.title}
                    </Typography>
                  </Box>
                ))}
              </Box>
            );
          })}
        </Box>

        {/* Auto-close countdown bar + dismiss hint */}
        {done && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <Box sx={{
              width: '80%',
              height: 3,
              borderRadius: 1.5,
              bgcolor: 'divider',
              overflow: 'hidden',
            }}>
              <Box sx={{
                height: '100%',
                borderRadius: 1.5,
                bgcolor: theme.palette.primary.main,
                animation: `importShrink ${DISMISS_DURATION}ms linear forwards`,
                '@keyframes importShrink': {
                  '0%': { width: '100%' },
                  '100%': { width: '0%' },
                },
              }} />
            </Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
              Click anywhere to dismiss
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default FolderImportOverlay;
