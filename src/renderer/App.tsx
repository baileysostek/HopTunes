import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';

import Home from './pages/Home';
import Settings from './pages/Settings';
import Layout from './components/Layout';
import { saveAllStores, loadAllStores } from './store/stores';
import { initNativeMediaSession } from './nativeMediaSession';
import './app.css';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#1db954' },
    background: {
      default: '#0a0a0a',
      paper: '#141414',
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255,255,255,0.6)',
    },
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
});

const App = () => {
  useEffect(() => {
    loadAllStores();
    initNativeMediaSession();

    const autosaveInterval = setInterval(() => {
      saveAllStores();
    }, 10000);

    return () => clearInterval(autosaveInterval);
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
};

export default App;
