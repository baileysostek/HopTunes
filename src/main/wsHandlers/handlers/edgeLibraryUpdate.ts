import { z } from 'zod';
import { defineHandler } from '../types';
import { updateEdgeLibraryHashes } from '../../federation';

export default defineHandler({
  type: 'edge-library-update',
  schema: z.object({
    type: z.literal('edge-library-update'),
    deviceId: z.string().optional(),
    updates: z.array(z.object({
      localPath: z.string(),
      hash: z.string(),
    })),
  }),
  handle(msg, ctx) {
    if (!ctx.connectedDeviceId) return;
    updateEdgeLibraryHashes(ctx.connectedDeviceId, msg.updates);
  },
});
