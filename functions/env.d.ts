// Cloudflare Pages environment bindings
export interface Env {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
  MISTRAL_API_KEY?: string
  OPENAI_API_KEY?: string
  ALLOWED_EMAILS?: string  // comma-separated list of emails allowed to use server keys
  DAILY_QUOTA_PER_USER?: string  // daily cap on server-key proxy calls per whitelisted email (default 50)
  DAILY_QUOTA_PER_MODEL?: string // optional JSON map { "claude-sonnet-4-6": 100, "whisper-1": 500, "default": 500 } — if set, overrides DAILY_QUOTA_PER_USER and applies per-model
  WP_URL: string
  WP_USERNAME: string
  WP_PASSWORD: string
  // WordPress utilise un seul jeu d'identifiants partagé. Restriction aux
  // emails listés (séparés par virgule/espace) pour éviter que tout user
  // authentifié puisse écrire/supprimer des posts. Si vide, fallback sur
  // ALLOWED_EMAILS.
  WORDPRESS_OWNER_EMAILS?: string
  TUNNEL_URL: string
  TUNNEL_SECRET: string
  // Computer relay is owner-only. Set COMPUTER_RELAY_ENABLED='true' and
  // COMPUTER_RELAY_OWNER_SUB to the Google `sub` of the owner to enable
  // /api/computer/relay. When not set or not matching, the endpoint returns 404.
  COMPUTER_RELAY_ENABLED?: string
  COMPUTER_RELAY_OWNER_SUB?: string
  GOOGLE_VISION_API_KEY?: string
  GOOGLE_MAPS_API_KEY?: string  // Geocoding API key — reverse geocoding server-side (BUG: Arty devinait la ville en 1.0.29)
  DB: D1Database  // Cloudflare D1 binding
  KV: KVNamespace  // Cloudflare KV binding — premium cap counters per user/month
  LEMONSQUEEZY_WEBHOOK_SECRET?: string  // HMAC-SHA256 secret for verifying Lemon Squeezy webhook signatures
  DEBUG?: string  // If set, enables verbose debug logs (e.g. VIP bypass email fragments)
  // Web search proxy (utilisé par Mistral via /api/search/web pour ajouter
  // une capacité recherche en temps réel — Anthropic et Gemini ont déjà
  // leurs tools natifs). 'linkup' par défaut, 'brave' en alternative.
  SEARCH_PROVIDER?: 'linkup' | 'brave'
  LINKUP_API_KEY?: string  // https://app.linkup.so/ — 1k req/mois free, EU-hosted
  BRAVE_SEARCH_API_KEY?: string  // https://api.search.brave.com/ — index indépendant
}
