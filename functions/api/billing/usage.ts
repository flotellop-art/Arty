import type { Env } from '../../env'
import { verifyGoogleUser, resolveUserPlan } from '../_lib/checkAllowedUser'
import { getUsageWindow } from '../_lib/quota'
import { estimateCreditsMicro } from '../_lib/creditPricing'
import { getWalletBalance } from '../_lib/wallet'

const WINDOW_DAYS = 30

// GET /api/billing/usage — usage 30 jours de l'utilisateur, pour le conseiller
// de facturation. La reco est calculée CÔTÉ CLIENT (déterministe, zéro IA) ;
// cet endpoint ne fait que fournir les chiffres bruts de SES propres stats.
//
// Audit RÈGLE 6 :
//  - Authentification : token Google vérifié (verifyGoogleUser).
//  - Autorisation/IDOR : email du token, jamais d'un champ client ; toutes les
//    requêtes filtrent sur cet email → un user ne lit que SON usage.
//  - Abus : read-only (n'incrémente rien), aucun appel tiers/clé serveur IA.
//  - Leak : renvoie uniquement les chiffres de l'appelant (pas la marge owner :
//    on expose le coût fournisseur + le coût crédits markupé, jamais le coût de
//    revient ni des agrégats multi-users).
//  - Origin/CSRF : GET → exempt du middleware.
//  (N-1 : verifyGoogleUser ne valide pas `aud` — lecture de stats perso à faible
//   sensibilité, cohérent avec /api/wallet/balance ; durcissement global différé.)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  const win = await getUsageWindow(env, email, WINDOW_DAYS)
  const byModel = win.byModel.map((m) => ({
    model: m.model,
    count: m.count,
    providerCostMicro: m.providerCostMicro,
    // Coût crédits markupé (le markup vit côté serveur, jamais exposé tel quel).
    creditsMicro: estimateCreditsMicro(m.model, m.providerCostMicro, m.count),
  }))

  // Mode de facturation actuel : abonnement prioritaire, puis crédits (wallet),
  // puis free/trial. pro/vip = licence à vie → hors périmètre du conseiller.
  let currentMode: 'credits' | 'subscription' | 'free' | 'other' = 'free'
  const plan = await resolveUserPlan(env, email)
  if (plan === 'subscription') {
    currentMode = 'subscription'
  } else if ((await getWalletBalance(env, email)) !== null) {
    currentMode = 'credits'
  } else if (plan === 'free' || plan === 'trial') {
    currentMode = 'free'
  } else {
    currentMode = 'other'
  }

  return Response.json({
    byModel,
    byDayCostMicro: win.byDayCostMicro,
    windowDays: WINDOW_DAYS,
    currentMode,
  })
}
