import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import Confetti from 'react-confetti';
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
  const theme = useTheme();
  const [qrData, setQrData] = useState<{ qr: string; host: string } | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<ModalPhase>('qr');
  const [connectedDevice, setConnectedDevice] = useState<{ name: string; type: string } | null>(null);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(false);

  const modalOpenedAt = useRef<number>(0);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track window size for confetti
  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle open: trigger enter animation + fetch QR + start polling
  useEffect(() => {
    if (open) {
      setClosing(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      modalOpenedAt.current = Date.now();
      setPhase('qr');
      setConnectedDevice(null);
      setError('');

      // Fetch QR code
      fetch(`${getApiBase()}/api/connect/qr`)
        .then(r => r.json())
        .then(data => setQrData(data))
        .catch(() => setError('Failed to generate QR code'));

      // Poll for a pairing event authenticated with this QR's secret
      pollTimer.current = setInterval(async () => {
        try {
          const res = await fetch(`${getApiBase()}/api/connect/last-pairing?since=${modalOpenedAt.current}`);
          const event = await res.json();
          if (event && event.device) {
            // A device actually paired — stop polling and celebrate
            if (pollTimer.current) clearInterval(pollTimer.current);
            pollTimer.current = null;
            setConnectedDevice(event.device);
            setPhase('connected');
            autoCloseTimer.current = setTimeout(() => {
              triggerClose();
            }, CELEBRATION_DURATION);
          }
        } catch {
          // Silent fail — keep polling
        }
      }, 2000);
    } else {
      setVisible(false);
    }
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [open]);

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
          colors={[theme.palette.primary.main, theme.palette.primary.light, '#ffffff', '#b3b3b3', '#1a1a2e']}
        />
      )}

      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          bgcolor: 'background.paper',
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
            color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
            display: 'flex',
            alignItems: 'center',
            transition: 'color 0.15s',
          }}
        >
          <CloseIcon />
        </Box>

        {phase === 'qr' && (
          <>
            <Typography sx={{ fontSize: 24, fontWeight: 700, color: 'text.primary', mb: 1 }}>
              Connect a Device
            </Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', mb: 3 }}>
              Scan this QR code from the OpenTunes mobile app to connect.
            </Typography>

            {error && (
              <Typography sx={{ color: 'error.main', fontSize: 14, mb: 2 }}>{error}</Typography>
            )}

            {qrData ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Box sx={{
                  bgcolor: 'background.default',
                  borderRadius: 2,
                  p: 2.5,
                  display: 'inline-flex',
                  border: '1px solid',
                  borderColor: 'divider',
                }}>
                  <img
                    src={qrData.qr}
                    alt="Connection QR code"
                    style={{ width: 240, height: 240, display: 'block' }}
                  />
                </Box>
                <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
                  Server: {qrData.host}
                </Typography>
              </Box>
            ) : !error ? (
              <Box sx={{ py: 6, color: 'text.disabled' }}>
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
              color: 'text.disabled',
            }}>
              <Box sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: alpha(theme.palette.primary.main, 0.6),
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
              bgcolor: alpha(theme.palette.primary.main, 0.15),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 3,
              color: theme.palette.primary.main,
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
              color: 'text.primary',
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
              <Box sx={{ color: 'text.secondary' }}>
                <DeviceIcon type={connectedDevice.type} />
              </Box>
              <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
                Your device is ready to use.
              </Typography>
            </Box>

            {/* Auto-close progress bar */}
            <Box sx={{
              width: '80%',
              height: 3,
              borderRadius: 1.5,
              bgcolor: 'divider',
              mx: 'auto',
              overflow: 'hidden',
              animation: 'fadeUp 0.4s ease 0.45s both',
            }}>
              <Box sx={{
                height: '100%',
                borderRadius: 1.5,
                bgcolor: theme.palette.primary.main,
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
