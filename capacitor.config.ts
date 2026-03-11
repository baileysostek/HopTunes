import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.opentunes.app',
  appName: 'OpenTunes',
  webDir: 'dist-capacitor',
  server: {
    // Serve over HTTP so we can make requests to the desktop Express server
    // without mixed content errors
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
