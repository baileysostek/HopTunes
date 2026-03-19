import React from 'react';
import { Box } from '@mui/material';

/** Strip "[Explicit]" (case-insensitive) from a title string. */
export function stripExplicitTag(title: string): { clean: string; isExplicit: boolean } {
  const re = /\s*\[explicit\]\s*/i;
  if (re.test(title)) {
    return { clean: title.replace(re, ' ').trim(), isExplicit: true };
  }
  return { clean: title, isExplicit: false };
}

/**
 * Small "E" badge similar to Spotify / Apple Music.
 * Uses MUI theme colors so it works on both light and dark themes.
 */
const ExplicitBadge: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: '3px',
      bgcolor: 'text.secondary',
      color: 'background.default',
      fontSize: size * 0.7,
      fontWeight: 800,
      lineHeight: 1,
      flexShrink: 0,
      verticalAlign: 'middle',
      opacity: 0.7,
      fontFamily: 'system-ui, sans-serif',
    }}
  >
    E
  </Box>
);

export default ExplicitBadge;
