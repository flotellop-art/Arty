/// <reference types="vite/client" />

interface ImportMetaEnv {
  // NEVER add VITE_*_API_KEY here — API keys must stay server-side only
  readonly VITE_GOOGLE_CLIENT_ID: string
  readonly VITE_GOOGLE_REDIRECT_URI: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Injected by vite.config.ts `define` at build time. Used by SettingsModal
// to confirm the JS bundle is actually fresh (separate from Android's
// versionName which comes from build.gradle).
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
