import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, Button, IconButton } from '@mui/material';
import { isElectron } from '../utils/platform';
import { getApiBase, setApiBase, setAuthToken } from '../types/song';
import axios from 'axios';
import ConnectModal from './ConnectModal';

// --- SVG Icons ---

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
  </svg>
);

const DeleteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
  </svg>
);

const PhoneIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
  </svg>
);

const DesktopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
  </svg>
);

const WebIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/>
  </svg>
);

const DeviceTypeIcon: React.FC<{ type: string }> = ({ type }) => {
  if (type === 'mobile') return <PhoneIcon />;
  if (type === 'desktop') return <DesktopIcon />;
  return <WebIcon />;
};

// --- Helpers ---

function formatLastSeen(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// --- Types ---

type SettingsTab = 'devices' | 'library' | 'themes' | 'about';

interface RegisteredDeviceInfo {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'web';
  firstSeen: number;
  lastSeen: number;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// --- Tab Content Components ---

const DevicesTabDesktop: React.FC<{ onAddDevice: () => void }> = ({ onAddDevice }) => {
  const [devices, setDevices] = useState<RegisteredDeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await axios.get(`${getApiBase()}/api/connect/devices`);
      setDevices(res.data);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 30000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const handleRevoke = async (deviceId: string) => {
    try {
      const res = await axios.delete(`${getApiBase()}/api/connect/devices/${encodeURIComponent(deviceId)}`);
      setDevices(res.data);
    } catch {
      // Silent fail
    }
  };

  const handleRevokeAll = async () => {
    try {
      await axios.post(`${getApiBase()}/api/connect/revoke-all`);
      setDevices([]);
    } catch {
      // Silent fail
    }
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Devices that have paired with this server. Revoking a device will require it to re-scan the QR code.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading ? (
          <Typography sx={{ color: 'text.secondary', fontSize: 14, py: 2 }}>Loading...</Typography>
        ) : (
          devices.map((device) => (
            <Box
              key={device.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                bgcolor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 2,
                px: 2,
                py: 1.5,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
              }}
            >
              <Box sx={{ color: 'rgba(255,255,255,0.5)', display: 'flex' }}>
                <DeviceTypeIcon type={device.type} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>
                  {device.name}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Paired {formatDate(device.firstSeen)} &middot; Last seen {formatLastSeen(device.lastSeen)}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => handleRevoke(device.id)}
                sx={{
                  color: 'rgba(255,255,255,0.3)',
                  '&:hover': { color: '#ff5252', bgcolor: 'rgba(255,82,82,0.1)' },
                }}
                title="Revoke device"
              >
                <DeleteIcon />
              </IconButton>
            </Box>
          ))
        )}

        {/* Add a device row */}
        <Box
          onClick={onAddDevice}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: 2,
            px: 2,
            py: 1.5,
            cursor: 'pointer',
            transition: 'background-color 0.15s, border-color 0.15s',
            '&:hover': {
              bgcolor: 'rgba(29,185,84,0.06)',
              borderColor: 'rgba(29,185,84,0.3)',
            },
          }}
        >
          <Box sx={{ color: 'rgba(29,185,84,0.6)', display: 'flex' }}>
            <AddIcon />
          </Box>
          <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>
            Add a device
          </Typography>
        </Box>
      </Box>

      {!loading && devices.length > 1 && (
        <Button
          variant="outlined"
          size="small"
          onClick={handleRevokeAll}
          sx={{
            mt: 2,
            color: '#ff5252',
            borderColor: 'rgba(255,82,82,0.3)',
            '&:hover': { borderColor: '#ff5252', bgcolor: 'rgba(255,82,82,0.08)' },
            textTransform: 'none',
            fontSize: 13,
          }}
        >
          Revoke all devices
        </Button>
      )}
    </Box>
  );
};

