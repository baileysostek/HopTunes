import React, { useState, useCallback } from 'react';
import { Box } from '@mui/material';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import SearchBar from './SearchBar';
import NowPlayingBar from './NowPlayingBar';
import QueuePanel from './QueuePanel';
import ConnectModal from './ConnectModal';
import { isElectron } from '../utils/platform';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const openConnectModal = useCallback(() => setConnectModalOpen(true), []);
  const closeConnectModal = useCallback(() => setConnectModalOpen(false), []);
  const showConnect = isElectron();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: '#0a0a0a' }}>
      <TitleBar />
      {/* Top: sidebar + content */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar onConnectClick={showConnect ? openConnectModal : undefined} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SearchBar />
          <Box sx={{ flex: 1, overflow: 'auto', contain: 'strict', pr: 1 }}>
            {children}
          </Box>
        </Box>
        <QueuePanel />
      </Box>
      {/* Bottom: now playing */}
      <NowPlayingBar onConnectClick={showConnect ? openConnectModal : undefined} />
      {showConnect && <ConnectModal open={connectModalOpen} onClose={closeConnectModal} />}
    </Box>
  );
};

export default Layout;
