import React, { useState, useEffect, useRef } from 'react';
import { Box, TextField } from '@mui/material';
import { useLibraryStore } from '../store/libraryStore';

const SearchBar: React.FC = () => {
  const setSearchQuery = useLibraryStore(s => s.setSearchQuery);
  const [localQuery, setLocalQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      pl: 3,
      py: 1.5,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      bgcolor: '#0f0f0f',
      display: 'flex',
      alignItems: 'center',
      WebkitAppRegion: 'drag',
    }}>
      <Box sx={{ color: 'rgba(255,255,255,0.4)', mr: 1.5, display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
      </Box>
      <TextField
        fullWidth
        size="small"
        placeholder="Search songs, artists, albums..."
        value={localQuery}
        onChange={(e) => setLocalQuery(e.target.value)}
        sx={{
          flex: 1,
          WebkitAppRegion: 'no-drag',
          '& .MuiOutlinedInput-root': {
            bgcolor: 'rgba(255,255,255,0.08)',
            borderRadius: 2,
            color: 'white',
            fontSize: 14,
            '& fieldset': { borderColor: 'transparent' },
            '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.15)' },
            '&.Mui-focused fieldset': { borderColor: 'rgba(255,255,255,0.25)' },
          },
          '& .MuiInputBase-input::placeholder': {
            color: 'rgba(255,255,255,0.4)',
            opacity: 1,
          },
        }}
      />
      {/* Spacer for window controls — no-drag so buttons remain clickable */}
      <Box sx={{ width: 150, minWidth: 150, WebkitAppRegion: 'no-drag' }} />
    </Box>
  );
};

export default SearchBar;
