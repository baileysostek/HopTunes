import { Router, Response } from 'express';
import { Song, DeviceInfo } from '../../shared/types';
import {
  getPlaybackState,
  play,
  playWithQueue,
  pause,
  resume,
  stop,
  seek,
  skipNext,
  skipPrev,
  addToQueue,
  addToQueueNext,
  removeFromQueue,
  clearQueue,
  moveInQueue,
  registerDevice,
  heartbeatDevice,
  setActiveDevice,
  broadcastState,
} from '../playback';

const router = Router();

// Helper: respond with state and broadcast to all WebSocket clients
function respondAndBroadcast(res: Response) {
  const state = getPlaybackState();
  res.json(state);
  broadcastState();
}

// GET /api/playback — current playback state + queue + devices
//   query: ?deviceId=xxx (optional heartbeat)
router.get('/', (req, res) => {
  const deviceId = req.query.deviceId as string | undefined;
  if (deviceId) heartbeatDevice(deviceId);
  res.json(getPlaybackState());
});

// POST /api/playback/devices/register — register a device
//   body: { id: string, name: string, type: 'desktop' | 'mobile' | 'web' }
router.post('/devices/register', (req, res) => {
  const { id, name, type } = req.body as { id: string; name: string; type: DeviceInfo['type'] };
  if (!id || !name) {
    res.status(400).json({ error: 'id and name are required' });
    return;
  }
  registerDevice(id, name, type || 'web');
  respondAndBroadcast(res);
});

// PUT /api/playback/devices/active — transfer playback to a device
//   body: { deviceId: string }
router.put('/devices/active', (req, res) => {
  const { deviceId } = req.body as { deviceId: string };
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }
  const ok = setActiveDevice(deviceId);
  if (!ok) {
    res.status(404).json({ error: 'device not found' });
    return;
  }
  respondAndBroadcast(res);
});

// POST /api/playback/play — play a specific song
//   body: { song: Song }
router.post('/play', (req, res) => {
  const { song } = req.body as { song: Song };
  if (!song || !song.path) {
    res.status(400).json({ error: 'song is required' });
    return;
  }
  play(song);
  respondAndBroadcast(res);
});

// POST /api/playback/play-with-queue — play song and set upcoming queue
//   body: { song: Song, queue: Song[] }
router.post('/play-with-queue', (req, res) => {
  const { song, queue } = req.body as { song: Song; queue: Song[] };
  if (!song || !song.path) {
    res.status(400).json({ error: 'song is required' });
    return;
  }
  playWithQueue(song, queue || []);
  respondAndBroadcast(res);
});

// POST /api/playback/pause
router.post('/pause', (req, res) => {
  pause();
  respondAndBroadcast(res);
});

// POST /api/playback/resume
router.post('/resume', (req, res) => {
  resume();
  respondAndBroadcast(res);
});

// POST /api/playback/stop
router.post('/stop', (req, res) => {
  stop();
  respondAndBroadcast(res);
});

// POST /api/playback/seek — seek to a position
//   body: { position: number } (seconds)
router.post('/seek', (req, res) => {
  const { position } = req.body as { position: number };
  if (typeof position !== 'number') {
    res.status(400).json({ error: 'position (number) is required' });
    return;
  }
  seek(position);
  respondAndBroadcast(res);
});

// POST /api/playback/skip — skip to next song in queue
router.post('/skip', (req, res) => {
  skipNext();
  respondAndBroadcast(res);
});

// POST /api/playback/skip-prev — go back to previous song from history
router.post('/skip-prev', (req, res) => {
  skipPrev();
  respondAndBroadcast(res);
});

// --- Queue endpoints ---

// POST /api/playback/queue — add song to end of queue
//   body: { song: Song }
router.post('/queue', (req, res) => {
  const { song } = req.body as { song: Song };
  if (!song || !song.path) {
    res.status(400).json({ error: 'song is required' });
    return;
  }
  addToQueue(song);
  respondAndBroadcast(res);
});

// POST /api/playback/queue/next — add song as next in queue
//   body: { song: Song }
router.post('/queue/next', (req, res) => {
  const { song } = req.body as { song: Song };
  if (!song || !song.path) {
    res.status(400).json({ error: 'song is required' });
    return;
  }
  addToQueueNext(song);
  respondAndBroadcast(res);
});

// DELETE /api/playback/queue/:index — remove song at index from queue
router.delete('/queue/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (isNaN(index)) {
    res.status(400).json({ error: 'invalid index' });
    return;
  }
  const removed = removeFromQueue(index);
  if (!removed) {
    res.status(404).json({ error: 'index out of range' });
    return;
  }
  respondAndBroadcast(res);
});

// DELETE /api/playback/queue — clear entire queue
router.delete('/queue', (req, res) => {
  clearQueue();
  respondAndBroadcast(res);
});

// PUT /api/playback/queue/move — reorder queue
//   body: { from: number, to: number }
router.put('/queue/move', (req, res) => {
  const { from, to } = req.body as { from: number; to: number };
  if (typeof from !== 'number' || typeof to !== 'number') {
    res.status(400).json({ error: 'from and to (numbers) are required' });
    return;
  }
  const ok = moveInQueue(from, to);
  if (!ok) {
    res.status(400).json({ error: 'index out of range' });
    return;
  }
  respondAndBroadcast(res);
});

export default router;
