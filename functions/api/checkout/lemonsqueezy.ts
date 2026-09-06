import type { Env } from '../../env'
import { verifyTokenViaTokeninfo, notFoundResponse } from '../_lib/checkAllowedUser'
import { consumeCapAtomic } from '../_lib/atomicQuota'
import {
  isLemonSqueezyPlan,
  isTrustedLemonSqueezyCheckoutUrl,
  resolveLemonSqueezyStoreId,
  resolveLemonSqueezyVariantId,
} from '../_lib/lemonSqueezyProducts'

// POST /api/checkout/lemonsqueezy — crée un checkout éphémère avec la
// configuration Test ou Live du déploiement Cloudflare. Aucun ID de variante,
// aucune clé API et aucun email d'autorité ne viennent du client.

const LEMON_SQUEEZY_API_URL = 'https://api.lemonsqueezy.com/v1/checkouts'
const CHECKOUT_TIMEOUT_MS = 10_000
const CHECKOUTS_PER_DAY = 20

interface CheckoutBody {
  plan?: unknown
}

async function ensureCheckoutQuotaTable(env: Env): Promise<void> {
  if (!env.DB) return
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS checkout_quota (
      email TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (email, day)
    )`,
  ).run()
}

function buildReturnUrl(origin: string): string {
  try {
    const url = new URL(origin)
    if (url.protocol === 'https:' && (
      url.hostname === 'tryarty.com'
      || url.hostname.endsWith('.appfacade.pages.dev')
    )) {
      return `${url.origin}/upgrade?checkout=lemonsqueezy`
    }
  } catch {
    // Origine absente ou malformée : retour production sûr.
  }
  return 'https://tryarty.com/upgrade?checkout=lemonsqueezy'
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.LEMONSQUEEZY_API_KEY) return notFoundResponse()

  const token =
    request.headers.get('x-google-token')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || ''
  const email = await verifyTokenViaTokeninfo(token, env.GOOGLE_CLIENT_ID)
  if (!email) return notFoundResponse()

  let body: CheckoutBody
  try {
    body = (await request.json()) as CheckoutBody
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!isLemonSqueezyPlan(body.plan)) return notFoundResponse()

  const storeId = resolveLemonSqueezyStoreId(env)
  const variantId = resolveLemonSqueezyVariantId(env, body.plan)
  if (!storeId || !variantId) {
    console.error(`[checkout] Lemon Squeezy ${body.plan}: configuration absente ou invalide`)
    return notFoundResponse()
  }

  if (env.DB) {
    try {
      await ensureCheckoutQuotaTable(env)
      const outcome = await consumeCapAtomic(
        env,
        `INSERT INTO checkout_quota (email, day, count, updated_at)
         VALUES (?1, ?2, 1, unixepoch())
         ON CONFLICT (email, day) DO UPDATE SET count = count + 1, updated_at = unixepoch()
           WHERE checkout_quota.count < ?3
         RETURNING count`,
        [email, new Date().toISOString().slice(0, 10), CHECKOUTS_PER_DAY],
      )
      if (outcome.status === 'cap_reached') {
        return Response.json({ error: 'Too many checkout attempts' }, { status: 429 })
      }
    } catch (error) {
      // La création d'un checkout reste disponible pendant un incident D1 ;
      // le rate-limit IP du middleware demeure actif.
      console.error('[checkout] Lemon Squeezy quota failed open', error)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS)
  try {
    const response = await fetch(LEMON_SQUEEZY_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            product_options: {
              redirect_url: buildReturnUrl(request.headers.get('origin') || ''),
            },
            checkout_data: {
              email,
              custom: { app_user_email: email },
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: String(storeId) } },
            variant: { data: { type: 'variants', id: String(variantId) } },
          },
        },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[checkout] Lemon Squeezy API: status=${response.status}`)
      return Response.json({ error: 'Checkout failed' }, { status: 502 })
    }
    const payload = (await response.json()) as {
      data?: { attributes?: { url?: unknown } }
    }
    const url = payload.data?.attributes?.url
    if (!isTrustedLemonSqueezyCheckoutUrl(url)) {
      console.error('[checkout] Lemon Squeezy API: URL de checkout absente ou non fiable')
      return Response.json({ error: 'Checkout failed' }, { status: 502 })
    }
    return Response.json({ url })
  } catch (error) {
    console.error('[checkout] Lemon Squeezy fetch failed', error)
    return Response.json({ error: 'Checkout failed' }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
