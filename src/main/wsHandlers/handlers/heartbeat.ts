import { z } from 'zod';
import { defineHandler } from '../types';
import { heartbeatDevice } from '../../playback';

export default defineHandler({
  type: 'heartbeat',
  schema: z.object({
    type: z.literal('heartbeat'),
    deviceId: z.string(),
  }),
  handle(msg) {
    heartbeatDevice(msg.deviceId);
  },
});
