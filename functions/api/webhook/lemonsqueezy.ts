import type { Env } from '../../env'

// Product IDs Lemon Squeezy — figés côté store, on les hardcode ici plutôt
// que d'avoir une variable d'env pour qu'un changement nécessite une review
// du code (un attaquant qui contrôlerait le panel CF Pages ne pourrait pas
// rediriger des paiements vers un autre plan).
const PRODUCT_ID_ARTY_PRO = 1004485
const PRODUCT_ID_PREMIUM_PACK = 1004493

const PREMIUM_PACK_MESSAGES_TOTAL = 100
const LICENSE_MAX_ACTIVATIONS = 3

interface LemonSqueezyMeta {
  event_name?: string
}

interface LemonSqueezyAttributes {
  user_email?: string
  customer_id?: number | string
  variant_id?: number | string
  status?: string
  renews_at?: string | null
  ends_at?: string | null
  updated_at?: string | null
  first_order_item?: {
    product_id?: number
    variant_id?: number
  }
  // Présents sur l'objet License Key (événement `license_key_created`).
  key?: string
  order_id?: number | string
  activation_limit?: number
}

interface LemonSqueezyData {
  id?: string
  type?: string
  attributes?: LemonSqueezyAttributes
}

interface LemonSqueezyIncluded {
  id?: string
  type?: string
  attributes?: {
    key?: string
    [k: string]: unknown
  }
}

interface LemonSqueezyWebhookPayload {
  meta?: LemonSqueezyMeta
  data?: LemonSqueezyData
  included?: LemonSqueezyIncluded[]
}

/**
 * Vérifie la signature HMAC-SHA256 du body brut contre le secret du webhook.
 * Comparaison constant-time pour éviter les timing attacks. Retourne true
 * si la signature en hex matche celle reçue dans le header X-Signature.
 */
export async function verifySignature(
  rawBody: ArrayBuffer,
  signatureHex: string,
  secret: string
): Promise<boolean> {
  if (!signatureHex || !secret) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, rawBody)

  const computedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (computedHex.length !== signatureHex.length) return false

  let diff = 0
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ signatureHex.charCodeAt(i)
  }
  return diff === 0
}

type SubscriptionStatus =
  | 'active'
  | 'on_trial'
  | 'paused'
  | 'past_due'
  | 'unpaid'
  | 'cancelled'
  | 'expired'

/** Mappe le status Lemon Squeezy vers notre vocabulaire interne. */
function mapSubscriptionStatus(raw: string | undefined): SubscriptionStatus | null {
  switch (raw) {
    case 'active':
    case 'on_trial':
    case 'paused':
    case 'past_due':
    case 'unpaid':
    case 'cancelled':
    case 'expired':
      return raw
    default:
      return null
  }
}

function normalizeProviderTimestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function subscriptionPeriodEnd(attrs: LemonSqueezyAttributes): string | null {
  // A cancelled/expired subscription exposes its paid-through date in ends_at.
  return attrs.ends_at ?? attrs.renews_at ?? null
}

const MONOTONIC_SUBSCRIPTION_UPDATE = `
  subscriptions.provider_updated_at IS NULL
  OR (
    excluded.provider_updated_at IS NOT NULL
    AND (
      excluded.provider_updated_at > subscriptions.provider_updated_at
      OR (
        excluded.provider_updated_at = subscriptions.provider_updated_at
        AND CASE excluded.status
          WHEN 'expired' THEN 70
          WHEN 'cancelled' THEN 60
          WHEN 'unpaid' THEN 50
          WHEN 'past_due' THEN 40
          WHEN 'paused' THEN 30
          WHEN 'on_trial' THEN 20
          WHEN 'active' THEN 10
          ELSE 0 END
        >= CASE subscriptions.status
          WHEN 'expired' THEN 70
          WHEN 'cancelled' THEN 60
          WHEN 'unpaid' THEN 50
          WHEN 'past_due' THEN 40
          WHEN 'paused' THEN 30
          WHEN 'on_trial' THEN 20
          WHEN 'active' THEN 10
          ELSE 0 END
      )
    )
  )`

/** N'affiche que le domaine de l'email pour les logs (privacy). */
function maskEmail(email: string | undefined): string {
  if (!email) return '<no-email>'
  const at = email.indexOf('@')
  if (at < 0) return '***'
  return `***@${email.slice(at + 1)}`
}

