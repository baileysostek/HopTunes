import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
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
import FolderDropOverlay from './FolderDropOverlay';
import FolderImportOverlay from './FolderImportOverlay';
import SyncBanner from './SyncBanner';
import { isElectron, isMobile } from '../utils/platform';
import { usePlayerStore } from '../store/playerStore';

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
  const mobile = isMobile();

  // Mobile tab + connection state
  const queueVisible = usePlayerStore(s => s.queueVisible);
  const devices = usePlayerStore(s => s.devices);
  const activeDeviceId = usePlayerStore(s => s.activeDeviceId);
  const thisDeviceId = usePlayerStore(s => s.thisDeviceId);
  const transferPlayback = usePlayerStore(s => s.transferPlayback);
  const syncFromServer = usePlayerStore(s => s.syncFromServer);
  const theme = useTheme();

  // Device picker menu state (mobile)
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [deviceMenuClosing, setDeviceMenuClosing] = useState(false);
  const closeDeviceMenu = useCallback(() => {
    setDeviceMenuClosing(true);
    setTimeout(() => {
      setDeviceMenuOpen(false);
      setDeviceMenuClosing(false);
    }, 150);
  }, []);

  // Track departing devices for fade-out animation
  const [departingDevices, setDepartingDevices] = useState<typeof devices>([]);
  const prevDeviceSnapshot = useRef<Map<string, (typeof devices)[0]>>(new Map());
  const prevDeviceIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(devices.map(d => d.id));
    const prevIds = prevDeviceIds.current;
    if (prevIds.size > 0) {
      const removed = [...prevIds].filter(id => !currentIds.has(id));
      if (removed.length > 0) {
        const newDeparting = removed
          .map(id => prevDeviceSnapshot.current.get(id))
          .filter((d): d is (typeof devices)[0] => !!d);
        if (newDeparting.length > 0) {
          setDepartingDevices(prev => [...prev, ...newDeparting]);
          const removedSet = new Set(removed);
          setTimeout(() => {
            setDepartingDevices(prev => prev.filter(d => !removedSet.has(d.id)));
          }, 350);
        }
      }
    }
    prevDeviceIds.current = currentIds;
    devices.forEach(d => prevDeviceSnapshot.current.set(d.id, d));
  }, [devices]);

  if (mobile) {
    const activeDevice = devices.find(d => d.id === activeDeviceId);
    const serverDevice = devices.find(d => d.id !== thisDeviceId);
    const connected = devices.length > 0;
    const displayDevices = [...devices, ...departingDevices];
    const departingDeviceIds = new Set(departingDevices.map(d => d.id));

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default', paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Top bar + content */}
        <SearchBar onSettingsClick={openSettingsModal} />
        <SyncBanner />
        <Box sx={{ flex: 1, overflow: 'auto', contain: 'strict' }}>
          {queueVisible ? <QueuePanel /> : children}
        </Box>

        {/* Now playing banner */}
        <NowPlayingBar />

        {/* Bottom tab bar */}
        <Box sx={{
          display: 'flex',
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderTopColor: 'divider',
          flexShrink: 0,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {/* Home tab */}
          <Box
            onClick={() => usePlayerStore.setState({ queueVisible: false })}
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 1,
              gap: 0.25,
              color: !queueVisible ? 'primary.main' : 'text.secondary',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
            </svg>
            <Typography sx={{ fontSize: 11, color: 'inherit', lineHeight: 1 }}>Home</Typography>
          </Box>

          {/* Device picker */}
          <Box
            onClick={() => {
              if (deviceMenuOpen || deviceMenuClosing) {
                closeDeviceMenu();
              } else {
                syncFromServer();
                setDeviceMenuOpen(true);
              }
            }}
            sx={{
              flex: 1.5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 1,
              gap: 0.25,
              color: deviceMenuOpen ? 'primary.main' : 'text.secondary',
              minWidth: 0,
              px: 1,
              position: 'relative',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: connected ? 'success.main' : 'text.disabled',
                flexShrink: 0,
              }} />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/>
              </svg>
            </Box>
            <Typography sx={{
              fontSize: 10,
              color: 'inherit',
              lineHeight: 1,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>
              {connected
                ? (activeDevice
                    ? (activeDevice.id === thisDeviceId ? 'This device' : activeDevice.name)
                    : serverDevice?.name ?? 'Connected')
                : 'Offline'}
            </Typography>

            {/* Device menu popup */}
            {deviceMenuOpen && (
              <>
                <Box
                  onClick={(e) => { e.stopPropagation(); closeDeviceMenu(); }}
                  sx={{ position: 'fixed', inset: 0, zIndex: 1299 }}
                />
                <Box sx={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  mb: 1,
                  bgcolor: 'background.paper',
                  borderRadius: 2,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  minWidth: 240,
                  py: 0.5,
                  zIndex: 1300,
                  transformOrigin: 'bottom center',
                  '@keyframes deviceMenuGrow': {
                    '0%': { opacity: 0, transform: 'translateX(-50%) scale(0.9)' },
                    '100%': { opacity: 1, transform: 'translateX(-50%) scale(1)' },
                  },
                  '@keyframes deviceMenuShrink': {
                    '0%': { opacity: 1, transform: 'translateX(-50%) scale(1)' },
                    '100%': { opacity: 0, transform: 'translateX(-50%) scale(0.9)' },
                  },
                  animation: deviceMenuClosing
                    ? 'deviceMenuShrink 0.15s cubic-bezier(0.2, 0, 0, 1) forwards'
                    : 'deviceMenuGrow 0.15s cubic-bezier(0.2, 0, 0, 1) forwards',
                  pointerEvents: deviceMenuClosing ? 'none' : 'auto',
                }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary', px: 2, py: 1.5 }}>
                    Select a device
                  </Typography>
                  {displayDevices.map(device => {
                    const isDeparting = departingDeviceIds.has(device.id);
                    return (
                      <Box
                        key={device.id}
                        onClick={isDeparting ? undefined : (e) => {
                          e.stopPropagation();
                          transferPlayback(device.id);
                          closeDeviceMenu();
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          px: 2,
                          py: 1.5,
                          bgcolor: device.id === activeDeviceId ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                          '&:active': isDeparting ? {} : { bgcolor: 'action.selected' },
                          ...(isDeparting && {
                            '@keyframes deviceFadeOut': {
                              '0%': { opacity: 1 },
                              '100%': { opacity: 0 },
                            },
                            animation: 'deviceFadeOut 350ms ease-out forwards',
                            pointerEvents: 'none' as const,
                          }),
                        }}
                      >
                        <Box sx={{ color: device.id === activeDeviceId ? theme.palette.primary.main : 'text.secondary' }}>
                          {device.type === 'mobile' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
                            </svg>
                          )}
                        </Box>
                        <Typography sx={{
                          fontSize: 14,
                          color: device.id === activeDeviceId ? theme.palette.primary.main : 'text.primary',
                          fontWeight: device.id === activeDeviceId ? 600 : 400,
                        }}>
                          {device.name}
                          {device.id === thisDeviceId ? ' (this device)' : ''}
                        </Typography>
                      </Box>
                    );
                  })}
                  {displayDevices.length === 0 && (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', px: 2, py: 1.5 }}>
                      No devices connected
                    </Typography>
                  )}
                </Box>
              </>
            )}
          </Box>

          {/* Queue tab */}
          <Box
            onClick={() => usePlayerStore.setState({ queueVisible: true })}
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 1,
              gap: 0.25,
              color: queueVisible ? 'primary.main' : 'text.secondary',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 6h14v2H4zm0 4h14v2H4zm0 4h10v2H4zm12 0v6l5-3z"/>
            </svg>
            <Typography sx={{ fontSize: 11, color: 'inherit', lineHeight: 1 }}>Queue</Typography>
          </Box>
        </Box>

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
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <TitleBar />
      {/* Top: sidebar + content */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar onConnectClick={showConnect ? openConnectModal : undefined} onSettingsClick={openSettingsModal} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SearchBar />
          <SyncBanner />
          <Box sx={{ flex: 1, overflow: 'hidden', contain: 'strict', pr: 1 }}>
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
      <FolderDropOverlay />
      <FolderImportOverlay />
    </Box>
  );
};

export default Layout;
