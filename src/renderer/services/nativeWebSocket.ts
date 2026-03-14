// TypeScript interface for the NativeWebSocket Capacitor plugin.
// The native side (NativeWebSocketManager.java) owns the WebSocket connection
// and handles heartbeats + reverse streaming autonomously. This bridge lets JS
// initiate connections, send messages, and receive forwarded server messages.

import { registerPlugin } from '@capacitor/core';

interface NativeWebSocketPlugin {
  connect(options: {
    wsUrl: string;
    deviceId: string;
    deviceName: string;
    deviceType: string;
  }): Promise<void>;

  disconnect(): Promise<void>;

  sendMessage(options: { message: string }): Promise<void>;

  /** Cache the edge-library JSON so native can re-announce on reconnect. */
  cacheEdgeLibrary(options: { json: string }): Promise<void>;

  getConnectionState(): Promise<{ connected: boolean }>;

  addListener(
    event: 'wsMessage',
    handler: (data: { data: string }) => void,
  ): Promise<{ remove: () => void }>;

  addListener(
    event: 'wsConnected',
    handler: () => void,
  ): Promise<{ remove: () => void }>;

  addListener(
    event: 'wsDisconnected',
    handler: (data: { code: number; reason: string }) => void,
  ): Promise<{ remove: () => void }>;
}

export const NativeWebSocket = registerPlugin<NativeWebSocketPlugin>('NativeWebSocket');
