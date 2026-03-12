import { z } from 'zod';
import { WebSocket } from 'ws';

/** Per-connection state passed to every message handler. */
export interface WsConnectionContext {
  connectedDeviceId: string | null;
  connectedDeviceName: string | null;
  ws: WebSocket;
}

/** Type-erased handler definition stored in the registry. */
export interface WsMessageHandler {
  type: string;
  schema: z.ZodType;
  handle: (msg: unknown, ctx: WsConnectionContext) => void;
}

/**
 * Define a message handler with full type inference.
 * The generic is erased when the result is stored in the registry,
 * but each handler file gets compile-time safety on `msg`.
 */
export function defineHandler<T extends z.ZodType>(def: {
  type: string;
  schema: T;
  handle: (msg: z.infer<T>, ctx: WsConnectionContext) => void;
}): WsMessageHandler {
  return def as WsMessageHandler;
}
