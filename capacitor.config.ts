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
      // 'native' triggers Android SOFT_INPUT_ADJUST_RESIZE on the activity
      // (combined with `android:windowSoftInputMode="adjustResize"` in the
      // manifest). The WebView shrinks when the keyboard opens, so `100dvh`
      // and `position: fixed inset-0` (modals) both follow the available
      // viewport. Required for ProfileSetupModal/SettingsModal to keep
      // their inputs above the keyboard.
      resize: 'native',
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
