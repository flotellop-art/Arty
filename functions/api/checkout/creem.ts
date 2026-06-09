import type { Env } from '../../env'
import { verifyTokenViaTokeninfo, notFoundResponse } from '../_lib/checkAllowedUser'
import { consumeCapAtomic } from '../_lib/atomicQuota'

// ─────────────────────────────────────────────────────────────────────
// POST /api/checkout/creem — crée un checkout Creem pour acheter des crédits.
//
// Pourquoi un endpoint serveur plutôt qu'un lien statique : il stampe l'email
// Google VÉRIFIÉ dans `metadata.app_user_email`, que Creem ré-émet dans le
// webhook `checkout.completed`. Le crédit atterrit donc TOUJOURS sur le bon
// wallet, même si l'acheteur modifie l'email sur la page de paiement Creem
// (customer.email est éditable ; metadata posé côté serveur ne l'est pas).
//
// Sécurité (RÈGLE 6) :
//  - Auth : `verifyTokenViaTokeninfo` (valide `aud == GOOGLE_CLIENT_ID` +
//    `email_verified`). Ouvert à tout user Google — acheter des crédits n'est
//    pas réservé à la whitelist ALLOWED_EMAILS.
//  - Le `product_id` n'est JAMAIS fourni par le client : mapping pack→product
//    figé ici (le client n'envoie qu'une clé de pack en allowlist).
//  - Anti-abus : cap de créations de checkout par email/jour (fail-open D1).
//  - `success_url` construit CÔTÉ SERVEUR (jamais depuis le body → pas
//    d'open-redirect via une page de confiance Creem).
//  - Clé Creem en header `x-api-key`, jamais dans l'URL (BUG 7), jamais loggée.
//  - Erreurs génériques au client (pas de fuite du status/body Creem — N-2).
//  - 404 si la feature n'est pas configurée (ne révèle pas l'état de config).
// ─────────────────────────────────────────────────────────────────────

// pack (envoyé par le client) → product_id Creem. Le MONTANT de crédits accordé
// est défini par le webhook (CREEM_CREDIT_PRODUCTS, creem.ts) à partir du
// product_id — source unique de vérité côté argent. Ici on choisit uniquement
// QUEL produit acheter, pas combien de crédits il vaut.
const CREEM_PACKS: Record<string, { productId: string }> = {
  // ⚠️ IDs de mode TEST — à remplacer par les prod_ LIVE au go-live.
  credits_10: { productId: 'prod_5ba1P24WLXkcXUnbZytWm7' }, // Pack 10 € = 1000 crédits
}

const CHECKOUTS_PER_DAY = 20
const CREEM_FETCH_TIMEOUT_MS = 10_000

/**
 * Origins natifs/local : Creem refuse les schemes custom (`capacitor://`) et un
 * `localhost` n'est pas une cible de redirection utile → on force le domaine
 * prod. Même esprit que BUG 28 (redirect_uri natif vers l'URL Cloudflare).
 */
function isNativeOrigin(origin: string): boolean {
  return (
    origin === 'capacitor://localhost' ||
    origin === 'https://localhost' ||
    origin === 'http://localhost' ||
    origin.startsWith('capacitor://')
  )
}

/**
 * Construit un `success_url` https sûr. Web : l'Origin (déjà validé whitelist
 * par le middleware pour tout POST) s'il est https. Natif/local/malformé :
 * domaine prod. JAMAIS dérivé du body (défense en profondeur contre
 * l'open-redirect même si le middleware évoluait).
 */
function buildSuccessUrl(origin: string): string {
  let base = 'https://tryarty.com'
  if (origin && !isNativeOrigin(origin)) {
    try {
      const u = new URL(origin)
      if (u.protocol === 'https:') base = u.origin
    } catch {
      /* origin malformé → prod */
    }
  }
  return `${base}/?checkout=credits`
}

/**
 * Host Creem : override explicite (`CREEM_API_BASE`), sinon dérivé du préfixe
 * de la clé (`creem_test_` → test-api, `creem_…` → api). null si le préfixe est
 * inattendu (fail-closed : ne jamais envoyer une clé de test au host live ou
 * inversement sur une faute de frappe de variable d'env).
 */
function resolveCreemBase(env: Env): string | null {
  if (env.CREEM_API_BASE) return env.CREEM_API_BASE.replace(/\/+$/, '')
  const key = env.CREEM_API_KEY ?? ''
  if (key.startsWith('creem_test_')) return 'https://test-api.creem.io'
  if (key.startsWith('creem_')) return 'https://api.creem.io'
  return null
}

