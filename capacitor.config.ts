import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.physiq.engine',
  appName: 'PhysiQ Engine',
  webDir: 'dist',
  server: {
    allowNavigation: ['world.openfoodfacts.org']
  },
  ios: {
    allowsLinkPreview: false,
    backgroundColor: '#0B0F1A'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      autoHide: false,
      backgroundColor: '#0B0F1A'
    }
  }
};

export default config;
