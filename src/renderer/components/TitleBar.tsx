import React, { useState, useEffect, useCallback } from 'react';
import { Box, IconButton } from '@mui/material';
import { isElectron } from '../utils/platform';
import { usePlayerStore } from '../store/playerStore';

const TitleBar: React.FC = () => {
  const queueVisible = usePlayerStore(s => s.queueVisible);
  const [maximized, setMaximized] = useState(false);

  const checkMaximized = useCallback(async () => {
    if (!isElectron()) return;
    const isMax = await window.electronAPI.windowIsMaximized();
    setMaximized(isMax);
  }, []);

  useEffect(() => {
    checkMaximized();
    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, [checkMaximized]);

  // Don't render on non-Electron platforms
  if (!isElectron()) return null;

  const handleMinimize = () => window.electronAPI.windowMinimize();
  const handleMaximize = () => {
    window.electronAPI.windowMaximize();
    setTimeout(checkMaximized, 50);
  };
  const handleClose = () => window.electronAPI.windowClose();

  const buttonSx = {
    borderRadius: 0,
    width: 46,
    color: 'text.primary',
    WebkitAppRegion: 'no-drag',
    '&:hover': {
      bgcolor: 'action.selected',
    },
  };

  return (
    <>
      {/* Floating window controls in the top-right */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: queueVisible ? 32 : 62,
          transition: 'height 0.3s ease',
          display: 'flex',
          alignItems: 'stretch',
          zIndex: 9999,
          WebkitAppRegion: 'no-drag',
          '& *': { WebkitAppRegion: 'no-drag' },
        }}
      >
        <IconButton onClick={handleMinimize} sx={buttonSx} size="small">
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect fill="currentColor" width="10" height="1" />
          </svg>
        </IconButton>

        <IconButton onClick={handleMaximize} sx={buttonSx} size="small">
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path fill="none" stroke="currentColor" strokeWidth="1" d="M3,1 h6 v6 h-1 M1,3 h6 v6 h-6 z" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect fill="none" stroke="currentColor" strokeWidth="1" x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </IconButton>

        <IconButton
          onClick={handleClose}
          sx={{
            ...buttonSx,
            '&:hover': {
              bgcolor: '#e81123',
              color: '#ffffff',
            },
          }}
          size="small"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path stroke="currentColor" strokeWidth="1.2" d="M1,1 L9,9 M9,1 L1,9" />
          </svg>
        </IconButton>
      </Box>
    </>
  );
};

export default TitleBar;