// ─────────────────────────────────────────────────────────────────────────
// Schémas alignés sur la PROD (migration 0002) — réconciliation 15 juin 2026.
// La prod a été créée par migrations/0002 (id PK AUTOINCREMENT, colonnes
// `ls_order_id`/`activation_count`, timestamps TEXT) mais le code attendait un
// autre schéma (user_email PK, `order_id`/`activations`, timestamps INTEGER) →
// tous les achats (abonnement/licence/pack) échouaient silencieusement.
// Ces `ensureXxxTable` décrivent désormais le VRAI schéma (no-op sur la prod
// existante via IF NOT EXISTS, mais correct pour une D1 fraîche).
// L'index UNIQUE sur subscriptions(user_email) est ce qui fait fonctionner les
// `ON CONFLICT(user_email)` (0 doublon en prod, vérifié) — voir aussi
// migrations/0005.
// ─────────────────────────────────────────────────────────────────────────
async function ensureSubscriptionsTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        ls_subscription_id TEXT UNIQUE,
        ls_customer_id TEXT,
        ls_variant_id TEXT,
        status TEXT NOT NULL DEFAULT 'inactive',
        plan_type TEXT NOT NULL DEFAULT 'free',
        current_period_end TEXT,
        provider_updated_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run()
  const columns = await db
    .prepare(`PRAGMA table_info(subscriptions)`)
    .all<{ name: string }>()
  if (!(columns.results ?? []).some((column) => column.name === 'provider_updated_at')) {
    try {
      await db.prepare(`ALTER TABLE subscriptions ADD COLUMN provider_updated_at TEXT`).run()
    } catch (error) {
      // Deux webhooks peuvent initialiser une ancienne base en parallèle. Ne
      // tolérer l'échec que si l'autre requête a effectivement ajouté la colonne.
      const refreshed = await db
        .prepare(`PRAGMA table_info(subscriptions)`)
        .all<{ name: string }>()
      if (!(refreshed.results ?? []).some((column) => column.name === 'provider_updated_at')) {
        throw error
      }
    }
  }
  // Les lignes créées avant l'ajout de provider_updated_at doivent elles aussi
  // être protégées contre un premier webhook ancien. Leur updated_at local est
  // une borne conservatrice : tout événement fournisseur antérieur est rejeté,
  // tandis qu'un événement réellement plus récent peut encore avancer l'état.
  await db.prepare(
    `UPDATE subscriptions
     SET provider_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
     WHERE provider_updated_at IS NULL AND updated_at IS NOT NULL`
  ).run()
  // Contrainte d'unicité requise par tous les ON CONFLICT(user_email).
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_email_unique ON subscriptions(user_email)`
    )
    .run()
}

async function ensureLicensesTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        license_key TEXT UNIQUE NOT NULL,
        ls_order_id TEXT UNIQUE,
        ls_product_id TEXT,
        activation_count INTEGER NOT NULL DEFAULT 0,
        max_activations INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run()
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_licenses_user_email ON licenses(user_email)`)
    .run()
}

