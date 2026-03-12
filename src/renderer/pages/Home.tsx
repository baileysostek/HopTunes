import React, { useEffect, useMemo, useCallback } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { Virtuoso } from 'react-virtuoso';
import { useLibraryStore } from '../store/libraryStore';
import AlbumSection from '../components/AlbumSection';
import { Song, getMediaUrl } from '../types/song';
import { useArtistImage } from '../hooks/useArtistImage';

type ListItem =
  | { type: 'artist-banner'; artist: string; songCount: number; albumCount: number; totalDuration: number; bannerArt: string | null; departing?: boolean }
  | { type: 'album'; artist: string; albumName: string; tracks: Song[]; artUrl: string | null; allDeparting?: boolean; departingSongPaths?: Set<string> };

const ArtistBanner: React.FC<{ item: Extract<ListItem, { type: 'artist-banner' }> }> = ({ item }) => {
  const artistImage = useArtistImage(item.artist);
  const hasExternalArt = !!artistImage;

  return (
    <Box sx={{
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 3,
      mb: 3,
      mt: 1,
      height: 280,
      display: 'flex',
      alignItems: 'flex-end',
      ...(item.departing && {
        '@keyframes bannerShrinkOut': {
          '0%': { opacity: 1, transform: 'scale(1)' },
          '100%': { opacity: 0, transform: 'scale(0.97)' },
        },
        animation: 'bannerShrinkOut 350ms ease-out forwards',
        pointerEvents: 'none',
      }),
    }}>
      {/* Background: prefer fetched artist image, fall back to blurred album art, then gradient */}
      {hasExternalArt ? (
        <Box
          component="img"
          src={artistImage}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : item.bannerArt ? (
        <Box
          component="img"
          src={getMediaUrl(item.bannerArt)}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(50px) brightness(0.35) saturate(1.5)',
            transform: 'scale(1.3)',
          }}
        />
      ) : (
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        }} />
      )}

      {/* Bottom gradient overlay for text legibility */}
      <Box sx={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: '100%',
        height: '60%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)',
        pointerEvents: 'none',
      }} />

      {/* Text content */}
      <Box sx={{ position: 'relative', p: 4, width: '100%' }}>
        <Typography sx={{
          fontSize: 48,
          fontWeight: 800,
          color: 'text.primary',
          textShadow: '0 2px 16px rgba(0,0,0,0.7)',
          lineHeight: 1.1,
        }}>
          {item.artist}
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 1 }}>
          {item.songCount} songs
          {' \u00B7 '}
          {item.albumCount} album{item.albumCount !== 1 ? 's' : ''}
          {item.totalDuration > 0 && ` \u00B7 ${
            Math.floor(item.totalDuration / 3600) > 0
              ? `${Math.floor(item.totalDuration / 3600)}:${Math.floor((item.totalDuration % 3600) / 60).toString().padStart(2, '0')}:${Math.floor(item.totalDuration % 60).toString().padStart(2, '0')}`
              : `${Math.floor(item.totalDuration / 60)}:${Math.floor(item.totalDuration % 60).toString().padStart(2, '0')}`
          }`}
        </Typography>
      </Box>
    </Box>
  );
};

const Home = () => {
  const songs = useLibraryStore(s => s.songs);
  const loading = useLibraryStore(s => s.loading);
  const searchQuery = useLibraryStore(s => s.searchQuery);
  const selectedArtist = useLibraryStore(s => s.selectedArtist);
  const fetchLibrary = useLibraryStore(s => s.fetchLibrary);
  const departingSongPaths = useLibraryStore(s => s.departingSongPaths);

  useEffect(() => {
    fetchLibrary();
  }, []);

  // Filter by selected artist and search query
  const filteredSongs = useMemo(() => {
    let result = songs;

    if (selectedArtist) {
      result = result.filter(s => s.artist === selectedArtist);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.album.toLowerCase().includes(q)
      );
    }

    return result;
  }, [songs, searchQuery, selectedArtist]);

  // Flatten into a virtualized item list: artist banners + album sections
  const items = useMemo(() => {
    const artistMap = new Map<string, Map<string, Song[]>>();

    for (const song of filteredSongs) {
      if (!artistMap.has(song.artist)) {
        artistMap.set(song.artist, new Map());
      }
      const albumMap = artistMap.get(song.artist)!;
      if (!albumMap.has(song.album)) {
        albumMap.set(song.album, []);
      }
      albumMap.get(song.album)!.push(song);
    }

    const sorted = [...artistMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const flat: ListItem[] = [];
    const hasDepartures = departingSongPaths.size > 0;

    for (const [artist, albums] of sorted) {
      const allTracks = [...albums.values()];
      const firstWithArt = allTracks.find(tracks => tracks.some(t => t.art));
      const bannerArt = firstWithArt?.find(t => t.art)?.art || null;

      // Check if every song under this artist is departing
      const artistDeparting = hasDepartures &&
        allTracks.every(tracks => tracks.every(t => departingSongPaths.has(t.path)));

      flat.push({
        type: 'artist-banner',
        artist,
        songCount: allTracks.reduce((sum, tracks) => sum + tracks.length, 0),
        albumCount: albums.size,
        totalDuration: allTracks.reduce((sum, tracks) => sum + tracks.reduce((s, t) => s + (t.duration || 0), 0), 0),
        bannerArt,
        departing: artistDeparting,
      });

      for (const [albumName, tracks] of albums.entries()) {
        const allDeparting = hasDepartures &&
          tracks.every(t => departingSongPaths.has(t.path));

        flat.push({
          type: 'album',
          artist,
          albumName,
          tracks,
          artUrl: tracks.find(t => t.art)?.art || null,
          allDeparting,
          departingSongPaths: hasDepartures ? departingSongPaths : undefined,
        });
      }
    }

    return flat;
  }, [filteredSongs, departingSongPaths]);

  const renderItem = useCallback((_index: number, item: ListItem) => {
    if (item.type === 'artist-banner') {
      return <ArtistBanner item={item} />;
    }
    return (
      <AlbumSection
        albumName={item.albumName}
        tracks={item.tracks}
        artUrl={item.artUrl}
        artistName={item.artist}
        allDeparting={item.allDeparting}
        departingSongPaths={item.departingSongPaths}
      />
    );
  }, []);

  if (loading && songs.length === 0) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        gap: 2,
      }}>
        <CircularProgress sx={{ color: 'primary.main' }} />
        <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
          Loading your library...
        </Typography>
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        gap: 1,
      }}>
        <Box sx={{ color: 'text.disabled', mb: 1 }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        </Box>
        <Typography sx={{ color: 'text.secondary', fontSize: 18, fontWeight: 600 }}>
          {searchQuery ? 'No results found' : 'Your library is empty'}
        </Typography>
        <Typography sx={{ color: 'text.disabled', fontSize: 14 }}>
          {searchQuery ? 'Try a different search' : 'Add music files to your Music folder and restart'}
        </Typography>
      </Box>
    );
  }

  return (
    <Virtuoso
      style={{ height: '100%' }}
      data={items}
      overscan={400}
      itemContent={renderItem}
      components={{
        List: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, children, ...props }, ref) => (
          <div ref={ref} style={{ ...style, padding: '24px' }} {...props}>
            {children}
          </div>
        )),
      }}
    />
  );
};

export default Home;
