## TODO

### Existing
1. [x] - Cleanup Express Server
1. [ ] - Setup Certbot-esque system to check if certs are invalidated and re-issue them if they are.
1. [x] - Write simple frontend
1. [x] - SqlLite DB hosted with app to hold all songs
---

### Themes
1. [x] - Create a Zustand `themeStore` to hold the active theme and user-customized colors
1. [x] - Define a `Theme` type with tokens: `primary`, `background`, `surface`, `text`, `accent`, `nowPlayingBar`, `sidebar`, etc.
1. [x] - Ship built-in presets (Dark/Spotify Green, Light, Classic iTunes Blue, High Contrast)
1. [x] - Replace all hardcoded hex colors (`#1db954`, `#0a0a0a`, `#141414`, etc.) in components with theme tokens via MUI `ThemeProvider`
1. [x] - Add a "Custom Theme" option with MUI color pickers for each token
1. [x] - Persist the selected theme using the existing `saveableStore` pattern so it survives restarts
1. [ ] - Sync the active theme across devices via WebSocket so mobile and desktop stay visually consistent

### Refactor Settings Page → Modal
1. [x] - Remove fullscreen button
1. [x] - Study the existing `ConnectModal.tsx` pattern (glassmorphism backdrop, fade-in animation, click-outside-to-close)
1. [x] - Create `SettingsModal.tsx` following the same overlay + centered card layout
1. [x] - Move device management UI (connected devices list, revoke buttons) from `Settings.tsx` into the modal
1. [x] - Add tabbed sections inside the modal: "Devices", "Library", "Themes", "About"
1. [x] - Wire the modal open/close to a gear icon in the `Sidebar` (replace the current `/settings` route navigation)
1. [x] - Remove the `/settings` route from `App.tsx` once the modal fully works
1. [x] - Ensure it works on both Electron and Capacitor (mobile may need a full-screen variant)

### Library Federation (Edge Device Sync)
1. [x] - Implement `federation.ts` host-side federation manager for edge device registration and library merging
1. [x] - Implement `edgeLibrary.ts` and `edgeLibraryUpdate.ts` WebSocket handlers for edge device communication
1. [x] - Edge device library deduplication and unified library combining host + edge libraries
1. [x] - Reverse audio streaming from edge devices with stream-as-it-arrives via PassThrough
1. [x] - Reverse art streaming from edge devices
1. [x] - Audio cache system for offline playback of federated content
1. [x] - Edge device online status tracking and liveness detection (ping/pong)
1. [x] - `SyncBanner.tsx` showing edge device sync progress with visual states

### Playlists
1. [ ] - Add a `playlists` table to SQLite: `id (UUID)`, `name`, `createdAt`, `updatedAt`, `coverArt (nullable)`
1. [ ] - Add a `playlist_tracks` join table: `playlistId`, `songPath`, `position (int for ordering)`
1. [ ] - Create Express routes: `GET/POST /api/playlists`, `GET/PUT/DELETE /api/playlists/:id`, `POST/DELETE` for tracks
1. [ ] - Create a `playlistStore` (Zustand) to fetch and cache playlists client-side
1. [ ] - Add a "Playlists" section in the Sidebar above the artist list, each playlist as a clickable row
1. [ ] - Build a `PlaylistView` component showing tracks in order with drag-to-reorder (reuse `QueuePanel` DnD logic)
1. [ ] - Add a right-click / long-press context menu on tracks: "Add to Playlist → [list] / New Playlist"
1. [ ] - Support "Play Playlist" which loads all tracks into the queue
1. [ ] - Broadcast playlist changes over WebSocket so all devices see updates in real time

### Shuffle Play
1. [ ] - Add `shuffleEnabled` boolean to `playerStore`
1. [ ] - When shuffle toggled ON, snapshot the current queue order, then Fisher-Yates shuffle a copy for playback
1. [ ] - When shuffle toggled OFF, restore the original queue order, keeping the current track in place
1. [ ] - Add a shuffle icon button (MUI `Shuffle` icon) in `NowPlayingBar` next to transport controls
1. [ ] - Highlight the shuffle button with accent color when active
1. [ ] - Sync shuffle state across devices via WebSocket
1. [ ] - Consider adding "Repeat" mode too (repeat-all / repeat-one / off) since it pairs naturally with shuffle

