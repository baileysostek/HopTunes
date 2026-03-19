import React, { useState, useRef, useCallback } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { Virtuoso } from 'react-virtuoso';
import { usePlayerStore } from '../store/playerStore';
import { getMediaUrl, Song } from '../types/song';
import { useAlbumImage } from '../hooks/useAlbumImage';
import { useCachedArt } from '../hooks/useCachedArt';
import { isMobile } from '../utils/platform';
import ExplicitBadge, { stripExplicitTag } from './ExplicitBadge';

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
          {stripExplicitTag(song.title).clean}
          {stripExplicitTag(song.title).isExplicit && <ExplicitBadge size={12} />}
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
  const moveInQueue = usePlayerStore(s => s.moveInQueue);
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue);
  const shuffleEnabled = usePlayerStore(s => s.shuffleEnabled);
  const play = usePlayerStore(s => s.play);

  const externalArt = useAlbumImage(
    currentTrack && !currentTrack.art ? currentTrack.artist : '',
    currentTrack && !currentTrack.art ? currentTrack.album : '',
  );
  const cachedArt = useCachedArt(currentTrack?.art);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dropTargetRef.current = index;
    setDropTarget(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragEnd = useCallback(() => {
    const from = dragIndexRef.current;
    const to = dropTargetRef.current;
    if (from !== null && to !== null && from !== to) {
      moveInQueue(from, to);
    }
    dragIndexRef.current = null;
    dropTargetRef.current = null;
    setDragIndex(null);
    setDropTarget(null);
  }, [moveInQueue]);

  const handlePlay = useCallback((song: Song) => {
    play(song);
  }, [play]);

  const mobile = isMobile();

  const nowPlayingSection = currentTrack ? (
    <Box sx={{ py: 1.5, px: 1 }}>
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
            <Box component="img" src={cachedArt} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : externalArt ? (
            <Box component="img" src={externalArt} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}>
            {stripExplicitTag(currentTrack.title).clean}
            {stripExplicitTag(currentTrack.title).isExplicit && <ExplicitBadge size={12} />}
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
  ) : null;

  const upNextHeader = (
    <Typography sx={{
      fontSize: 11,
      fontWeight: 700,
      color: 'text.secondary',
      textTransform: 'uppercase',
      letterSpacing: 1,
      px: 1,
      mb: 0.5,
      pt: 1,
    }}>
      Up Next {queue.length > 0 ? `(${queue.length})` : ''}{mobile && shuffleEnabled ? ' · Shuffled' : ''}
    </Typography>
  );

  const upNextContent = queue.length === 0 ? (
    <Box sx={{ px: 1 }}>
      {upNextHeader}
      <Typography sx={{ fontSize: 13, color: 'text.disabled', px: 1, py: 2, textAlign: 'center' }}>
        Queue is empty
      </Typography>
    </Box>
  ) : (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 1 }}>
      {upNextHeader}
      <Virtuoso
        style={{ flex: 1 }}
        totalCount={queue.length}
        overscan={200}
        itemContent={(idx) => (
          <QueueItem
            key={`${queue[idx].path}-${idx}`}
            song={queue[idx]}
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
        )}
      />
    </Box>
  );

  // On mobile, render as inline tab content
  if (mobile) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'background.default',
      }}>
        {nowPlayingSection}
        {upNextContent}
      </Box>
    );
  }

  // Desktop: inline side panel
  return (
    <Box sx={{
      position: 'relative',
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
      {/* Now Playing — fixed at top */}
      <Box sx={{ flexShrink: 0, pt: '8px' }}>
        {nowPlayingSection}
      </Box>

      {/* Up Next — scrollable via Virtuoso */}
      {upNextContent}
    </Box>
  );
};

export default QueuePanel;
