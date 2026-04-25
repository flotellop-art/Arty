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
      // 'body' = Capacitor resizes the body when the keyboard appears, which
      // keeps regular flow content above it on most Android launchers. We
      // additionally listen to keyboardWillShow/keyboardWillHide in main.tsx
      // and expose `--keyboard-height` (CSS px) so screens that opt-in via
      // `.keyboard-aware` get extra padding-bottom for inputs (BYOK key in
      // onboarding, license input in Settings). The legacy `--kb-height`
      // (visualViewport-based, used by `.fixed.inset-0` modals) is kept as
      // a safety net for ROMs where `resize: body` misbehaves.
      resize: 'body',
      style: 'dark',
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