### iTunes-Style Audio Visualizer
1. [ ] - Create a `Visualizer.tsx` component rendering on a `<canvas>` element
1. [ ] - On the active device, tap into `<audio>` via `AudioContext` + `createMediaElementSource()` + `AnalyserNode`
1. [ ] - Implement a classic frequency-bar visualizer as baseline (colored bars reacting to FFT data)
1. [ ] - Recreate the iconic iTunes "gelatinous blob" visualizer: drive a deformable radial mesh with frequency + waveform data, smooth interpolation, and vivid color cycling
1. [ ] - Add WebGL/Three.js for GPU-accelerated rendering if canvas is too slow
1. [ ] - Toggle from a button in `NowPlayingBar` or as a full-screen overlay (double-click to expand)
1. [ ] - On non-active (remote) devices, either hide the visualizer or stream FFT snapshots over WebSocket
1. [ ] - Visualizer color palette should follow the active Theme

### Play All for an Artist
1. [ ] - Add a "Play All" button (play icon) on artist banner headers in `Home.tsx`
1. [ ] - Collect every song for that artist, set first as `currentTrack`, load the rest into the queue
1. [ ] - Respect shuffle state: if shuffle is on, shuffle the artist's tracks before queuing
1. [ ] - Also add "Add to Queue" option that appends without replacing the current queue
1. [ ] - Wire through the existing `/api/playback/play-with-queue` endpoint

### Android Auto Support
1. [x] - Add `androidx.car.app:app` dependency to `android/app/build.gradle`
1. [x] - Implement `MediaBrowserServiceCompat` exposing the music library as a browsable tree (artists → albums → tracks)
1. [x] - Implement `MediaSessionCompat` for transport controls (play, pause, skip, seek) mapped to the Express playback API
1. [x] - Register the service in `AndroidManifest.xml` with `com.google.android.gms.car.application` metadata
1. [x] - Build album art `ContentProvider` so Android Auto can display cover art
1. [x] - Test with Desktop Head Unit (DHU) emulator before testing in the car
1. [x] - Handle audio focus properly so OpenTunes pauses for nav prompts and phone calls
1. [ ] - Cleartext HTTP over local network should already work (existing `capacitor.config.ts` allows it)

---

### Additional Ideas
1. [ ] - **Equalizer** — Expose Web Audio API `BiquadFilterNode` chain (bass, mid, treble) with preset EQ curves (Flat, Bass Boost, Vocal, Rock) and a manual band editor
1. [ ] - **Lyrics Display** — Fetch synced lyrics from an API (e.g. lrclib.net) and display karaoke-style in the Now Playing area, scrolling in time with playback
1. [ ] - **Crossfade Between Tracks** — Overlap the last N seconds of the ending track with the next using dual `<audio>` elements and gain ramp
1. [ ] - **Sleep Timer** — Countdown (15m, 30m, 1h, end of track) after which playback auto-pauses; great for bedtime listening
1. [ ] - **Last.fm / ListenBrainz Scrobbling** — Hit the scrobble API after a song plays past 50%; builds a listening profile over time
1. [ ] - **Keyboard Shortcuts / Global Hotkeys** — Register global shortcuts via Electron `globalShortcut` (space = play/pause, arrows = seek, Ctrl+F = search) so they work even unfocused
1. [x] - **Gapless Playback** — Pre-buffer the next track and seamlessly switch at track end, eliminating silence gaps for live albums and concept albums
1. [ ] - **Smart Playlists / Auto-Generated Mixes** — Auto-generate playlists from rules (most played, recently added, genre, decade) using metadata + play-count stats in SQLite
1. [ ] - **Mini Player Mode** — Compact always-on-top Electron `BrowserWindow` showing just album art + controls, for minimal screen real estate
1. [ ] - **Drag-and-Drop Import** — Drag audio files or folders onto the app window to add them to the library, triggering the indexer on dropped paths
1. [ ] - **Desktop Widget** — Small transparent always-on-top Now Playing widget for the desktop using a secondary Electron window
