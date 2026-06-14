import type { Env } from '../../env'
import { reconcileWallet } from '../_lib/wallet'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// GET /api/billing/reconcile — réconciliation des wallets (sweep des holds
// orphelins + détection des dérives de solde). OWNER-ONLY : déclenché par un
// Cron EXTERNE (Cloudflare Pages n'a pas de scheduled handler) avec un secret
// partagé dans le header `x-reconcile-secret`.
//
// Audit RÈGLE 6 :
//  - Auth : secret partagé (env.RECONCILE_SECRET). Pas de secret configuré OU
//    secret invalide → 404 uniforme (pas d'oracle d'existence).
//  - Autorisation : job global owner-only — aucun user authentifié n'y accède.
//  - Abus : pas d'appel IA/tiers ; travail borné (LIMIT) ; le sweep est idempotent.
//  - Leak : la réponse ne renvoie que des COMPTEURS (jamais d'emails/PII) ; les
//    dérives détaillées restent en log serveur.
//  - Origin/CSRF : GET → exempt ; la seule mutation (sweep) est sûre/idempotente,
//    et l'accès est gardé par le secret (un prefetch sans secret → 404).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const secret = env.RECONCILE_SECRET
  if (!secret) return Response.json({ error: 'Not found' }, { status: 404 })
  const provided = request.headers.get('x-reconcile-secret') || ''
  if (!timingSafeEqual(provided, secret)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const report = await reconcileWallet(env)

  if (report.balanceDrift.length > 0 || report.settledWithoutDebit > 0) {
    // Alerte : visible dans les logs Cloudflare (compteurs, pas de PII).
    console.error('[reconcile] DÉRIVE détectée', {
      balanceDrift: report.balanceDrift.length,
      settledWithoutDebit: report.settledWithoutDebit,
    })
  }

  return Response.json({
    staleSwept: report.staleSwept,
    balanceDriftCount: report.balanceDrift.length,
    settledWithoutDebit: report.settledWithoutDebit,
  })
}
