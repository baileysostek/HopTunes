import { z } from 'zod';
import { defineHandler } from '../types';
import { handleEdgeArtResponse } from '../../federation';

export default defineHandler({
  type: 'edge-art-response',
  schema: z.object({
    type: z.literal('edge-art-response'),
    requestId: z.string(),
    data: z.string().nullable(),
  }),
  handle(msg) {
    handleEdgeArtResponse(msg.requestId, msg.data);
  },
});
