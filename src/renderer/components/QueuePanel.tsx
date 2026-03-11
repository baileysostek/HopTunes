import React, { useState, useRef, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { usePlayerStore } from '../store/playerStore';
import { getMediaUrl, Song } from '../types/song';
import { useAlbumImage } from '../hooks/useAlbumImage';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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
        borderTop: isDropTarget ? '2px solid #1db954' : '2px solid transparent',
        transition: 'background 0.1s',
        '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
        '&:hover .queue-remove': { opacity: 1 },
      }}
    >
      {/* Drag handle */}
      <Box sx={{ color: 'rgba(255,255,255,0.25)', mr: 1, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <DragHandleIcon />
      </Box>

      {/* Song info */}
      <Box
        onClick={() => onPlay(song)}
        sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
      >
        <Typography sx={{
          fontSize: 13,
          color: 'white',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {song.title}
        </Typography>
        <Typography sx={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.4)',
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
        color: 'rgba(255,255,255,0.35)',
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
          color: 'rgba(255,255,255,0.4)',
          '&:hover': { color: 'white' },
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

  return (
    <Box sx={{
      width: queueVisible ? 320 : 0,
      minWidth: queueVisible ? 320 : 0,
      bgcolor: '#141414',
      borderLeft: queueVisible ? '1px solid rgba(255,255,255,0.06)' : 'none',
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
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'white' }}>
          Queue
        </Typography>
        <Box
          onClick={toggleQueue}
          sx={{
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.5)',
            '&:hover': { color: 'white' },
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <RemoveIcon />
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 1 }}>
        {/* Now Playing */}
        {currentTrack && (
          <Box sx={{ py: 1.5 }}>
            <Typography sx={{
              fontSize: 11,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.4)',
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
              bgcolor: 'rgba(29, 185, 84, 0.1)',
            }}>
              <Box sx={{
                width: 36,
                height: 36,
                borderRadius: 0.5,
                overflow: 'hidden',
                bgcolor: '#282828',
                mr: 1.5,
                flexShrink: 0,
              }}>
                {currentTrack.art ? (
                  <Box
                    component="img"
                    src={getMediaUrl(currentTrack.art!)}
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
                  color: '#1db954',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {currentTrack.title}
                </Typography>
                <Typography sx={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.4)',
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
            color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            px: 1,
            mb: 0.5,
          }}>
            Up Next {queue.length > 0 ? `(${queue.length})` : ''}
          </Typography>

          {queue.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', px: 1, py: 2, textAlign: 'center' }}>
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
