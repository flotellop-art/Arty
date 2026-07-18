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
      backgroundColor: '#F4EFE5',
      showSpinner: false,
    },
    Keyboard: {
      // `resize` only applies to iOS. Android is handled by adjustNothing plus
      // the viewport controller in main.tsx.
      resize: 'body',
      style: 'dark',
      // Keep Capacitor's Android full-screen workaround disabled. With Arty's
      // edge-to-edge WebView it changes the native child height while
      // visualViewport also reports the IME occlusion, which reduces the app
      // twice and exposes a white strip above the keyboard.
      resizeOnFullScreen: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      // 'DARK' = dark-colored icons/text (for use over a light background).
      // Our paper cream bg (#F4EFE5) needs dark icons; 'LIGHT' made them
      // white → invisible / washed out.
      style: 'DARK',
      backgroundColor: '#F4EFE5',
    },
  },
};

export default config;
