import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import Confetti from 'react-confetti';
import { usePlayerStore } from '../store/playerStore';
import { getApiBase } from '../types/song';

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
  </svg>
);

const DeviceIcon: React.FC<{ type: string }> = ({ type }) => {
  if (type === 'mobile') return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
    </svg>
  );
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
    </svg>
  );
};

const CheckIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
  </svg>
);

const CELEBRATION_DURATION = 6000; // ms

type ModalPhase = 'qr' | 'connected';

interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
}

const ConnectModal: React.FC<ConnectModalProps> = ({ open, onClose }) => {
  const [qrData, setQrData] = useState<{ qr: string; host: string } | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<ModalPhase>('qr');
  const [connectedDevice, setConnectedDevice] = useState<{ name: string; type: string } | null>(null);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(false);

  const devices = usePlayerStore(s => s.devices);
  const thisDeviceId = usePlayerStore(s => s.thisDeviceId);
  const deviceSnapshot = useRef<Map<string, number>>(new Map());
  const modalOpenedAt = useRef<number>(0);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track window size for confetti
  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle open: trigger enter animation
  useEffect(() => {
    if (open) {
      setClosing(false);
      // Force a frame so the initial state renders before transitioning
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      modalOpenedAt.current = Date.now();
      deviceSnapshot.current = new Map(devices.map(d => [d.id, d.lastSeen]));
      setPhase('qr');
      setConnectedDevice(null);
      setError('');
    } else {
      setVisible(false);
    }
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    };
  }, [open]);

  // Fetch QR code when modal opens
  useEffect(() => {
    if (!open) return;
    fetch(`${getApiBase()}/api/connect/qr`)
      .then(r => r.json())
      .then(data => setQrData(data))
      .catch(() => setError('Failed to generate QR code'));
  }, [open]);

  // Watch for new or re-registering device connections
  useEffect(() => {
    if (!open || phase !== 'qr') return;

    for (const device of devices) {
      // Skip this device (the desktop itself)
      if (device.id === thisDeviceId) continue;

      const prevLastSeen = deviceSnapshot.current.get(device.id);
      const isNew = prevLastSeen === undefined;
      // Treat as reconnected if lastSeen jumped since modal opened
      const isReconnected = !isNew && device.lastSeen > modalOpenedAt.current && device.lastSeen !== prevLastSeen;

      if (isNew || isReconnected) {
        setConnectedDevice({ name: device.name, type: device.type });
        setPhase('connected');

        autoCloseTimer.current = setTimeout(() => {
          triggerClose();
        }, CELEBRATION_DURATION);
        break;
      }
    }
  }, [devices, open, phase, thisDeviceId]);

  const triggerClose = useCallback(() => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    setClosing(true);
    setVisible(false);
    // Wait for exit animation to finish before actually unmounting
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 300);
  }, [onClose]);

  if (!open && !closing) return null;

  const showContent = visible && !closing;

  return (
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
      {phase === 'connected' && visible && !closing && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          numberOfPieces={200}
          recycle={true}
          initialVelocityY={20}
          tweenDuration={100}
          colors={['#1db954', '#1ed760', '#ffffff', '#b3b3b3', '#1a1a2e']}
        />
      )}

      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          bgcolor: '#1a1a1a',
          borderRadius: 3,
          p: 4,
          position: 'relative',
          maxWidth: 420,
          width: '90%',
          textAlign: 'center',
          transform: showContent ? 'scale(1)' : 'scale(0.5)',
          opacity: showContent ? 1 : 0,
          transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease',
        }}
      >
        {/* Close button */}
        <Box
          onClick={triggerClose}
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
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

        {phase === 'qr' && (
          <>
            <Typography sx={{ fontSize: 24, fontWeight: 700, color: 'white', mb: 1 }}>
              Connect a Device
            </Typography>
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', mb: 3 }}>
              Scan this QR code from the OpenTunes mobile app to connect.
            </Typography>

            {error && (
              <Typography sx={{ color: '#ff5252', fontSize: 14, mb: 2 }}>{error}</Typography>
            )}

            {qrData ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Box sx={{
                  bgcolor: '#111',
                  borderRadius: 2,
                  p: 2.5,
                  display: 'inline-flex',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <img
                    src={qrData.qr}
                    alt="Connection QR code"
                    style={{ width: 240, height: 240, display: 'block' }}
                  />
                </Box>
                <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
                  Server: {qrData.host}
                </Typography>
              </Box>
            ) : !error ? (
              <Box sx={{ py: 6, color: 'rgba(255,255,255,0.3)' }}>
                <Typography sx={{ fontSize: 14 }}>Loading...</Typography>
              </Box>
            ) : null}

            {/* Waiting indicator */}
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              mt: 3,
              color: 'rgba(255,255,255,0.35)',
            }}>
              <Box sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: 'rgba(29, 185, 84, 0.6)',
                animation: 'pulse 1.5s ease-in-out infinite',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 0.4, transform: 'scale(0.8)' },
                  '50%': { opacity: 1, transform: 'scale(1.2)' },
                },
              }} />
              <Typography sx={{ fontSize: 13 }}>
                Waiting for device...
              </Typography>
            </Box>
          </>
        )}

        {phase === 'connected' && connectedDevice && (
          <Box sx={{ py: 3 }}>
            <Box sx={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              bgcolor: 'rgba(29, 185, 84, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 3,
              color: '#1db954',
              animation: 'popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
              '@keyframes popIn': {
                '0%': { transform: 'scale(0)', opacity: 0 },
                '100%': { transform: 'scale(1)', opacity: 1 },
              },
            }}>
              <CheckIcon />
            </Box>

            <Typography sx={{
              fontSize: 28,
              fontWeight: 700,
              color: 'white',
              mb: 1,
              animation: 'fadeUp 0.4s ease 0.15s both',
              '@keyframes fadeUp': {
                '0%': { opacity: 0, transform: 'translateY(10px)' },
                '100%': { opacity: 1, transform: 'translateY(0)' },
              },
            }}>
              {connectedDevice.name} Connected
            </Typography>

            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              mb: 3,
              animation: 'fadeUp 0.4s ease 0.3s both',
            }}>
              <Box sx={{ color: 'rgba(255,255,255,0.5)' }}>
                <DeviceIcon type={connectedDevice.type} />
              </Box>
              <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
                Your device is ready to use.
              </Typography>
            </Box>

            {/* Auto-close progress bar */}
            <Box sx={{
              width: '80%',
              height: 3,
              borderRadius: 1.5,
              bgcolor: 'rgba(255,255,255,0.08)',
              mx: 'auto',
              overflow: 'hidden',
              animation: 'fadeUp 0.4s ease 0.45s both',
            }}>
              <Box sx={{
                height: '100%',
                borderRadius: 1.5,
                bgcolor: '#1db954',
                animation: `shrink ${CELEBRATION_DURATION}ms linear forwards`,
                '@keyframes shrink': {
                  '0%': { width: '100%' },
                  '100%': { width: '0%' },
                },
              }} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ConnectModal;
