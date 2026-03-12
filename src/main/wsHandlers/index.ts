// WebSocket message handler registry.
// Each message type lives in its own file under ./handlers/ with a Zod schema
// and a handler function. Adding a new message type is a single-file change
// plus one line in ./handlers/index.ts.

import { WsMessageHandler, WsConnectionContext } from './types';
import { allHandlers } from './handlers';

// Build lookup map from the handler list
const handlerMap = new Map<string, WsMessageHandler>();
for (const h of allHandlers) {
  handlerMap.set(h.type, h);
}

/**
 * Validate and dispatch a WS message to its registered handler.
 * Returns null on success, or a string describing the validation failure.
 */
export function dispatchWsMessage(raw: unknown, ctx: WsConnectionContext): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'missing or invalid message type';
  }

  const type = (raw as Record<string, unknown>).type;
  if (typeof type !== 'string') {
    return 'missing or invalid message type';
  }

  const handler = handlerMap.get(type);
  if (!handler) {
    return `no handler for message type "${type}"`;
  }

  const result = handler.schema.safeParse(raw);
  if (!result.success) {
    return `invalid payload for message type "${type}"`;
  }

  handler.handle(result.data, ctx);
  return null;
}

export type { WsConnectionContext } from './types';
