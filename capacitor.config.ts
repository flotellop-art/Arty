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
      backgroundColor: '#FAF3E7',
      showSpinner: false,
    },
    Keyboard: {
      // 'native' = Capacitor resizes the WebView itself when the keyboard
      // opens. This keeps CSS height/flex math intact (100dvh stays
      // accurate) and prevents the composer InputBar from snapping to
      // the top of the screen — which 'body' mode was causing.
      resize: 'native',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      // Ember paper bg is light → Android system icons must be DARK
      // (LIGHT style paints icons white which is invisible on #FAF3E7).
      style: 'DARK',
      backgroundColor: '#FAF3E7',
    },
  },
};

export default config;
