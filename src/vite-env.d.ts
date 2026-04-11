/// <reference types="vite/client" />

interface ImportMetaEnv {
  // NEVER add VITE_*_API_KEY here — API keys must stay server-side only
  readonly VITE_GOOGLE_CLIENT_ID: string
  readonly VITE_GOOGLE_REDIRECT_URI: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
