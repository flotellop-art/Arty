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
  first_order_item?: {
    product_id?: number
    variant_id?: number
  }
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
async function verifySignature(
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

/** Mappe le status Lemon Squeezy vers notre vocabulaire interne. */
function mapSubscriptionStatus(raw: string | undefined): string {
  switch (raw) {
    case 'active':
      return 'active'
    case 'cancelled':
      return 'cancelled'
    case 'expired':
      return 'expired'
    case 'past_due':
      return 'past_due'
    default:
      return 'inactive'
  }
}

/** N'affiche que le domaine de l'email pour les logs (privacy). */
function maskEmail(email: string | undefined): string {
  if (!email) return '<no-email>'
  const at = email.indexOf('@')
  if (at < 0) return '***'
  return `***@${email.slice(at + 1)}`
}

async function ensureSubscriptionsTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS subscriptions (
        user_email TEXT PRIMARY KEY,
        plan_type TEXT NOT NULL,
        status TEXT NOT NULL,
        ls_subscription_id TEXT,
        ls_customer_id TEXT,
        ls_variant_id TEXT,
        current_period_end TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`
    )
    .run()
}

async function ensureLicensesTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS licenses (
        user_email TEXT NOT NULL,
        order_id TEXT NOT NULL,
        license_key TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        max_activations INTEGER NOT NULL DEFAULT 3,
        activations INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_email, order_id)
      )`
    )
    .run()
}

