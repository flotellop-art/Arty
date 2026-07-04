import type { Env } from '../../env'
import { verifyGoogleUser } from '../_lib/checkAllowedUser'

/**
 * Suppression de compte (RGPD — droit à l'effacement).
 *
 * Supprime UNIQUEMENT les données personnelles du caller :
 *   - `memory`  (mémoire structurée, clé user_id = email)
 *   - `quota`, `quota_model`, `trial_usage`, `free_daily_quota`, `premium_cap`,
 *     `bg_quota`, `checkout_quota` (compteurs d'usage, clé email)
 *   - `shared_conversations` (partages publics — contenu personnel publié)
 *   - `email_otp`, `email_trial_sessions`, `email_trial_usage` (trial email)
 *
 * CONSERVE volontairement `subscriptions` / `licenses` / `premium_packs` :
 * obligation légale de conservation des pièces comptables (10 ans) + droit
 * payé par l'utilisateur. La désactivation d'un abonnement reste gérée par
 * le webhook Lemon Squeezy, pas par cet endpoint.
 *
 * Audit sécu (RÈGLE 6) :
 *  - Authentification : token Google vérifié via verifyGoogleUser (401 sinon).
 *  - Autorisation : l'email vient du token vérifié, JAMAIS du body -> un
 *    caller ne peut effacer que SES données (pas d'IDOR).
 *  - Abus infra : aucune clé tierce, aucun relais ; supprime des lignes scopées.
 *  - Leak : réponses uniformes, aucune info sur l'existence de données.
 *  - Origin/CSRF : POST -> contrôle Origin strict dans _middleware.ts.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Best-effort par table : on tolère une table absente (DELETE throw sinon).
  // On ne touche PAS aux tables de facturation.
  try {
    await env.DB.prepare('DELETE FROM memory WHERE user_id = ?').bind(email).run()
  } catch { /* table memory absente */ }
  try {
    await env.DB.prepare('DELETE FROM quota WHERE email = ?').bind(email).run()
  } catch { /* table quota absente (ancien schéma) */ }
  // Le système réel de quotas/essai vit en D1, keyé par email — données
  // d'usage personnelles (pas des pièces comptables) -> à effacer aussi.
  try {
    await env.DB.prepare('DELETE FROM trial_usage WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM quota_model WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM free_daily_quota WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM premium_cap WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  // Audit F-8 (3 juil. 2026) — l'effacement laissait vivre les conversations
  // PARTAGÉES PUBLIQUEMENT (content_json = données personnelles publiées,
  // jusqu'à 30 j après suppression du compte) et les sessions/compteurs du
  // trial email. Hard delete : c'est le droit à l'effacement, pas un soft.
  try {
    await env.DB.prepare('DELETE FROM shared_conversations WHERE owner_email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM email_otp WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM email_trial_sessions WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM email_trial_usage WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM bg_quota WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }
  try {
    await env.DB.prepare('DELETE FROM checkout_quota WHERE email = ?').bind(email).run()
  } catch { /* table absente */ }

  return Response.json({ ok: true })
}
