import React, { useState, useEffect, useRef } from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { useLibraryStore } from '../store/libraryStore';
import { usePlayerStore } from '../store/playerStore';
import { isMobile } from '../utils/platform';

interface SearchBarProps {
  onSettingsClick?: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSettingsClick }) => {
  const setSearchQuery = useLibraryStore(s => s.setSearchQuery);
  const [localQuery, setLocalQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobile = isMobile();
  const queueVisible = usePlayerStore(s => s.queueVisible);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(localQuery);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localQuery, setSearchQuery]);

  return (
    <Box sx={{
      pl: mobile ? 1 : 3,
      pr: mobile ? 1 : queueVisible ? 1.5 : 0,
      py: 1.5,
      borderBottom: '1px solid',
      borderBottomColor: 'divider',
      bgcolor: 'background.default',
      display: 'flex',
      alignItems: 'center',
      WebkitAppRegion: mobile ? undefined : 'drag',
      flexShrink: 0,
      transition: 'padding-right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      {mobile && onSettingsClick && (
        <IconButton onClick={onSettingsClick} sx={{ color: 'text.secondary', mr: 0.5 }} size="small">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
          </svg>
        </IconButton>
      )}
      {!mobile && (
        <Box sx={{ color: 'text.secondary', mr: 1.5, display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
        </Box>
      )}
      <TextField
        fullWidth
        size="small"
        placeholder="Search songs, artists, albums..."
        value={localQuery}
        onChange={(e) => setLocalQuery(e.target.value)}
        sx={{
          flex: 1,
          WebkitAppRegion: mobile ? undefined : 'no-drag',
          '& .MuiOutlinedInput-root': {
            bgcolor: 'action.selected',
            borderRadius: 2,
            color: 'text.primary',
            fontSize: 14,
            '& fieldset': { borderColor: 'transparent' },
            '&:hover fieldset': { borderColor: 'divider' },
            '&.Mui-focused fieldset': { borderColor: 'text.disabled' },
          },
          '& .MuiInputBase-input::placeholder': {
            color: 'text.secondary',
            opacity: 1,
          },
        }}
      />
      {/* Spacer for window controls — no-drag so buttons remain clickable (desktop only, collapses when queue panel covers them) */}
      {!mobile && (
        <Box sx={{
          width: queueVisible ? 0 : 150,
          minWidth: queueVisible ? 0 : 150,
          alignSelf: 'stretch',
          WebkitAppRegion: 'no-drag',
          transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }} />
      )}
    </Box>
  );
};

export default SearchBar;
