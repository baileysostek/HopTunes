import React, { useState, useCallback } from 'react';
import { Box } from '@mui/material';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import SearchBar from './SearchBar';
import NowPlayingBar from './NowPlayingBar';
import QueuePanel from './QueuePanel';
import ConnectModal from './ConnectModal';
import SettingsModal from './SettingsModal';
import SongContextMenu from './SongContextMenu';
import AlbumContextMenu from './AlbumContextMenu';
import AlbumEditModal from './AlbumEditModal';
import ReindexOverlay from './ReindexOverlay';
import { isElectron } from '../utils/platform';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const openConnectModal = useCallback(() => setConnectModalOpen(true), []);
  const closeConnectModal = useCallback(() => setConnectModalOpen(false), []);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const openSettingsModal = useCallback(() => setSettingsModalOpen(true), []);
  const closeSettingsModal = useCallback(() => setSettingsModalOpen(false), []);
  const [albumEdit, setAlbumEdit] = useState<{ artist: string; album: string } | null>(null);
  const handleEditAlbum = useCallback((artist: string, album: string) => {
    setAlbumEdit({ artist, album });
  }, []);
  const closeAlbumEdit = useCallback(() => setAlbumEdit(null), []);
  const showConnect = isElectron();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <TitleBar />
      {/* Top: sidebar + content */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar onConnectClick={showConnect ? openConnectModal : undefined} onSettingsClick={openSettingsModal} />
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
      <SettingsModal open={settingsModalOpen} onClose={closeSettingsModal} />
      <SongContextMenu />
      <AlbumContextMenu onEditAlbum={handleEditAlbum} />
      <AlbumEditModal
        artist={albumEdit?.artist ?? ''}
        album={albumEdit?.album ?? ''}
        open={albumEdit !== null}
        onClose={closeAlbumEdit}
      />
      <ReindexOverlay />
    </Box>
  );
};

export default Layout;
