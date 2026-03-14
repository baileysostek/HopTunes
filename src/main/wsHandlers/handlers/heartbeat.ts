import { z } from 'zod';
import { defineHandler } from '../types';
import { heartbeatDevice, registerDevice } from '../../playback';

export default defineHandler({
  type: 'heartbeat',
  schema: z.object({
    type: z.literal('heartbeat'),
    deviceId: z.string(),
    name: z.string().optional(),
    deviceType: z.enum(['desktop', 'mobile', 'web']).optional(),
  }),
  handle(msg) {
    // heartbeatDevice is a no-op if the device was pruned. If the heartbeat
    // includes name/type, re-register the device so it recovers immediately
    // instead of waiting for the 10s polling interval on the client.
    const updated = heartbeatDevice(msg.deviceId);
    if (!updated && msg.name && msg.deviceType) {
      registerDevice(msg.deviceId, msg.name, msg.deviceType);
    }
  },
});
