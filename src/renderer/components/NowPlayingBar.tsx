import React, { useState } from 'react';
import { Box, Typography, Slider } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { usePlayerStore, DeviceInfo } from '../store/playerStore';
import { getMediaUrl } from '../types/song';
import { useAlbumImage } from '../hooks/useAlbumImage';
import { isMobile } from '../utils/platform';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Two-path morph: each shape is split into a left and right quad
// so the path commands match (M L L L Z) for smooth CSS d transitions.
const PAUSE_LEFT  = 'M2,1 L6,1 L6,15 L2,15 Z';
const PAUSE_RIGHT = 'M10,1 L14,1 L14,15 L10,15 Z';
const PLAY_LEFT   = 'M3,1 L8,4.5 L8,11.5 L3,15 Z';
const PLAY_RIGHT  = 'M8,4.5 L13,8 L13,8 L8,11.5 Z';

const PlayPauseIcon: React.FC<{ isPlaying: boolean }> = ({ isPlaying }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path
      d={isPlaying ? PAUSE_LEFT : PLAY_LEFT}
      style={{ transition: 'd 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
    />
    <path
      d={isPlaying ? PAUSE_RIGHT : PLAY_RIGHT}
      style={{ transition: 'd 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
    />
  </svg>
);

const PrevIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="2" width="2" height="12" />
    <polygon points="14,2 5,8 14,14" />
  </svg>
);

const NextIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <polygon points="2,2 11,8 2,14" />
    <rect x="13" y="2" width="2" height="12" />
  </svg>
);

const VolumeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
  </svg>
);

const MusicNoteIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
  </svg>
);

const DeviceIcon: React.FC<{ type: DeviceInfo['type'] }> = ({ type }) => {
  if (type === 'mobile') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
    </svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
    </svg>
  );
};

const SpeakerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/>
  </svg>
);

interface NowPlayingBarProps {
  onConnectClick?: () => void;
}

