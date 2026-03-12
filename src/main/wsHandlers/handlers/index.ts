import { WsMessageHandler } from '../types';

import ping from './ping';
import heartbeat from './heartbeat';
import edgeLibrary from './edgeLibrary';
import edgeLibraryUpdate from './edgeLibraryUpdate';
import edgeAudioResponse from './edgeAudioResponse';
import edgeArtResponse from './edgeArtResponse';

/** All registered WS message handlers. Add new handlers here. */
export const allHandlers: WsMessageHandler[] = [
  ping,
  heartbeat,
  edgeLibrary,
  edgeLibraryUpdate,
  edgeAudioResponse,
  edgeArtResponse,
];
