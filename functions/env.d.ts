// Cloudflare Pages environment bindings
export interface Env {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
  MISTRAL_API_KEY?: string
  ALLOWED_EMAILS?: string  // comma-separated list of emails allowed to use server keys
  WP_URL: string
  WP_USERNAME: string
  WP_PASSWORD: string
  TUNNEL_URL: string
  TUNNEL_SECRET: string
  // Computer relay is owner-only. Set COMPUTER_RELAY_ENABLED='true' and
  // COMPUTER_RELAY_OWNER_SUB to the Google `sub` of the owner to enable
  // /api/computer/relay. When not set, the endpoint returns 404.
  COMPUTER_RELAY_ENABLED?: string
  COMPUTER_RELAY_OWNER_SUB?: string
  GOOGLE_VISION_API_KEY?: string
  DB: D1Database  // Cloudflare D1 binding
}