async function ensurePremiumPacksTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS premium_packs (
        user_email TEXT NOT NULL,
        order_id TEXT NOT NULL,
        messages_total INTEGER NOT NULL,
        messages_used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_email, order_id)
      )`
    )
    .run()
}

async function handleOrderCreated(
  env: Env,
  data: LemonSqueezyData,
  included: LemonSqueezyIncluded[] | undefined
): Promise<void> {
  const attrs = data.attributes ?? {}
  const productId = attrs.first_order_item?.product_id
  const email = attrs.user_email?.toLowerCase()
  const orderId = data.id ?? ''
  if (!email || !orderId) return

  if (productId === PRODUCT_ID_ARTY_PRO) {
    const licenseKey =
      included?.find((i) => i.type === 'license-keys')?.attributes?.key ?? ''

    await ensureLicensesTable(env.DB)
    await env.DB.prepare(
      `INSERT INTO licenses
        (user_email, order_id, license_key, status, max_activations, activations, created_at)
       VALUES (?1, ?2, ?3, 'active', ?4, 0, unixepoch())
       ON CONFLICT(user_email, order_id) DO UPDATE SET
         license_key = CASE
           WHEN licenses.license_key = '' AND excluded.license_key <> '' THEN excluded.license_key
           ELSE licenses.license_key
         END,
         status = 'active',
         max_activations = MAX(licenses.max_activations, excluded.max_activations)`
    )
      .bind(email, orderId, licenseKey, LICENSE_MAX_ACTIVATIONS)
      .run()

    await ensureSubscriptionsTable(env.DB)
    await env.DB.prepare(
      `INSERT INTO subscriptions
        (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
       VALUES (?1, 'pro', 'active', NULL, ?2, ?3, NULL, unixepoch())
       ON CONFLICT(user_email) DO UPDATE SET
         plan_type = CASE
           WHEN subscriptions.plan_type = 'vip' THEN 'vip'
           ELSE 'pro'
         END,
         status = 'active',
         ls_customer_id = COALESCE(excluded.ls_customer_id, subscriptions.ls_customer_id),
         ls_variant_id = COALESCE(excluded.ls_variant_id, subscriptions.ls_variant_id),
         updated_at = unixepoch()`
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
      `INSERT INTO premium_packs
        (user_email, order_id, messages_total, messages_used, created_at)
       VALUES (?1, ?2, ?3, 0, unixepoch())
       ON CONFLICT(user_email, order_id) DO UPDATE SET
         messages_total = MAX(premium_packs.messages_total, excluded.messages_total),
         created_at = premium_packs.created_at`
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
  const planType = status === 'active' ? 'subscription' : 'inactive'

  await ensureSubscriptionsTable(env.DB)
  await env.DB.prepare(
    `INSERT INTO subscriptions
      (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
     ON CONFLICT(user_email) DO UPDATE SET
       plan_type = CASE
         WHEN subscriptions.plan_type IN ('pro', 'vip') THEN subscriptions.plan_type
         ELSE excluded.plan_type
       END,
       status = CASE
         WHEN subscriptions.plan_type IN ('pro', 'vip') THEN 'active'
         ELSE excluded.status
       END,
       ls_subscription_id = excluded.ls_subscription_id,
       ls_customer_id = excluded.ls_customer_id,
       ls_variant_id = excluded.ls_variant_id,
       current_period_end = excluded.current_period_end,
       updated_at = unixepoch()`
  )
    .bind(
      email,
      planType,
      status,
      data.id ?? null,
      attrs.customer_id != null ? String(attrs.customer_id) : null,
      attrs.variant_id != null ? String(attrs.variant_id) : null,
      attrs.renews_at ?? null
    )
    .run()
}

async function handleSubscriptionStatusUpdate(
  env: Env,
  data: LemonSqueezyData,
  newStatus: 'cancelled' | 'expired' | 'past_due' | 'active',
  options: { resetPlanToInactive?: boolean; updateRenewsAt?: boolean } = {}
): Promise<void> {
  const attrs = data.attributes ?? {}
  const email = attrs.user_email?.toLowerCase()
  if (!email) return

  await ensureSubscriptionsTable(env.DB)

  const planType =
    options.resetPlanToInactive ? 'inactive' : newStatus === 'active' ? 'subscription' : null

  // Update si la ligne existe ; sinon on l'insère pour ne pas perdre l'event.
  // (Cas typique : payment_success arrive avant le subscription_created si
  // le webhook subscription_created a échoué une 1ère fois.)
  if (planType !== null && options.updateRenewsAt) {
    await env.DB.prepare(
      `INSERT INTO subscriptions
        (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
       ON CONFLICT(user_email) DO UPDATE SET
         plan_type = CASE
           WHEN subscriptions.plan_type IN ('pro', 'vip') THEN subscriptions.plan_type
           ELSE excluded.plan_type
         END,
         status = CASE
           WHEN subscriptions.plan_type IN ('pro', 'vip') THEN 'active'
           ELSE excluded.status
         END,
         current_period_end = CASE
           WHEN subscriptions.plan_type IN ('pro', 'vip') THEN subscriptions.current_period_end
           ELSE excluded.current_period_end
         END,
         updated_at = unixepoch()`
    )
      .bind(
        email,
        planType,
        newStatus,
        data.id ?? null,
        attrs.customer_id != null ? String(attrs.customer_id) : null,
        attrs.variant_id != null ? String(attrs.variant_id) : null,
        attrs.renews_at ?? null
      )
      .run()
    return
  }

  if (planType !== null) {
    await env.DB.prepare(
      `INSERT INTO subscriptions
        (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
       ON CONFLICT(user_email) DO UPDATE SET
         plan_type = CASE
           WHEN subscriptions.plan_type IN ('pro', 'vip') THEN subscriptions.plan_type
           ELSE excluded.plan_type
         END,
         status = CASE
           WHEN subscriptions.plan_type IN ('pro', 'vip') THEN 'active'
           ELSE excluded.status
         END,
         updated_at = unixepoch()`
    )
      .bind(
        email,
        planType,
        newStatus,
        data.id ?? null,
        attrs.customer_id != null ? String(attrs.customer_id) : null,
        attrs.variant_id != null ? String(attrs.variant_id) : null,
        attrs.renews_at ?? null
      )
      .run()
    return
  }

  // past_due : on garde le plan_type existant (l'utilisateur a encore accès
  // jusqu'à la fin de la période en cours), seul le status change.
  await env.DB.prepare(
    `UPDATE subscriptions
     SET status = CASE
           WHEN plan_type IN ('pro', 'vip') THEN 'active'
           ELSE ?1
         END,
         updated_at = unixepoch()
     WHERE user_email = ?2`
  )
    .bind(newStatus, email)
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
        await handleOrderCreated(env, data, payload.included)
        break

      case 'subscription_created':
      case 'subscription_updated':
        await handleSubscriptionUpsert(env, data)
        break

      case 'subscription_cancelled':
        await handleSubscriptionStatusUpdate(env, data, 'cancelled', {
          resetPlanToInactive: true,
        })
        break

      case 'subscription_expired':
        await handleSubscriptionStatusUpdate(env, data, 'expired', {
          resetPlanToInactive: true,
        })
        break

      case 'subscription_payment_failed':
        await handleSubscriptionStatusUpdate(env, data, 'past_due')
        break

      case 'subscription_payment_success':
        await handleSubscriptionStatusUpdate(env, data, 'active', {
          updateRenewsAt: true,
        })
        break

      case 'license_key_created':
        // Déjà traité dans order_created (la license key arrive dans included[]).
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
