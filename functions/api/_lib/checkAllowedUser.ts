import type { Env } from '../../env'

/**
 * Vérifie le token Google passé dans le header `x-google-token` auprès
 * de l'API userinfo de Google. Retourne l'email vérifié (en minuscules)
 * si le token est valide, null sinon.
 *
 * Usage : gate d'authentification pour les endpoints qui acceptent tout
 * utilisateur Google (BYOK inclus). Empêche le relais anonyme via un
 * header forgé — Google est la source de vérité.
 */
export async function verifyGoogleUser(
  request: Request
): Promise<string | null> {
  const googleToken = request.headers.get('x-google-token')
  if (!googleToken) return null

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })
    if (!res.ok) return null
    const userInfo = (await res.json()) as { email?: string }
    return userInfo.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/**
 * Parse la valeur brute de `ALLOWED_EMAILS` en liste d'emails normalisés.
 * Tolère plusieurs formats courants qu'on rencontre quand la variable est
 * saisie à la main dans l'UI Cloudflare : virgules, points-virgules, sauts
 * de ligne, espaces, et guillemets d'enveloppe ("foo@bar.com").
 *
 * TODO Supprimer en juillet 2026 après validation en prod du flux Lemon Squeezy.
 */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,;\s\n]+/)
    .map((e) => e.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase())
    .filter(Boolean)
}

export type PlanType = 'subscription' | 'pro' | 'vip' | 'free'

export interface AllowedUser {
  email: string
  planType: PlanType
}

/**
 * Logique d'accès :
 *   - free          : accès refusé (l'utilisateur doit s'abonner via /pricing)
 *   - subscription  : accès autorisé, soumis aux quotas mensuels (500 msgs/mois)
 *   - pro           : accès autorisé, sans quota
 *   - vip           : accès autorisé, sans quota
 *
 * Source de vérité : la table D1 `subscriptions` (renseignée par le webhook
 * Lemon Squeezy `functions/api/webhook/lemonsqueezy.ts`) et la table `licenses`
 * (achats one-shot du plan Pro). En cas d'échec D1 (table absente, etc.) on
 * retombe sur l'ancienne whitelist `ALLOWED_EMAILS` pour ne pas casser le dev.
 *
 * Vérifie le token Google, puis cherche un abonnement/licence actif. Retourne
 * l'email + plan_type si autorisé, null sinon. Les callers existants qui
 * traitaient le retour comme truthy/falsy continuent de fonctionner — un objet
 * non-null est truthy comme l'ancienne string.
 */
export async function checkAllowedUser(
  request: Request,
  env: Env
): Promise<AllowedUser | null> {
  const email = await verifyGoogleUser(request)
  if (!email) return null

  const plan = await resolveUserPlan(env, email)
  if (plan !== 'free') return { email, planType: plan }

  // Fallback whitelist — TODO Supprimer en juillet 2026 après validation
  // en prod du flux Lemon Squeezy. Garde le dev fonctionnel pendant la
  // transition + sert de filet si la table subscriptions est down.
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowed.includes(email)) return { email, planType: 'vip' }

  return null
}

/**
 * Détermine le plan de l'utilisateur (sans vérifier le token — l'email doit
 * déjà être validé). Priorité : license active (pro) > sub active/cancelled
 * (subscription/pro/vip) > free. La période 'cancelled' est traitée comme
 * un accès courant : Lemon Squeezy passe en 'expired' à la fin de la période,
 * donc 'cancelled' = "annulé mais accès jusqu'à la fin du mois payé".
 *
 * Failsafe : si la table n'existe pas (DB neuve, migration pas appliquée),
 * retourne 'free' — le caller appliquera son propre fallback (ALLOWED_EMAILS).
 */
export async function resolveUserPlan(env: Env, email: string): Promise<PlanType> {
  if (!env.DB) return 'free'

  try {
    const sub = await env.DB.prepare(
      `SELECT plan_type FROM subscriptions
       WHERE user_email = ?1
         AND status IN ('active', 'cancelled')
         AND plan_type IN ('subscription', 'pro', 'vip')
       LIMIT 1`
    )
      .bind(email)
      .first<{ plan_type: string }>()

    if (sub?.plan_type === 'pro') return 'pro'
    if (sub?.plan_type === 'vip') return 'vip'
    if (sub?.plan_type === 'subscription') return 'subscription'

    const license = await env.DB.prepare(
      `SELECT 1 AS ok FROM licenses
       WHERE user_email = ?1 AND status = 'active'
       LIMIT 1`
    )
      .bind(email)
      .first<{ ok: number }>()

    if (license) return 'pro'

    return 'free'
  } catch (err) {
    // Table missing / D1 down → log et fallback. Le caller décidera (whitelist).
    console.error('checkAllowedUser.resolveUserPlan failed', err)
    return 'free'
  }
}

/**
 * Réponse 403 standardisée pour les utilisateurs sans abonnement actif.
 * Utilisée par les endpoints qui veulent un message d'erreur uniforme
 * pointant vers la page pricing.
 */
export function noActiveSubscriptionResponse(): Response {
  return Response.json(
    {
      error: 'no_active_subscription',
      message: 'Aucun abonnement actif trouvé.',
    },
    { status: 403 }
  )
}
