/// <reference types="vite/client" />

interface ImportMetaEnv {
  // NEVER add VITE_*_API_KEY here — API keys must stay server-side only
  readonly VITE_GOOGLE_CLIENT_ID: string
  readonly VITE_GOOGLE_REDIRECT_URI: string
  // Sitekey PUBLIQUE du widget Cloudflare Turnstile (anti-bot sur l'envoi d'OTP
  // email). Optionnelle : absente → le widget n'est pas rendu et le flux OTP
  // fonctionne sans challenge (le serveur reste fail-open si TURNSTILE_SECRET_KEY
  // n'est pas configurée). NE JAMAIS mettre la secret key ici (RÈGLE 1).
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Injected by vite.config.ts `define` at build time. Used by SettingsModal
// to confirm the JS bundle is actually fresh (separate from Android's
// versionName which comes from build.gradle).
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
// true uniquement sur les builds de preview Cloudflare (jamais en prod) —
// barrière build-time du mode démo (voir vite.config.ts + previewDemo.ts).
declare const __DEMO_ALLOWED__: boolean
