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
  GOOGLE_VISION_API_KEY?: string
  DB: D1Database  // Cloudflare D1 binding
}
