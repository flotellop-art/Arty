import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arty.app',
  appName: 'Arty',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  android: {
    // Force correct pixel density — prevents the WebView from scaling
    // up/down on high-DPI screens and making the UI look too small/large.
    // "device" uses the actual screen density (recommended for Capacitor apps).
    initialFocus: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#FAF6F0',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#FAF6F0',
    },
  },
};

export default config;