async function ensurePremiumPacksTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS premium_packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        ls_order_id TEXT UNIQUE NOT NULL,
        messages_total INTEGER NOT NULL DEFAULT 100,
        messages_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run()
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_premium_packs_user_email ON premium_packs(user_email)`)
    .run()
}

async function handleOrderCreated(
  env: Env,
  data: LemonSqueezyData
): Promise<void> {
  const attrs = data.attributes ?? {}
  const productId = attrs.first_order_item?.product_id
  const email = attrs.user_email?.toLowerCase()
  const orderId = data.id ?? ''
  if (!email || !orderId) return

  if (productId === PRODUCT_ID_ARTY_PRO) {
    // La LIGNE `licenses` (avec sa clé) est créée par l'événement
    // `license_key_created` — la clé n'arrive PAS dans le payload `order_created`
    // (bug de capture corrigé le 15 juin : `license_key` restait vide → activation
    // impossible). Ici on accorde seulement l'accès Pro à l'email (la détection
    // Pro par email via `subscriptions` suffit pour débloquer l'app).
    await ensureSubscriptionsTable(env.DB)
    // ON CONFLICT(user_email) plutôt qu'INSERT OR REPLACE : ne PAS écraser un
    // abonnement mensuel existant (ls_subscription_id / current_period_end
    // hors du SET → préservés si l'acheteur Pro avait déjà un abo).
    await env.DB.prepare(
      `INSERT INTO subscriptions
        (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
       VALUES (?1, 'pro', 'active', NULL, ?2, ?3, NULL, datetime('now'))
       ON CONFLICT(user_email) DO UPDATE SET
         plan_type = 'pro',
         status = 'active',
         ls_customer_id = excluded.ls_customer_id,
         ls_variant_id = excluded.ls_variant_id,
         updated_at = datetime('now')`
    )
      .bind(
        email,
        attrs.customer_id != null ? String(attrs.customer_id) : null,
        attrs.variant_id != null ? String(attrs.variant_id) : null
      )
      .run()
    return
  }

  if (productId === PRODUCT_ID_PREMIUM_PACK) {
    await ensurePremiumPacksTable(env.DB)
    await env.DB.prepare(
      // Le replay de `order_created` est normal pour un webhook. REPLACE
      // supprimait puis recréait la ligne et remettait `messages_used` à 0,
      // réattribuant ainsi un pack déjà consommé. L'order id est la clé
      // d'idempotence : le premier event gagne, les suivants sont des no-op.
      `INSERT INTO premium_packs
        (user_email, ls_order_id, messages_total, messages_used, created_at)
       VALUES (?1, ?2, ?3, 0, datetime('now'))
       ON CONFLICT(ls_order_id) DO NOTHING`
    )
      .bind(email, orderId, PREMIUM_PACK_MESSAGES_TOTAL)
      .run()
  }
}

async function handleSubscriptionUpsert(
  env: Env,
  data: LemonSqueezyData
): Promise<void> {
  const attrs = data.attributes ?? {}
  const email = attrs.user_email?.toLowerCase()
  if (!email) return

  const status = mapSubscriptionStatus(attrs.status)
  if (!status) {
    console.warn('[lemonsqueezy] subscription status inconnu — event ignoré')
    return
  }
  const planType = status === 'expired' ? 'inactive' : 'subscription'
  const providerUpdatedAt = normalizeProviderTimestamp(attrs.updated_at)

  await ensureSubscriptionsTable(env.DB)
  await env.DB.prepare(
    `INSERT INTO subscriptions
      (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id,
       current_period_end, provider_updated_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
     ON CONFLICT(user_email) DO UPDATE SET
       plan_type = excluded.plan_type,
       status = excluded.status,
       ls_subscription_id = excluded.ls_subscription_id,
       ls_customer_id = excluded.ls_customer_id,
       ls_variant_id = excluded.ls_variant_id,
       current_period_end = excluded.current_period_end,
       provider_updated_at = excluded.provider_updated_at,
       updated_at = datetime('now')`
     + ` WHERE ${MONOTONIC_SUBSCRIPTION_UPDATE}`
  )
    .bind(
      email,
      planType,
      status,
      data.id ?? null,
      attrs.customer_id != null ? String(attrs.customer_id) : null,
      attrs.variant_id != null ? String(attrs.variant_id) : null,
      subscriptionPeriodEnd(attrs),
      providerUpdatedAt
    )
    .run()
}

async function handleSubscriptionStatusUpdate(
  env: Env,
  data: LemonSqueezyData,
  newStatus: 'cancelled' | 'expired' | 'past_due' | 'active'
): Promise<void> {
  const attrs = data.attributes ?? {}
  const email = attrs.user_email?.toLowerCase()
  if (!email) return

  await ensureSubscriptionsTable(env.DB)

  const planType = newStatus === 'expired' ? 'inactive' : 'subscription'
  const providerUpdatedAt = normalizeProviderTimestamp(attrs.updated_at)

  // Tous les statuts conservent l'accès sauf expired. L'upsert est monotone
  // sur `attributes.updated_at`, donc un ancien event active ne peut jamais
  // réécraser une annulation/expiration plus récente.
  await env.DB.prepare(
    `INSERT INTO subscriptions
      (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id,
       current_period_end, provider_updated_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
     ON CONFLICT(user_email) DO UPDATE SET
       plan_type = excluded.plan_type,
       status = excluded.status,
       ls_subscription_id = COALESCE(subscriptions.ls_subscription_id, excluded.ls_subscription_id),
       ls_customer_id = COALESCE(excluded.ls_customer_id, subscriptions.ls_customer_id),
       ls_variant_id = COALESCE(excluded.ls_variant_id, subscriptions.ls_variant_id),
       current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
       provider_updated_at = excluded.provider_updated_at,
       updated_at = datetime('now')
     WHERE ${MONOTONIC_SUBSCRIPTION_UPDATE}`
  )
    .bind(
      email,
      planType,
      newStatus,
      data.id ?? null,
      attrs.customer_id != null ? String(attrs.customer_id) : null,
      attrs.variant_id != null ? String(attrs.variant_id) : null,
      subscriptionPeriodEnd(attrs),
      providerUpdatedAt
    )
    .run()
}

/**
 * `license_key_created` — porte la vraie clé de licence (objet License Key :
 * `data.attributes.key` + `order_id` + `user_email` + `activation_limit`).
 * `order_created` ne contient PAS la clé, d'où ce handler dédié (bug corrigé
 * le 15 juin : la clé restait vide → `license/activate` ne trouvait jamais la
 * licence). Crée/complète la ligne `licenses` (idempotent via ON CONFLICT sur
 * `ls_order_id` UNIQUE) avec la clé réelle — jamais de placeholder vide.
 */
async function handleLicenseKeyCreated(env: Env, data: LemonSqueezyData): Promise<void> {
  const attrs = data.attributes ?? {}
  const key = typeof attrs.key === 'string' ? attrs.key : ''
  const orderId = attrs.order_id != null ? String(attrs.order_id) : ''
  const email = attrs.user_email?.toLowerCase()
  if (!key || !orderId || !email) return

  const maxActivations =
    typeof attrs.activation_limit === 'number' && attrs.activation_limit > 0
      ? attrs.activation_limit
      : LICENSE_MAX_ACTIVATIONS

  await ensureLicensesTable(env.DB)
  await env.DB.prepare(
    `INSERT INTO licenses
      (user_email, ls_order_id, license_key, status, max_activations, activation_count, created_at)
     VALUES (?1, ?2, ?3, 'active', ?4, 0, datetime('now'))
     ON CONFLICT(ls_order_id) DO UPDATE SET
       license_key = excluded.license_key,
       user_email = excluded.user_email,
       max_activations = excluded.max_activations,
       status = 'active'`
  )
    .bind(email, orderId, key, maxActivations)
    .run()
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    return Response.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  if (!env.DB) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  // Lire le body UNE SEULE FOIS en raw bytes — la signature HMAC se calcule
  // sur les octets exacts envoyés par Lemon Squeezy. Re-sérialiser le JSON
  // changerait l'ordre des clés / espaces / encodage et casserait la sig.
  const rawBody = await request.arrayBuffer()
  const signature = request.headers.get('X-Signature') || ''

  const valid = await verifySignature(rawBody, signature, env.LEMONSQUEEZY_WEBHOOK_SECRET)
  if (!valid) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: LemonSqueezyWebhookPayload
  try {
    const text = new TextDecoder().decode(rawBody)
    payload = JSON.parse(text) as LemonSqueezyWebhookPayload
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventName = payload.meta?.event_name
  if (!eventName || typeof eventName !== 'string') {
    return Response.json({ error: 'Missing event_name' }, { status: 400 })
  }

  const data = payload.data ?? {}
  const email = data.attributes?.user_email
  console.log(`[lemonsqueezy] event=${eventName} user=${maskEmail(email)}`)

  try {
    switch (eventName) {
      case 'order_created':
        await handleOrderCreated(env, data)
        break

      case 'subscription_created':
      case 'subscription_updated':
        await handleSubscriptionUpsert(env, data)
        break

      case 'subscription_cancelled':
        await handleSubscriptionStatusUpdate(env, data, 'cancelled')
        break

      case 'subscription_expired':
        await handleSubscriptionStatusUpdate(env, data, 'expired')
        break

      case 'subscription_payment_failed':
        await handleSubscriptionStatusUpdate(env, data, 'past_due')
        break

      case 'subscription_payment_success':
        await handleSubscriptionStatusUpdate(env, data, 'active')
        break

      case 'license_key_created':
        // C'est CET événement qui porte la vraie clé de licence (pas
        // `order_created`) → il crée/complète la ligne `licenses`.
        await handleLicenseKeyCreated(env, data)
        break

      default:
        // Événement inconnu — répondre 200 pour éviter les retries Lemon Squeezy.
        break
    }
  } catch (err) {
    console.error('[lemonsqueezy] handler failed', err)
    return Response.json({ error: 'Handler error' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
