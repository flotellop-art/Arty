import type { Env } from '../../env'
import {
  creditWallet,
  registerWalletReversalClaim,
  resolveWalletReversalsForTopup,
} from '../_lib/wallet'
import { isCreemCreditPack, resolveCreemCreditAmount } from '../_lib/creemProducts'

// ─────────────────────────────────────────────────────────────────────
// Webhook Creem — top-ups de crédits prépayés (Track A).
//
// Sécurité (RÈGLE 6) :
//  - Auth = signature HMAC-SHA256 (hex) du body brut, header `creem-signature`.
//    Sans signature valide → 401, rien n'est traité.
//  - L'email ET le montant crédité viennent du payload SIGNÉ + du catalogue
//    financier partagé. Le product_id vient de l'environnement actif, tandis
//    que la valeur du pack reste figée dans le code. On n'utilise JAMAIS le
//    montant du payload (qui est en EUR) pour définir les crédits accordés.
//  - Crédit UNIQUEMENT sur paiement CAPTURÉ (`object.order.status === 'paid'`).
//  - Idempotence par event_id (assurée dans creditWallet) → un replay d'event
//    signé ne re-crédite pas.
//  - Vit sous /api/webhook/ → exempt du gate Origin du middleware (la signature
//    remplace l'Origin, comme le webhook Lemon Squeezy).
// ─────────────────────────────────────────────────────────────────────

interface CreemOrder {
  id?: string
  product?: string
  amount?: number
  amount_paid?: number
  currency?: string
  status?: string
}
interface CreemTransaction {
  amount?: number
  amount_paid?: number
  refunded_amount?: number
  order?: string | { id?: string }
}
interface CreemObject {
  id?: string
  order?: CreemOrder
  transaction?: CreemTransaction
  refund_amount?: number
  product?: { id?: string; name?: string }
  customer?: { id?: string; email?: string }
  // `metadata` est ré-émis tel quel par Creem depuis la création du checkout.
  // `app_user_email` y est posé CÔTÉ SERVEUR par /api/checkout/creem à partir
  // du token Google vérifié → non-éditable par l'acheteur (contrairement à
  // customer.email, modifiable sur la page de paiement Creem).
  metadata?: { app_user_email?: string; pack?: string }
  request_id?: string
}
interface CreemWebhookPayload {
  id?: string
  eventType?: string
  created_at?: number
  object?: CreemObject
}

/**
 * Vérifie la signature HMAC-SHA256 (hex) du body brut contre le secret du
 * webhook, en comparaison constant-time. Même schéma que le webhook Lemon
 * Squeezy (calcul sur les octets EXACTS reçus — ne jamais re-sérialiser le JSON).
 */
