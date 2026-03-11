import React, { useEffect, useMemo } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';

import Home from './pages/Home';

import Layout from './components/Layout';
import { saveAllStores, loadAllStores } from './store/stores';
import { initNativeMediaSession } from './nativeMediaSession';
import { useThemeStore, ThemeMode } from './store/themeStore';
import './app.css';

function buildTheme(mode: ThemeMode, accent: string) {
  const isDark = mode !== 'light';
  const bg = mode === 'oled' ? '#000000' : mode === 'light' ? '#f5f5f5' : '#0a0a0a';
  const paper = mode === 'oled' ? '#0a0a0a' : mode === 'light' ? '#ffffff' : '#141414';
  const textPrimary = isDark ? '#ffffff' : '#1a1a1a';
  const textSecondary = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';

  return createTheme({
    palette: {
      mode: isDark ? 'dark' : 'light',
      primary: { main: accent },
      error: { main: '#ff5252' },
      background: { default: bg, paper },
      text: {
        primary: textPrimary,
        secondary: textSecondary,
        disabled: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
      },
      divider: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)',
      action: {
        hover: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        selected: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        disabled: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.26)',
        disabledBackground: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
      },
    },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
  });
}

const App = () => {
  const mode = useThemeStore((s) => s.mode);
  const accent = useThemeStore((s) => s.accent);
  const theme = useMemo(() => buildTheme(mode, accent), [mode, accent]);

  useEffect(() => {
    loadAllStores();
    initNativeMediaSession();

    const autosaveInterval = setInterval(() => {
      saveAllStores();
    }, 10000);

    return () => clearInterval(autosaveInterval);
  }, []);

  // Sync body background for areas outside the app root
  useEffect(() => {
    document.body.style.background = theme.palette.background.default;
    document.body.style.color = theme.palette.text.primary;
  }, [theme]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
};

export default App;
