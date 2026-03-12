import { z } from 'zod';
import { defineHandler } from '../types';
import { registerEdgeLibrary } from '../../federation';

const edgeSongMetaSchema = z.object({
  localPath: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  duration: z.number().nullable(),
  trackNumber: z.number(),
  hash: z.string(),
  hasArt: z.boolean(),
  mimeType: z.string(),
  fileSize: z.number(),
});

export default defineHandler({
  type: 'edge-library',
  schema: z.object({
    type: z.literal('edge-library'),
    deviceId: z.string(),
    songs: z.array(edgeSongMetaSchema),
    syncing: z.boolean().optional(),
  }),
  handle(msg, ctx) {
    if (!ctx.connectedDeviceId) return;
    registerEdgeLibrary(
      ctx.connectedDeviceId,
      ctx.connectedDeviceName || msg.deviceId,
      ctx.ws,
      msg.songs,
      msg.syncing,
    );
  },
});
