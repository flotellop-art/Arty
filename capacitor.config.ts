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
      // 'none' = we track the keyboard height manually via plugin events and
      // expose it as a CSS var `--kb-height` (see src/main.tsx). Root layout
      // uses `h-[calc(100dvh-var(--kb-height,0px))]` so the InputBar stays
      // just above the keyboard regardless of the Android windowSoftInputMode.
      // 'native' + adjustResize in the manifest was not reliable across
      // Android launchers (InputBar still got pushed to the top on some
      // devices). Manual handling works uniformly.
      resize: 'none',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      // 'DARK' = dark-colored icons/text (for use over a light background).
      // Our paper cream bg (#FAF3E7) needs dark icons; 'LIGHT' made them
      // white → invisible / washed out.
      style: 'DARK',
      backgroundColor: '#FAF3E7',
    },
  },
};

export default config;