const DevicesTabMobile = () => {
  const [scanning, setScanning] = useState(false);
  const [connected, setConnected] = useState(!!localStorage.getItem('opentunes_auth_token'));
  const [error, setError] = useState('');
  const scannerRef = useRef<any>(null);
  const videoRef = useRef<HTMLDivElement>(null);

  const startScanning = async () => {
    setScanning(true);
    setError('');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('settings-qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          try {
            const data = JSON.parse(decodedText);
            if (data.host && data.secret) {
              scanner.stop().catch(() => {});
              setScanning(false);
              setError('');
              const deviceId = localStorage.getItem('opentunes_device_id') ||
                ((crypto as any).randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now().toString(36)));
              localStorage.setItem('opentunes_device_id', deviceId);
              const ua = navigator.userAgent;
              const name = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : 'Browser';
              const type = /Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'web';
              try {
                const res = await axios.post(`${data.host}/api/connect/pair`, {
                  secret: data.secret,
                  deviceId,
                  name,
                  type,
                });
                setApiBase(data.host);
                setAuthToken(res.data.token);
                setConnected(true);
                window.location.reload();
              } catch {
                setError('Pairing failed. The QR code may have expired — try generating a new one.');
              }
            } else {
              setError('Invalid QR code');
            }
          } catch {
            setError('Invalid QR code format');
          }
        },
        () => {}
      );
    } catch {
      setError('Could not access camera. Please allow camera permissions.');
      setScanning(false);
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return (
    <Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Scan the QR code shown in your desktop OpenTunes settings to connect.
      </Typography>

      {connected && (
        <Box sx={{
          bgcolor: 'rgba(29, 185, 84, 0.1)',
          border: '1px solid rgba(29, 185, 84, 0.3)',
          borderRadius: 1,
          p: 2,
          mb: 2,
        }}>
          <Typography sx={{ color: '#1db954', fontSize: 14 }}>
            Connected to {getApiBase()}
          </Typography>
        </Box>
      )}

      {!scanning ? (
        <Button variant="contained" onClick={startScanning} sx={{ mb: 2 }}>
          Scan QR Code to Connect
        </Button>
      ) : (
        <Box sx={{ mb: 2 }}>
          <div id="settings-qr-reader" ref={videoRef} style={{ width: '100%', maxWidth: 400 }} />
          <Button variant="outlined" onClick={stopScanning} sx={{ mt: 1 }}>
            Cancel
          </Button>
        </Box>
      )}

      {error && (
        <Typography sx={{ color: 'error.main', fontSize: 14, mt: 1 }}>{error}</Typography>
      )}
    </Box>
  );
};

const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
  </svg>
);

const RefreshIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
  </svg>
);

const AddIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
  </svg>
);