export async function verifySignature(rawBody: ArrayBuffer, signatureHex: string, secret: string): Promise<boolean> {
  if (!signatureHex || !secret) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
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

/** N'affiche que le domaine de l'email dans les logs (privacy). */
function maskEmail(email: string | undefined): string {
  if (!email) return '<no-email>'
  const at = email.indexOf('@')
  if (at < 0) return '***'
  return `***@${email.slice(at + 1)}`
}

/** checkout.completed → crédite le pack acheté (montant FIXE selon le produit). */
async function handleCheckoutCompleted(env: Env, payload: CreemWebhookPayload): Promise<void> {
  const eventId = payload.id
  const obj = payload.object ?? {}
  const order = obj.order ?? {}
  // Email à créditer : l'AUTORITÉ est `metadata.app_user_email`, posé côté
  // serveur par /api/checkout/creem depuis un token Google vérifié → non
  // modifiable par l'acheteur. `customer.email` (éditable sur la page de
  // paiement Creem, jamais vérifié côté serveur) n'est qu'un FALLBACK pour les
  // checkouts créés hors de notre endpoint (ex. lien statique). On logue une
  // anomalie quand on l'utilise : en flux normal, metadata est toujours présent.
  const trustedEmail = obj.metadata?.app_user_email?.toLowerCase()
  const fallbackEmail = obj.customer?.email?.toLowerCase()
  const email = trustedEmail ?? fallbackEmail
  if (!trustedEmail && fallbackEmail) {
    console.warn(
      `[creem] checkout sans metadata.app_user_email — crédit via customer.email non vérifié, order=${order.id ?? '<none>'}`
    )
  }
  const productId = obj.product?.id ?? order.product
  const orderId = order.id

  if (!eventId || !email || !productId || !orderId) {
    console.warn('[creem] checkout.completed : champ requis manquant', {
      eventId: !!eventId,
      email: !!email,
      productId: !!productId,
      orderId: !!orderId,
    })
    return
  }
  // Crédite UNIQUEMENT sur paiement réellement capturé.
  if (order.status !== 'paid') {
    console.log(`[creem] checkout.completed status=${order.status} (non payé) — ignoré`)
    return
  }
  const amountMicro = resolveCreemCreditAmount(env, productId)
  if (!amountMicro || amountMicro <= 0) {
    // Ce checkout a ete cree par notre endpoint comme achat de credits. Une
    // rotation/mauvaise configuration du product_id ne doit jamais transformer
    // un paiement capture en 200 silencieux : le 5xx force le retry Creem.
    if (isCreemCreditPack(obj.metadata?.pack)) {
      throw new Error('Creem credit product is not configured for this paid checkout')
    }
    // Produit hors table crédits (ex : licence Pro vendue par un autre flux).
    console.warn(`[creem] produit ${productId} hors table crédits — non crédité`)
    return
  }
  const res = await creditWallet(env, {
    provider: 'creem',
    eventId,
    orderId,
    email,
    amountMicro,
    kind: 'topup',
  })
  if (res.status === 'error') throw new Error('Creem top-up persistence failed')
  // Un refund/dispute peut avoir été livré avant checkout.completed. Le claim
  // durable est résolu même sur un replay où le top-up est déjà `duplicate`.
  const reversals = await resolveWalletReversalsForTopup(env, {
    provider: 'creem',
    orderId,
    email,
    topupMicro: amountMicro,
  })
  if (reversals.status === 'error') throw new Error('Creem pending reversal persistence failed')
  console.log(`[creem] topup ${maskEmail(email)} order=${orderId} → ${res.status}`)
}

/**
 * refund.created / dispute.created → débite les crédits accordés pour la
 * commande remboursée/contestée (anti-fraude : payer, recevoir, chargeback,
 * garder les crédits). On retrouve le top-up d'origine par order_id. Pour un
 * remboursement, on retire la même proportion du pack que
 * `refund_amount / transaction.amount_paid`; un chargeback retire le reliquat.
 * Idempotent sur l'event_id du refund/dispute, et plafonné au top-up initial.
 */
async function handleRefundOrDispute(
  env: Env,
  payload: CreemWebhookPayload,
  kind: 'refund' | 'chargeback',
): Promise<void> {
  const eventId = payload.id
  const obj = payload.object ?? {}
  const transactionOrder = obj.transaction?.order
  const orderId = obj.order?.id
    ?? (typeof transactionOrder === 'string' ? transactionOrder : transactionOrder?.id)
  if (!eventId || !orderId || !env.DB) {
    console.warn(`[creem] ${kind} : event_id/order_id manquant — ignoré`)
    return
  }

  let ratioNumerator = 1
  let ratioDenominator = 1
  if (kind === 'refund') {
    const refundAmount = obj.refund_amount
    const paidAmount = obj.transaction?.amount_paid ?? obj.order?.amount_paid
    if (
      !Number.isSafeInteger(refundAmount)
      || (refundAmount as number) <= 0
      || !Number.isSafeInteger(paidAmount)
      || (paidAmount as number) <= 0
    ) {
      // Sans deux montants comparables, ne jamais inventer un débit.
      console.warn(`[creem] refund ${eventId} : refund_amount/amount_paid invalide — ignoré`)
      return
    }
    ratioNumerator = refundAmount as number
    ratioDenominator = paidAmount as number
  }

  // Claim AVANT la recherche du top-up : s'il n'est pas encore livré, la
  // reversal reste durablement awaiting_topup au lieu d'être acquittée en 200
  // puis oubliée.
  const registered = await registerWalletReversalClaim(env, {
    provider: 'creem',
    eventId,
    orderId,
    kind,
    ratioNumerator,
    ratioDenominator,
  })
  if (registered.status === 'error') throw new Error('Creem reversal registration failed')

  const orig = await env.DB.prepare(
    `SELECT user_email, amount_micro FROM credit_ledger
     WHERE ref_type = 'mor_order' AND ref_id = ?1 AND kind = 'topup'
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(orderId)
    .first<{ user_email: string; amount_micro: number }>()
  if (!orig) {
    console.log(`[creem] ${kind} pour commande ${orderId} en attente du top-up`)
    return
  }

  const res = await resolveWalletReversalsForTopup(env, {
    provider: 'creem',
    orderId,
    email: orig.user_email,
    topupMicro: orig.amount_micro,
  })
  if (res.status === 'error') throw new Error('Creem reversal persistence failed')
  console.log(`[creem] ${kind} ${maskEmail(orig.user_email)} order=${orderId} → ${res.status}`)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.CREEM_WEBHOOK_SECRET) {
    return Response.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  if (!env.DB) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  // Body brut lu UNE seule fois — la signature se calcule sur ces octets exacts.
  const rawBody = await request.arrayBuffer()
  const signature = request.headers.get('creem-signature') || ''

  const valid = await verifySignature(rawBody, signature, env.CREEM_WEBHOOK_SECRET)
  if (!valid) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: CreemWebhookPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody)) as CreemWebhookPayload
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = payload.eventType
  if (!eventType || typeof eventType !== 'string') {
    return Response.json({ error: 'Missing eventType' }, { status: 400 })
  }

  console.log(`[creem] event=${eventType} id=${payload.id ?? '<none>'}`)

  try {
    switch (eventType) {
      case 'checkout.completed':
        await handleCheckoutCompleted(env, payload)
        break
      case 'refund.created':
        await handleRefundOrDispute(env, payload, 'refund')
        break
      case 'dispute.created':
        await handleRefundOrDispute(env, payload, 'chargeback')
        break
      default:
        // Event non géré — 200 pour éviter les retries Creem.
        break
    }
  } catch (err) {
    console.error('[creem] handler failed', err)
    return Response.json({ error: 'Handler error' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
