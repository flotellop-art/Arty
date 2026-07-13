// Cloudflare Pages environment bindings
export interface Env {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  // PR-0 (CDC Phase 1 D26/D29) — variable d'ÉCHAPPEMENT des tombstones.
  // Les connecteurs Gmail/Drive/Contacts/Sheets répondent 410 PAR DÉFAUT
  // (« coupure immédiate », décision du 13 juillet 2026). Poser 'true' ici
  // réactive les handlers historiques. Rollback d'urgence uniquement, à ne
  // jamais laisser durablement. NB Cloudflare Pages : un changement de
  // variable ne s'applique qu'au prochain déploiement → poser la var PUIS
  // « Retry deployment » (~2 min, sans revert de code).
  LEGACY_GOOGLE_CONNECTORS_ENABLED?: string
  // Workspace Add-on HTTP — Phase 0 uniquement. Toutes les valeurs sont
  // serveur-only et le flag doit valoir exactement "true" pour ouvrir les routes.
  WORKSPACE_ADDON_PHASE0_ENABLED?: string
  WORKSPACE_ADDON_PHASE0_BASE_URL?: string
  WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID?: string
  WORKSPACE_ADDON_PHASE0_SERVICE_ACCOUNT_EMAIL?: string
  WORKSPACE_ADDON_PHASE0_HOST_ACTION_SHAPE?: 'rpc' | 'legacy'
  // Base D1 dédiée au spike : ne jamais la lier à DB prod/bêta.
  WORKSPACE_ADDON_PHASE0_DB?: D1Database
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
  MISTRAL_API_KEY?: string
  OPENAI_API_KEY?: string
  /** Black Forest Labs (FLUX) — génération d'images, endpoint EU. P1.3-FLUX. */
  BFL_API_KEY?: string
  ALLOWED_EMAILS?: string  // comma-separated list of emails allowed to use server keys
  DAILY_QUOTA_PER_USER?: string  // daily cap on server-key proxy calls per whitelisted email (default 50)
  DAILY_QUOTA_PER_MODEL?: string // optional JSON map { "claude-sonnet-5": 100, "whisper-1": 500, "default": 500 } — if set, overrides DAILY_QUOTA_PER_USER and applies per-model. ⚠️ exact-match keys: rename them on Cloudflare at each model migration (cf. quota.ts)
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
  GOOGLE_VISION_API_KEY?: string  // DEAD CONFIG — plus aucun code ne la lit (OCR Vision retiré, PDF lus nativement par Claude). Conservée le temps de retirer la var sur Cloudflare.
  GOOGLE_MAPS_API_KEY?: string  // Geocoding API key — reverse geocoding server-side (BUG: Arty devinait la ville en 1.0.29)
  DB: D1Database  // Cloudflare D1 binding
  KV: KVNamespace  // Cloudflare KV binding — premium cap counters per user/month
  LEMONSQUEEZY_WEBHOOK_SECRET?: string  // HMAC-SHA256 secret for verifying Lemon Squeezy webhook signatures
  CREEM_WEBHOOK_SECRET?: string  // HMAC-SHA256 secret (hex) pour vérifier les webhooks Creem (crédits prépayés)
  CREEM_API_KEY?: string  // clé serveur Creem (creem_test_… / creem_live_…) pour créer des checkouts. JAMAIS de préfixe VITE_ (RÈGLE 1) — passe en header x-api-key
  CREEM_API_BASE?: string  // override optionnel du host Creem (défaut: dérivé du préfixe de la clé → test-api.creem.io / api.creem.io)
  CREEM_CREDITS_10_PRODUCT_ID?: string  // product_id de l'environnement Creem actif ; configurer séparément en test/live
  RECONCILE_SECRET?: string  // secret partagé pour déclencher GET /api/billing/reconcile depuis un Cron externe (owner-only)
  // Web search proxy (utilisé par Mistral via /api/search/web pour ajouter
  // une capacité recherche en temps réel — Anthropic et Gemini ont déjà
  // leurs tools natifs). 'linkup' par défaut, 'brave' en alternative.
  SEARCH_PROVIDER?: 'linkup' | 'brave'
  LINKUP_API_KEY?: string  // https://app.linkup.so/ — 1k req/mois free, EU-hosted
  BRAVE_SEARCH_API_KEY?: string  // https://api.search.brave.com/ — index indépendant
  // Essai par email (OTP) — identité sans Google. TOUS serveur-only (RÈGLE 1) :
  // ne JAMAIS préfixer VITE_ (un secret HMAC dans le bundle = forge illimitée).
  RESEND_API_KEY?: string         // clé Resend pour l'envoi des codes OTP (transactional email)
  EMAIL_FROM?: string             // expéditeur vérifié chez Resend, ex: "Arty <noreply@tryarty.com>"
  EMAIL_TRIAL_SECRET?: string     // secret HMAC qui keye le hash des OTP (CRIT-2). Aléatoire, ≥32 chars.
  TURNSTILE_SECRET_KEY?: string   // anti-bot request-otp. OBLIGATOIRE en prod : son absence sur un host
                                  // prod bloque request-otp en 503 (fail-closed C2/F-10). Optionnel en dev/preview.
}