const LibraryTab = () => {
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await axios.get(`${getApiBase()}/api/library/locations`);
      setLocations(res.data);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const handleAddFolder = async () => {
    if (isElectron()) {
      const folderPath = await window.electronAPI.selectFolder();
      if (!folderPath) return;
      try {
        const res = await axios.post(`${getApiBase()}/api/library/locations`, { path: folderPath });
        setLocations(res.data);
      } catch {
        // Silent fail
      }
    }
  };

  const handleRemoveFolder = async (folderPath: string) => {
    try {
      const res = await axios.delete(`${getApiBase()}/api/library/locations`, { data: { path: folderPath } });
      setLocations(res.data);
    } catch {
      // Silent fail
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      await axios.post(`${getApiBase()}/api/reindex`);
    } catch {
      // Silent fail
    } finally {
      setReindexing(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Folders that OpenTunes scans for music. Adding or removing a folder will automatically reindex your library.
      </Typography>

      {loading ? (
        <Typography sx={{ color: 'text.secondary', fontSize: 14, py: 2 }}>Loading...</Typography>
      ) : locations.length === 0 ? (
        <Box sx={{
          bgcolor: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 2,
          p: 3,
          textAlign: 'center',
        }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
            No media locations configured. Add a folder to get started.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {locations.map((loc) => (
            <Box
              key={loc}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                bgcolor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 2,
                px: 2,
                py: 1.5,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
              }}
            >
              <Box sx={{ color: 'rgba(255,255,255,0.5)', display: 'flex' }}>
                <FolderIcon />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'white',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {loc}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => handleRemoveFolder(loc)}
                sx={{
                  color: 'rgba(255,255,255,0.3)',
                  '&:hover': { color: '#ff5252', bgcolor: 'rgba(255,82,82,0.1)' },
                }}
                title="Remove folder"
              >
                <DeleteIcon />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        {isElectron() && (
          <Button
            variant="outlined"
            size="small"
            onClick={handleAddFolder}
            startIcon={<AddIcon />}
            sx={{
              color: 'white',
              borderColor: 'rgba(255,255,255,0.2)',
              '&:hover': { borderColor: 'rgba(255,255,255,0.4)', bgcolor: 'rgba(255,255,255,0.05)' },
              textTransform: 'none',
              fontSize: 13,
            }}
          >
            Add Folder
          </Button>
        )}
        <Button
          variant="outlined"
          size="small"
          onClick={handleReindex}
          disabled={reindexing}
          startIcon={<RefreshIcon />}
          sx={{
            color: '#1db954',
            borderColor: 'rgba(29,185,84,0.3)',
            '&:hover': { borderColor: '#1db954', bgcolor: 'rgba(29,185,84,0.08)' },
            textTransform: 'none',
            fontSize: 13,
          }}
        >
          {reindexing ? 'Reindexing...' : 'Reindex Library'}
        </Button>
      </Box>
    </Box>
  );
};

const ThemesTab = () => (
  <Box>
    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
      Theme customization will appear here.
    </Typography>
    <Box sx={{
      bgcolor: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 2,
      p: 3,
      textAlign: 'center',
    }}>
      <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
        Coming soon
      </Typography>
    </Box>
  </Box>
);

const AboutTab = () => (
  <Box>
    <Box sx={{ textAlign: 'center', py: 2 }}>
      <Typography sx={{ fontSize: 28, fontWeight: 800, color: 'white', mb: 0.5 }}>
        OpenTunes
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', mb: 3 }}>
        Your music, everywhere.
      </Typography>
      <Box sx={{
        bgcolor: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 2,
        p: 2,
        textAlign: 'left',
      }}>
        <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 2 }}>
          Platform: {isElectron() ? 'Desktop (Electron)' : 'Web / Mobile'}
        </Typography>
      </Box>
    </Box>
  </Box>
);

// --- Tab definitions ---

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'devices', label: 'Devices' },
  { key: 'library', label: 'Library' },
  { key: 'themes', label: 'Themes' },
  { key: 'about', label: 'About' },
];

// --- Main Modal ---

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('devices');
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setClosing(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [open]);

  const triggerClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 300);
  }, [onClose]);

  if (!open && !closing) return null;

  const showContent = visible && !closing;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'devices':
        return isElectron() ? <DevicesTabDesktop onAddDevice={() => setConnectModalOpen(true)} /> : <DevicesTabMobile />;
      case 'library':
        return <LibraryTab />;
      case 'themes':
        return <ThemesTab />;
      case 'about':
        return <AboutTab />;
    }
  };

  return (
    <>
      <Box
        onClick={triggerClose}
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          bgcolor: showContent ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0)',
          backdropFilter: showContent ? 'blur(8px)' : 'blur(0px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1300,
          transition: 'background-color 0.3s ease, backdrop-filter 0.3s ease',
        }}
      >
        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{
            bgcolor: '#1a1a1a',
            borderRadius: 3,
            position: 'relative',
            maxWidth: 560,
            width: '90%',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            transform: showContent ? 'scale(1)' : 'scale(0.5)',
            opacity: showContent ? 1 : 0,
            transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease',
          }}
        >
          {/* Header */}
          <Box sx={{ px: 3, pt: 3, pb: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'white' }}>
              Settings
            </Typography>
            <Box
              onClick={triggerClose}
              sx={{
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.4)',
                '&:hover': { color: 'white' },
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.15s',
              }}
            >
              <CloseIcon />
            </Box>
          </Box>

          {/* Tabs */}
          <Box sx={{
            display: 'flex',
            gap: 0,
            px: 3,
            pt: 2,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            {TABS.map((tab) => (
              <Box
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                sx={{
                  px: 2,
                  py: 1.5,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  color: activeTab === tab.key ? 'white' : 'rgba(255,255,255,0.4)',
                  borderBottom: activeTab === tab.key ? '2px solid #1db954' : '2px solid transparent',
                  transition: 'color 0.15s, border-color 0.15s',
                  '&:hover': {
                    color: activeTab === tab.key ? 'white' : 'rgba(255,255,255,0.7)',
                  },
                  userSelect: 'none',
                }}
              >
                {tab.label}
              </Box>
            ))}
          </Box>

          {/* Tab content */}
          <Box sx={{ px: 3, py: 3, flex: 1, overflow: 'auto' }}>
            {renderTabContent()}
          </Box>
        </Box>
      </Box>
      <ConnectModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
    </>
  );
};

export default SettingsModal;
