import path from 'path';
import os from 'os';

export const PORT = parseInt(process.env.OPENTUNES_PORT || '3000', 10);

export const MUSIC_DIR = process.env.OPENTUNES_MUSIC_DIR
  || path.join(os.homedir(), 'Music');

export function buildCsp(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: http://127.0.0.1:${port} http://localhost:${port} https://r2.theaudiodb.com https://www.theaudiodb.com`,
    `connect-src 'self' http://127.0.0.1:${port} http://localhost:${port} ws://127.0.0.1:${port} ws://localhost:${port} ws://*:${port} ws://localhost:9000`,
    `media-src 'self' http://127.0.0.1:${port} http://localhost:${port}`,
  ].join('; ');
}
