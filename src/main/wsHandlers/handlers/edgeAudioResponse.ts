import { z } from 'zod';
import { defineHandler } from '../types';
import { handleEdgeAudioResponse } from '../../federation';

export default defineHandler({
  type: 'edge-audio-response',
  schema: z.object({
    type: z.literal('edge-audio-response'),
    requestId: z.string(),
    mimeType: z.string(),
    fileSize: z.number(),
  }),
  handle(msg) {
    handleEdgeAudioResponse(msg.requestId, msg.mimeType, msg.fileSize);
  },
});
