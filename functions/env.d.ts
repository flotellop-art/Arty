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
}
