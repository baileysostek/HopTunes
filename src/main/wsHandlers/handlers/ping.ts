import { z } from 'zod';
import { defineHandler } from '../types';

export default defineHandler({
  type: 'ping',
  schema: z.object({ type: z.literal('ping') }),
  handle() {
    // No-op — the WebSocket ping/pong handles liveness
  },
});
