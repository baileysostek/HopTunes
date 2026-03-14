import React, { useState, useRef, useCallback } from 'react';
import { Box, Typography, Tooltip, IconButton } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { usePlayerStore } from '../store/playerStore';
import { getMediaUrl, Song } from '../types/song';
import { useAlbumImage } from '../hooks/useAlbumImage';
import { useCachedArt } from '../hooks/useCachedArt';
import { isMobile } from '../utils/platform';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const CollapseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
  </svg>
);

const DragHandleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="5" r="1.5" />
    <circle cx="15" cy="5" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="19" r="1.5" />
    <circle cx="15" cy="19" r="1.5" />
  </svg>
);

const RemoveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
  </svg>
);

interface QueueItemProps {
  song: Song;
  index: number;
  dragIndex: number | null;
  dropTarget: number | null;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemove: (index: number) => void;
  onPlay: (song: Song) => void;
}

const QueueItem: React.FC<QueueItemProps> = ({
  song, index, dragIndex, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, onPlay,
}) => {
  const theme = useTheme();
  const isDragging = dragIndex === index;
  const isDropTarget = dropTarget === index;

  return (
    <Box
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 0.75,
        px: 1,
        borderRadius: 1,
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        borderTop: isDropTarget ? `2px solid ${theme.palette.primary.main}` : '2px solid transparent',
        transition: 'background 0.1s',
        '&:hover': { bgcolor: 'action.hover' },
        '&:hover .queue-remove': { opacity: 1 },
      }}
    >
      {/* Drag handle */}
      <Box sx={{ color: 'text.disabled', mr: 1, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <DragHandleIcon />
      </Box>

      {/* Song info */}
      <Box
        onClick={() => onPlay(song)}
        sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
      >
        <Typography sx={{
          fontSize: 13,
          color: 'text.primary',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}>
          {song.title}
          {song.origin && (
            <Tooltip title={song.origin.deviceName} arrow placement="top">
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', color: 'text.disabled', flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
                </svg>
              </Box>
            </Tooltip>
          )}
        </Typography>
        <Typography sx={{
          fontSize: 11,
          color: 'text.secondary',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {song.artist}
        </Typography>
      </Box>

      {/* Duration */}
      <Typography sx={{
        fontSize: 12,
        color: 'text.disabled',
        mx: 1,
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
      }}>
        {formatDuration(song.duration)}
      </Typography>

      {/* Remove button */}
      <Box
        className="queue-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        sx={{
          opacity: 0,
          cursor: 'pointer',
          color: 'text.secondary',
          '&:hover': { color: 'text.primary' },
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <RemoveIcon />
      </Box>
    </Box>
  );
};

const QueuePanel: React.FC = () => {
  const theme = useTheme();
  const queue = usePlayerStore(s => s.queue);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const queueVisible = usePlayerStore(s => s.queueVisible);
  const toggleQueue = usePlayerStore(s => s.toggleQueue);
  const moveInQueue = usePlayerStore(s => s.moveInQueue);
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue);
  const play = usePlayerStore(s => s.play);

  const externalArt = useAlbumImage(
    currentTrack && !currentTrack.art ? currentTrack.artist : '',
    currentTrack && !currentTrack.art ? currentTrack.album : '',
  );
  const cachedArt = useCachedArt(currentTrack?.art);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDropTarget(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex !== null && dropTarget !== null && dragIndex !== dropTarget) {
      moveInQueue(dragIndex, dropTarget);
    }
    setDragIndex(null);
    setDropTarget(null);
  }, [dragIndex, dropTarget, moveInQueue]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  const handlePlay = useCallback((song: Song) => {
    play(song);
  }, [play]);

  const mobile = isMobile();

  // On mobile, render as a full-screen overlay
  if (mobile) {
    if (!queueVisible) return null;
    return (
      <Box sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: 'background.default',
        zIndex: 1400,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        paddingTop: 'env(safe-area-inset-top)',
      }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          pt: 2,
          pb: 1.5,
          borderBottom: '1px solid',
          borderBottomColor: 'divider',
        }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary' }}>
            Queue
          </Typography>
          <Box
            onClick={toggleQueue}
            sx={{ cursor: 'pointer', color: 'text.secondary', display: 'flex', alignItems: 'center', p: 1 }}
          >
            <RemoveIcon />
          </Box>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto', px: 1 }}>
          {currentTrack && (
            <Box sx={{ py: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1, px: 1, mb: 0.5 }}>
                Now Playing
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', py: 0.75, px: 1, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 0.5, overflow: 'hidden', bgcolor: 'background.paper', mr: 1.5, flexShrink: 0 }}>
                  {cachedArt ? (
                    <Box component="img" src={cachedArt} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : externalArt ? (
                    <Box component="img" src={externalArt} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: theme.palette.primary.main, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentTrack.title}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentTrack.artist}
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}

          <Box sx={{ py: 1 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1, px: 1, mb: 0.5 }}>
              Up Next {queue.length > 0 ? `(${queue.length})` : ''}
            </Typography>
            {queue.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: 'text.disabled', px: 1, py: 2, textAlign: 'center' }}>
                Queue is empty
              </Typography>
            ) : (
              queue.map((song, idx) => (
                <QueueItem
                  key={`${song.path}-${idx}`}
                  song={song}
                  index={idx}
                  dragIndex={dragIndex}
                  dropTarget={dropTarget}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  onRemove={removeFromQueue}
                  onPlay={handlePlay}
                />
              ))
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  // Desktop: inline side panel
  return (
    <Box sx={{
      width: queueVisible ? 320 : 0,
      minWidth: queueVisible ? 320 : 0,
      bgcolor: 'background.paper',
      borderLeft: queueVisible ? '1px solid' : 'none',
      borderLeftColor: queueVisible ? 'divider' : undefined,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.25s ease, min-width 0.25s ease',
      willChange: 'width, min-width',
    }}>
      {/* Header — pt accounts for the floating window controls */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        pt: '38px',
        pb: 1.5,
        borderBottom: '1px solid',
        borderBottomColor: 'divider',
      }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>
          Queue
        </Typography>
        <IconButton
          onClick={toggleQueue}
          size="small"
          sx={{
            color: 'text.secondary',
            '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
          }}
        >
          <CollapseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 1 }}>
        {/* Now Playing */}
        {currentTrack && (
          <Box sx={{ py: 1.5 }}>
            <Typography sx={{
              fontSize: 11,
              fontWeight: 700,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: 1,
              px: 1,
              mb: 0.5,
            }}>
              Now Playing
            </Typography>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              py: 0.75,
              px: 1,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
            }}>
              <Box sx={{
                width: 36,
                height: 36,
                borderRadius: 0.5,
                overflow: 'hidden',
                bgcolor: 'background.paper',
                mr: 1.5,
                flexShrink: 0,
              }}>
                {cachedArt ? (
                  <Box
                    component="img"
                    src={cachedArt}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : externalArt ? (
                  <Box
                    component="img"
                    src={externalArt}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : null}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: theme.palette.primary.main,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {currentTrack.title}
                </Typography>
                <Typography sx={{
                  fontSize: 11,
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {currentTrack.artist}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}

        {/* Up Next */}
        <Box sx={{ py: 1 }}>
          <Typography sx={{
            fontSize: 11,
            fontWeight: 700,
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: 1,
            px: 1,
            mb: 0.5,
          }}>
            Up Next {queue.length > 0 ? `(${queue.length})` : ''}
          </Typography>

          {queue.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'text.disabled', px: 1, py: 2, textAlign: 'center' }}>
              Queue is empty
            </Typography>
          ) : (
            queue.map((song, idx) => (
              <QueueItem
                key={`${song.path}-${idx}`}
                song={song}
                index={idx}
                dragIndex={dragIndex}
                dropTarget={dropTarget}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                onRemove={removeFromQueue}
                onPlay={handlePlay}
              />
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default QueuePanel;