const NowPlayingBar: React.FC<NowPlayingBarProps> = ({ onConnectClick }) => {
  const theme = useTheme();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const volume = usePlayerStore(s => s.volume);
  const queueVisible = usePlayerStore(s => s.queueVisible);
  const toggleQueue = usePlayerStore(s => s.toggleQueue);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);
  const seek = usePlayerStore(s => s.seek);
  const setVolume = usePlayerStore(s => s.setVolume);
  const devices = usePlayerStore(s => s.devices);
  const activeDeviceId = usePlayerStore(s => s.activeDeviceId);
  const thisDeviceId = usePlayerStore(s => s.thisDeviceId);
  const transferPlayback = usePlayerStore(s => s.transferPlayback);
  const syncFromServer = usePlayerStore(s => s.syncFromServer);

  const externalArt = useAlbumImage(
    currentTrack && !currentTrack.art ? currentTrack.artist : '',
    currentTrack && !currentTrack.art ? currentTrack.album : '',
  );

  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const activeDevice = devices.find(d => d.id === activeDeviceId);
  const playingElsewhere = !!activeDeviceId && activeDeviceId !== thisDeviceId;
  const mobile = isMobile();

  const artSrc = currentTrack?.art
    ? getMediaUrl(currentTrack.art)
    : externalArt || null;

  // ── Mobile: compact bar + expandable full-screen player ──
  if (mobile) {
    return (
      <>
        {/* Compact bottom bar */}
        <Box
          onClick={() => currentTrack && setMobileExpanded(true)}
          sx={{
            height: 64,
            bgcolor: 'background.paper',
            borderTop: '1px solid',
            borderTopColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            px: 1.5,
            flexShrink: 0,
            gap: 1.5,
          }}
        >
          {/* Mini album art */}
          <Box sx={{
            width: 44,
            height: 44,
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: 'background.default',
            flexShrink: 0,
          }}>
            {artSrc ? (
              <Box component="img" src={artSrc} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
                <MusicNoteIcon />
              </Box>
            )}
          </Box>

          {/* Track info */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentTrack?.title || 'No track playing'}
            </Typography>
            {currentTrack && (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentTrack.artist}
              </Typography>
            )}
          </Box>

          {/* Play/pause + next */}
          <Box
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            sx={{ color: 'text.primary', display: 'flex', alignItems: 'center', p: 1 }}
          >
            <PlayPauseIcon isPlaying={isPlaying} />
          </Box>
          <Box
            onClick={(e) => { e.stopPropagation(); next(); }}
            sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', p: 1 }}
          >
            <NextIcon />
          </Box>
        </Box>

        {/* Expanded full-screen player */}
        {mobileExpanded && (
          <Box sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'background.default',
            zIndex: 1300,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            paddingTop: 'env(safe-area-inset-top)',
          }}>
            {/* Close handle */}
            <Box
              onClick={() => setMobileExpanded(false)}
              sx={{
                display: 'flex',
                justifyContent: 'center',
                pt: 1.5,
                pb: 1,
                cursor: 'pointer',
              }}
            >
              <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'text.disabled' }} />
            </Box>

            {/* Large album art */}
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 4, minHeight: 0 }}>
              <Box sx={{
                width: '100%',
                maxWidth: 320,
                aspectRatio: '1',
                borderRadius: 2,
                overflow: 'hidden',
                bgcolor: 'background.paper',
              }}>
                {artSrc ? (
                  <Box component="img" src={artSrc} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                    </svg>
                  </Box>
                )}
              </Box>
            </Box>

            {/* Track info */}
            <Box sx={{ px: 4, pt: 2, pb: 1 }}>
              <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentTrack?.title || 'No track'}
              </Typography>
              <Typography sx={{ fontSize: 16, color: 'text.secondary' }}>
                {currentTrack?.artist || ''}
              </Typography>
            </Box>

            {/* Seek bar */}
            <Box sx={{ px: 4, display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', minWidth: 36, fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(currentTime)}
              </Typography>
              <Slider
                size="small"
                value={currentTime || 0}
                max={duration || 1}
                onChange={(_, val) => seek(val as number)}
                sx={{
                  mx: 1.5,
                  color: 'text.primary',
                  height: 4,
                  '& .MuiSlider-thumb': { width: 14, height: 14, transition: 'none', '&:hover, &.Mui-focusVisible': { boxShadow: 'none' } },
                  '& .MuiSlider-track': { transition: 'none' },
                  '& .MuiSlider-rail': { bgcolor: 'divider' },
                }}
              />
              <Typography sx={{ fontSize: 12, color: 'text.secondary', minWidth: 36, fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(duration)}
              </Typography>
            </Box>

            {/* Playback controls */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, py: 3 }}>
              <Box onClick={prev} sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', p: 1 }}>
                <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="2" width="2" height="12" />
                  <polygon points="14,2 5,8 14,14" />
                </svg>
              </Box>
              <Box
                onClick={togglePlay}
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  bgcolor: 'white',
                  color: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
                  <path d={isPlaying ? PAUSE_LEFT : PLAY_LEFT} />
                  <path d={isPlaying ? PAUSE_RIGHT : PLAY_RIGHT} />
                </svg>
              </Box>
              <Box onClick={next} sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', p: 1 }}>
                <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor">
                  <polygon points="2,2 11,8 2,14" />
                  <rect x="13" y="2" width="2" height="12" />
                </svg>
              </Box>
            </Box>

            {/* Queue toggle + Device picker */}
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 3, pb: 4 }}>
              <Box
                onClick={toggleQueue}
                sx={{
                  color: queueVisible ? theme.palette.primary.main : 'text.secondary',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  p: 1,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 6h14v2H4zm0 4h14v2H4zm0 4h10v2H4zm12 0v6l5-3z"/>
                </svg>
                <Typography sx={{ fontSize: 13, color: 'inherit' }}>Queue</Typography>
              </Box>

              {/* Device picker */}
              <Box
                onClick={() => {
                  if (!deviceMenuOpen) syncFromServer();
                  setDeviceMenuOpen(!deviceMenuOpen);
                }}
                sx={{
                  color: playingElsewhere ? theme.palette.primary.main : 'text.secondary',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  p: 1,
                }}
              >
                <SpeakerIcon />
                <Typography sx={{ fontSize: 13, color: 'inherit' }}>
                  {activeDevice?.name || 'Devices'}
                </Typography>
              </Box>
            </Box>

            {/* Device menu overlay */}
            {deviceMenuOpen && (
              <Box sx={{
                position: 'absolute',
                bottom: 80,
                left: '50%',
                transform: 'translateX(-50%)',
                bgcolor: 'background.paper',
                borderRadius: 2,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                minWidth: 260,
                py: 0.5,
                zIndex: 10,
              }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary', px: 2, py: 1.5 }}>
                  Select a device
                </Typography>
                {devices.map(device => (
                  <Box
                    key={device.id}
                    onClick={() => {
                      transferPlayback(device.id);
                      setDeviceMenuOpen(false);
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 2,
                      py: 1.5,
                      bgcolor: device.id === activeDeviceId ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                      '&:active': { bgcolor: 'action.selected' },
                    }}
                  >
                    <Box sx={{ color: device.id === activeDeviceId ? theme.palette.primary.main : 'text.secondary' }}>
                      <DeviceIcon type={device.type} />
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
                ))}
                {devices.length === 0 && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', px: 2, py: 1.5 }}>
                    No devices connected
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        )}
      </>
    );
  }

  // ── Desktop layout ──
  return (
    <Box sx={{
      height: 90,
      bgcolor: 'background.paper',
      borderTop: '1px solid',
      borderTopColor: 'divider',
      display: 'flex',
      alignItems: 'center',
      px: 2,
      flexShrink: 0,
    }}>
      {/* Track info */}
      <Box sx={{ display: 'flex', alignItems: 'center', width: 200, minWidth: 150, flexShrink: 0 }}>
        {currentTrack ? (
          <>
            <Box sx={{
              width: 56,
              height: 56,
              borderRadius: 1,
              overflow: 'hidden',
              bgcolor: 'background.paper',
              mr: 1.5,
              flexShrink: 0,
            }}>
              {currentTrack.art ? (
                <Box
                  component="img"
                  src={getMediaUrl(currentTrack.art!)}
                  alt={currentTrack.album}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : externalArt ? (
                <Box
                  component="img"
                  src={externalArt}
                  alt={currentTrack.album}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Box sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'text.disabled',
                }}>
                  <MusicNoteIcon />
                </Box>
              )}
            </Box>
            <Box sx={{ overflow: 'hidden', minWidth: 0 }}>
              <Typography sx={{
                fontSize: 14,
                fontWeight: 500,
                color: 'text.primary',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}>
                {currentTrack.title}
              </Typography>
              <Typography sx={{
                fontSize: 12,
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}>
                {currentTrack.artist}
              </Typography>
            </Box>
          </>
        ) : (
          <Typography sx={{ color: 'text.disabled', fontSize: 14 }}>
            No track playing
          </Typography>
        )}
      </Box>

      {/* Playback controls */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', ml: 1, mr: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
          <Box
            onClick={prev}
            sx={{
              cursor: 'pointer',
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <PrevIcon />
          </Box>
          <Box
            onClick={togglePlay}
            sx={{
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: '50%',
              bgcolor: 'white',
              color: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.1s',
              '&:hover': { transform: 'scale(1.06)' },
            }}
          >
            <PlayPauseIcon isPlaying={isPlaying} />
          </Box>
          <Box
            onClick={next}
            sx={{
              cursor: 'pointer',
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <NextIcon />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <Typography sx={{
            fontSize: 11,
            color: 'text.secondary',
            minWidth: 40,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {formatTime(currentTime)}
          </Typography>
          <Slider
            size="small"
            value={currentTime || 0}
            max={duration || 1}
            onChange={(_, val) => seek(val as number)}
            sx={{
              mx: 1.5,
              color: 'text.primary',
              height: 4,
              '& .MuiSlider-thumb': {
                width: 12,
                height: 12,
                transition: 'none',
                '&:hover, &.Mui-focusVisible': { boxShadow: 'none' },
              },
              '& .MuiSlider-track': { transition: 'none' },
              '& .MuiSlider-rail': { bgcolor: 'divider' },
            }}
          />
          <Typography sx={{
            fontSize: 11,
            color: 'text.secondary',
            minWidth: 40,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {formatTime(duration)}
          </Typography>
        </Box>
      </Box>

      {/* Queue + Volume + Device picker */}
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 180, gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Queue toggle */}
          <Box
            onClick={toggleQueue}
            sx={{
              cursor: 'pointer',
              color: queueVisible ? theme.palette.primary.main : 'text.secondary',
              '&:hover': { color: queueVisible ? theme.palette.primary.main : 'text.primary' },
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 6h14v2H4zm0 4h14v2H4zm0 4h10v2H4zm12 0v6l5-3z"/>
            </svg>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 100 }}>
            <Box sx={{ color: 'text.secondary', mr: 1, display: 'flex', alignItems: 'center' }}>
              <VolumeIcon />
            </Box>
            <Slider
              size="small"
              value={volume}
              max={1}
              step={0.01}
              onChange={(_, val) => setVolume(val as number)}
              sx={{
                color: 'text.primary',
                height: 4,
                '& .MuiSlider-thumb': {
                  width: 12,
                  height: 12,
                  '&:hover, &.Mui-focusVisible': { boxShadow: 'none' },
                },
                '& .MuiSlider-rail': { bgcolor: 'divider' },
              }}
            />
          </Box>
        </Box>

        {/* Device picker */}
        <Box sx={{ position: 'relative' }}>
          <Box
            onClick={() => {
              if (!deviceMenuOpen) syncFromServer();
              setDeviceMenuOpen(!deviceMenuOpen);
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              flex: 1,
              gap: 0.5,
              cursor: 'pointer',
              color: playingElsewhere ? theme.palette.primary.main : deviceMenuOpen ? theme.palette.primary.main : 'text.secondary',
              '&:hover': { color: playingElsewhere ? theme.palette.primary.light : deviceMenuOpen ? theme.palette.primary.main : 'text.secondary' },
              py: 0.25,
              px: playingElsewhere ? 1 : 0,
              borderRadius: 1,
              border: playingElsewhere ? `1px solid ${alpha(theme.palette.primary.main, 0.35)}` : '1px solid transparent',
              transition: 'all 0.2s ease',
            }}
          >
            <SpeakerIcon />
            <Typography sx={{ fontSize: 11, color: 'inherit' }}>
              {activeDevice ? (
                <>
                  {activeDevice.name}
                  {activeDevice.id === thisDeviceId ? ' (this device)' : ''}
                </>
              ) : 'No device'}
            </Typography>
            {playingElsewhere && (
              <Box sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: theme.palette.primary.main,
                ml: 'auto',
                alignSelf: 'center',
                mt: '-2px',
                flexShrink: 0,
                animation: 'pulse 2s ease-in-out infinite',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 0.6, transform: 'scale(0.9)' },
                  '50%': { opacity: 1, transform: 'scale(1.2)' },
                },
              }} />
            )}
          </Box>

          {/* Device dropdown */}
          {deviceMenuOpen && (
            <Box sx={{
              position: 'absolute',
              bottom: '100%',
              right: 0,
              mb: 1,
              bgcolor: 'background.paper',
              borderRadius: 1,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              minWidth: 220,
              py: 0.5,
              zIndex: 100,
            }}>
              <Typography sx={{
                fontSize: 12,
                fontWeight: 600,
                color: 'text.primary',
                px: 2,
                py: 1,
              }}>
                Select a device
              </Typography>
              {devices.map(device => (
                <Box
                  key={device.id}
                  onClick={() => {
                    transferPlayback(device.id);
                    setDeviceMenuOpen(false);
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1,
                    cursor: 'pointer',
                    bgcolor: device.id === activeDeviceId ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                    '&:hover': { bgcolor: 'action.selected' },
                  }}
                >
                  <Box sx={{ color: device.id === activeDeviceId ? theme.palette.primary.main : 'text.secondary' }}>
                    <DeviceIcon type={device.type} />
                  </Box>
                  <Box>
                    <Typography sx={{
                      fontSize: 13,
                      color: device.id === activeDeviceId ? theme.palette.primary.main : 'text.primary',
                      fontWeight: device.id === activeDeviceId ? 600 : 400,
                    }}>
                      {device.name}
                      {device.id === thisDeviceId ? ' (this device)' : ''}
                    </Typography>
                  </Box>
                </Box>
              ))}
              {devices.length === 0 && (
                <Typography sx={{ fontSize: 12, color: 'text.secondary', px: 2, py: 1 }}>
                  No devices connected
                </Typography>
              )}
              {onConnectClick && (
                <>
                  <Box sx={{ borderTop: '1px solid', borderTopColor: 'divider', mx: 1, my: 0.5 }} />
                  <Box
                    onClick={() => {
                      setDeviceMenuOpen(false);
                      onConnectClick();
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 2,
                      py: 1,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.selected' },
                    }}
                  >
                    <Box sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                      </svg>
                    </Box>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      Connect a device
                    </Typography>
                  </Box>
                </>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default NowPlayingBar;
