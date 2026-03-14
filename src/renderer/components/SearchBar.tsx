import React, { useState, useEffect, useRef } from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { useLibraryStore } from '../store/libraryStore';
import { usePlayerStore } from '../store/playerStore';
import { isMobile } from '../utils/platform';

interface SearchBarProps {
  onMenuClick?: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ onMenuClick }) => {
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
      {mobile && onMenuClick && (
        <IconButton onClick={onMenuClick} sx={{ color: 'text.secondary', mr: 0.5 }} size="small">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
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
