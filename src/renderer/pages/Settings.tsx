import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Box, Button, Typography, IconButton } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { toggleFullscreen } from '../api/api';
import { isElectron } from '../utils/platform';
import { getApiBase, setApiBase, setAuthToken } from '../types/song';
import axios from 'axios';

// --- SVG Icons ---

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

interface RegisteredDeviceInfo {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'web';
  firstSeen: number;
  lastSeen: number;
}

// --- Main Settings Component ---

const Settings = () => {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 3 }}>Settings</Typography>

      {isElectron() && <ConnectedDevicesSection />}
      {!isElectron() && <MobileScanSection />}

      <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
        <Link to="/">
          <Button variant="contained" color="secondary">
            Go to Home
          </Button>
        </Link>
        {isElectron() && (
          <Button variant="contained" color="secondary" onClick={() => toggleFullscreen()}>
            Fullscreen
          </Button>
        )}
      </Box>
    </Box>
  );
};

// --- Desktop: Connected Devices Section ---

const ConnectedDevicesSection = () => {
  const theme = useTheme();
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
    // Refresh every 30s to keep lastSeen timestamps fresh
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
    <Box sx={{ mb: 4 }}>
      <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
        Connected Devices
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Devices that have paired with this server. Revoking a device will require it to re-scan the QR code.
      </Typography>

      {loading ? (
        <Typography sx={{ color: 'text.secondary', fontSize: 14, py: 2 }}>
          Loading...
        </Typography>
      ) : devices.length === 0 ? (
        <Box sx={{
          bgcolor: 'action.hover',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          p: 3,
          textAlign: 'center',
        }}>
          <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
            No devices have connected yet. Use the "Connect a device" button to pair a mobile device.
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {devices.map((device) => (
              <Box
                key={device.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  px: 2,
                  py: 1.5,
                  '&:hover': {
                    bgcolor: 'action.selected',
                  },
                }}
              >
                {/* Device icon */}
                <Box sx={{ color: 'text.secondary', display: 'flex' }}>
                  <DeviceTypeIcon type={device.type} />
                </Box>

                {/* Device info */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'text.primary' }}>
                    {device.name}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Paired {formatDate(device.firstSeen)} &middot; Last seen {formatLastSeen(device.lastSeen)}
                  </Typography>
                </Box>

                {/* Revoke button */}
                <IconButton
                  size="small"
                  onClick={() => handleRevoke(device.id)}
                  sx={{
                    color: 'text.disabled',
                    '&:hover': { color: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.1) },
                  }}
                  title="Revoke device"
                >
                  <DeleteIcon />
                </IconButton>
              </Box>
            ))}
          </Box>

          {devices.length > 1 && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleRevokeAll}
              sx={{
                mt: 2,
                color: 'error.main',
                borderColor: alpha(theme.palette.error.main, 0.3),
                '&:hover': {
                  borderColor: 'error.main',
                  bgcolor: alpha(theme.palette.error.main, 0.08),
                },
                textTransform: 'none',
                fontSize: 13,
              }}
            >
              Revoke all devices
            </Button>
          )}
        </>
      )}
    </Box>
  );
};

// --- Mobile: Scan QR code to connect to desktop ---

const MobileScanSection = () => {
  const theme = useTheme();
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
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          try {
            const data = JSON.parse(decodedText);
            if (data.host && data.secret) {
              // Exchange pairing secret for a unique device token
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
        () => {} // ignore scan failures (camera still searching)
      );
    } catch (err) {
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
    <Box sx={{ mb: 4 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>Server Connection</Typography>

      {connected && (
        <Box sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.1),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
          borderRadius: 1,
          p: 2,
          mb: 2,
        }}>
          <Typography sx={{ color: 'primary.main', fontSize: 14 }}>
            Connected to {getApiBase()}
          </Typography>
        </Box>
      )}

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Scan the QR code shown in your desktop OpenTunes settings to connect.
      </Typography>

      {!scanning ? (
        <Button
          variant="contained"
          onClick={startScanning}
          sx={{ mb: 2 }}
        >
          Scan QR Code to Connect
        </Button>
      ) : (
        <Box sx={{ mb: 2 }}>
          <div id="qr-reader" ref={videoRef} style={{ width: '100%', maxWidth: 400 }} />
          <Button
            variant="outlined"
            onClick={stopScanning}
            sx={{ mt: 1 }}
          >
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

export default Settings;