async function ensureCheckoutQuotaTable(env: Env): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS checkout_quota (
        email TEXT NOT NULL,
        day TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (email, day)
      )`
    ).run()
  } catch (err) {
    console.error('[checkout] ensure quota table failed', err)
  }
}

interface CheckoutBody {
  pack?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Feature non configurée → 404 (ne révèle pas l'état de config — RÈGLE 6 leak).
  if (!env.CREEM_API_KEY) return notFoundResponse()

  const base = resolveCreemBase(env)
  if (!base) {
    console.error('[checkout] CREEM_API_KEY: préfixe inattendu, refus (fail-closed)')
    return notFoundResponse()
  }

  // Auth : token Google vérifié (aud + email_verified). 404 uniforme sinon.
  const token =
    request.headers.get('x-google-token') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  const email = await verifyTokenViaTokeninfo(token, env.GOOGLE_CLIENT_ID)
  if (!email) return notFoundResponse()

  // Corps : { pack }. Allowlist stricte ; le product_id n'est jamais côté client.
  let body: CheckoutBody
  try {
    body = (await request.json()) as CheckoutBody
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  const pack = body.pack
  if (typeof pack !== 'string' || pack.length > 64 || !CREEM_PACKS[pack]) {
    return notFoundResponse()
  }
  const productId = CREEM_PACKS[pack].productId

  // Anti-abus : cap de créations de checkout par email/jour. Fail-open si D1
  // est down (un incident infra ne doit pas bloquer un achat légitime).
  if (env.DB) {
    await ensureCheckoutQuotaTable(env)
    const day = new Date().toISOString().slice(0, 10)
    const outcome = await consumeCapAtomic(
      env,
      `INSERT INTO checkout_quota (email, day, count, updated_at)
       VALUES (?1, ?2, 1, unixepoch())
       ON CONFLICT (email, day) DO UPDATE SET count = count + 1, updated_at = unixepoch()
         WHERE checkout_quota.count < ?3
       RETURNING count`,
      [email, day, CHECKOUTS_PER_DAY]
    )
    if (outcome.status === 'cap_reached') {
      return Response.json({ error: 'Too many checkout attempts' }, { status: 429 })
    }
  }

  const successUrl = buildSuccessUrl(request.headers.get('origin') || '')

  // Appel Creem. Clé en header `x-api-key` (jamais dans l'URL : BUG 7).
  // metadata.app_user_email = email VÉRIFIÉ → seule autorité de crédit côté
  // webhook. request_id = UUID opaque (jamais l'email : pas de PII dans les
  // URLs/logs Creem). Timeout pour ne pas pendre sur un upstream lent.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CREEM_FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(`${base}/v1/checkouts`, {
      method: 'POST',
      headers: {
        'x-api-key': env.CREEM_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        product_id: productId,
        units: 1,
        customer: { email },
        success_url: successUrl,
        request_id: crypto.randomUUID(),
        metadata: { app_user_email: email, pack },
      }),
      signal: controller.signal,
    })
    const mode = base.indexOf('test-') >= 0 ? 'test' : 'live'
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.error(`[checkout] Creem ${resp.status}: ${detail.slice(0, 300)}`)
      // DIAG TEMP (preview) — remonter la cause Creem au client pour identifier
      // le 502. À RETIRER (RÈGLE 6 leak / N-2 : ne pas refléter l'upstream).
      return Response.json(
        { error: 'Checkout failed', _diag: `creem ${mode} HTTP ${resp.status}: ${detail.slice(0, 160)}` },
        { status: 502 }
      )
    }
    const data = (await resp.json()) as { checkout_url?: string; url?: string }
    const url = data.checkout_url ?? data.url
    if (!url) {
      console.error('[checkout] Creem: pas de checkout_url dans la réponse')
      return Response.json(
        { error: 'Checkout failed', _diag: `creem ${mode} 200 sans checkout_url: ${JSON.stringify(data).slice(0, 160)}` },
        { status: 502 }
      )
    }
    return Response.json({ url })
  } catch (err) {
    console.error('[checkout] Creem fetch failed', err)
    return Response.json(
      { error: 'Checkout failed', _diag: `fetch ${String(err).slice(0, 160)}` },
      { status: 502 }
    )
  } finally {
    clearTimeout(timer)
  }
}
