import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { isElectron } from '../utils/platform';
import { getApiBase } from '../types/song';
import { useFolderImportStore } from './FolderImportOverlay';
import axios from 'axios';

const FolderIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
  </svg>
);

const FolderDropOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const dragCounter = useRef(0);
  const theme = useTheme();

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setVisible(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Show the import overlay immediately
    useFolderImportStore.getState().start();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = window.electronAPI?.getPathForFile?.(file);
      if (!filePath) continue;

      try {
        await axios.post(`${getApiBase()}/api/library/locations`, { path: filePath });
      } catch {
        // Silent fail
      }
    }
  }, []);

  const hasExternalFiles = useCallback((e: DragEvent) => {
    return e.dataTransfer?.types?.includes('Files') ?? false;
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!hasExternalFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) {
      setVisible(true);
    }
  }, [hasExternalFiles]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!hasExternalFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setVisible(false);
    }
  }, [hasExternalFiles]);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!hasExternalFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [hasExternalFiles]);

  useEffect(() => {
    if (!isElectron()) return;

    // Use capture phase so these fire before any other handlers can block them
    document.addEventListener('dragenter', handleDragEnter, true);
    document.addEventListener('dragleave', handleDragLeave, true);
    document.addEventListener('dragover', handleDragOver, true);
    document.addEventListener('drop', handleDrop, true);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter, true);
      document.removeEventListener('dragleave', handleDragLeave, true);
      document.removeEventListener('dragover', handleDragOver, true);
      document.removeEventListener('drop', handleDrop, true);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!isElectron() || !visible) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 32,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1400,
        pointerEvents: 'none',
        animation: 'folder-drop-fade-in 0.2s ease',
        '@keyframes folder-drop-fade-in': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      }}
    >
      <Box
        sx={{
          border: '2px dashed',
          borderColor: alpha(theme.palette.primary.main, 0.5),
          borderRadius: 4,
          px: 8,
          py: 6,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          pointerEvents: 'none',
        }}
      >
        <Box sx={{ color: theme.palette.primary.main }}>
          <FolderIcon />
        </Box>
        <Typography sx={{
          fontSize: 20,
          fontWeight: 600,
          color: 'text.primary',
          letterSpacing: 0.5,
        }}>
          Drop folder to add music
        </Typography>
        <Typography sx={{
          fontSize: 13,
          color: 'text.secondary',
        }}>
          Music files will be scanned and added to your library
        </Typography>
      </Box>
    </Box>
  );
};

export default FolderDropOverlay;
