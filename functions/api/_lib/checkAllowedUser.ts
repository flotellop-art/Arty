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

export type PlanType = 'subscription' | 'pro' | 'vip' | 'free' | 'trial'

export interface AllowedUser {
  email: string
  planType: PlanType
  /** Pour le plan trial uniquement : nombre de messages restants APRÈS décrément. */
  trialRemaining?: number
  /** Pour le plan trial uniquement : liste des familles de modèles autorisées. */
  allowedModels?: string[]
}

export interface TrialExpired {
  error: 'trial_expired'
  email: string
}

export type CheckResult = AllowedUser | TrialExpired | null

export function isTrialExpired(r: CheckResult): r is TrialExpired {
  return r !== null && typeof r === 'object' && 'error' in r && r.error === 'trial_expired'
}

/**
 * Modèles autorisés en essai gratuit (plan 'trial'). Liste affichée à
 * l'utilisateur ; l'enforcement réel utilise `isModelAllowedInTrial()`
 * pour tolérer les variantes de versionning des fournisseurs (ex :
 * `claude-haiku-4-5-20251001` matche `claude-haiku`, `mistral-medium-latest`
 * matche `mistral-medium`). Mistral Small déprécié mai 2026.
 */
export const TRIAL_ALLOWED_MODELS = [
  'claude-haiku-4-5',
  'gpt-5-mini',
  'gemini-flash',
  'mistral-medium',
] as const

const TRIAL_INITIAL_MESSAGES = 30

/** Clé KV du compteur de messages restants pour un user en trial. */
export function trialCounterKey(email: string): string {
  return `trial:${email}`
}

/**
 * Vérifie si un nom de modèle est autorisé pour un user en plan trial.
 * Matche par famille (claude→haiku, gpt→mini, gemini→flash, mistral→small)
 * pour tolérer les suffixes de versions API. Les proxys IA étant scopés par
 * fournisseur, le préfixe `claude-` / `gpt-` / `gemini-` / `mistral-` est
 * implicite ; on regarde juste la sous-famille.
 */
export function isModelAllowedInTrial(model: string): boolean {
  const m = model.toLowerCase()
  if (m.startsWith('claude')) return m.includes('haiku')
  if (m.startsWith('gpt')) return m.includes('mini')
  if (m.startsWith('gemini')) return m.includes('flash')
  if (m.startsWith('mistral')) return m.includes('small')
  return false
}

/**
 * Logique d'accès :
 *   - free          : accès refusé (l'utilisateur doit s'abonner via /pricing)
 *   - trial         : accès autorisé, 30 messages, modèles basiques uniquement
 *   - subscription  : accès autorisé, soumis aux quotas mensuels (500 msgs/mois)
 *   - pro           : accès autorisé, sans quota
 *   - vip           : accès autorisé, sans quota
 *
 * Source de vérité : la table D1 `subscriptions` (renseignée par le webhook
 * Lemon Squeezy `functions/api/webhook/lemonsqueezy.ts`) et la table `licenses`
 * (achats one-shot du plan Pro). Pour le plan trial, le compteur de messages
 * restants vit dans KV (`trial:{email}`) — incrémenté côté `/api/trial/init`
 * et décrémenté ici à chaque appel autorisé.
 *
 * Vérifie le token Google, puis cherche un abonnement/licence actif. Retourne
 * `AllowedUser` si autorisé, `TrialExpired` si trial épuisé (le caller émet
 * un 403 dédié), `null` sinon. Les callers existants traitaient le retour
 * comme truthy/falsy — `isTrialExpired()` permet de gérer le cas trial
 * sans casser le pattern.
 */
/**
 * Variante read-only de `checkAllowedUser` : retourne `AllowedUser` sans
 * décrémenter le compteur trial KV. Pour les endpoints auxiliaires qui
 * vérifient juste l'identité sans facturer un message d'essai (stats de
 * quota, geocoding, etc.).
 */
export async function checkAllowedUserPeek(
  request: Request,
  env: Env
): Promise<AllowedUser | null> {
  const email = await verifyGoogleUser(request)
  if (!email) return null

  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowed.includes(email)) {
    return { email, planType: 'vip' }
  }

  const plan = await resolveUserPlan(env, email)
  // Plan 'free' = OK pour les endpoints peek (status, geocoding, etc.) ;
  // les proxies IA appliqueront leurs quotas free spécifiques.
  return { email, planType: plan }
}

export async function checkAllowedUser(
  request: Request,
  env: Env
): Promise<CheckResult> {
  const email = await verifyGoogleUser(request)
  if (!email) return null

  // ALLOWED_EMAILS = beta testeurs VIP, bypass du check D1
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowed.includes(email)) {
    console.log(`[VIP bypass] ${email.slice(0, 3)}...`)
    return { email, planType: 'vip' }
  }

  const plan = await resolveUserPlan(env, email)
  if (plan === 'subscription' || plan === 'pro' || plan === 'vip') {
    return { email, planType: plan }
  }
  if (plan === 'trial') {
    return await consumeTrialMessage(env, email)
  }

  // Plan 'free' : tous les users Google authentifiés sans abonnement payant
  // ont droit aux quotas free quotidiens (10 Haiku + 5 Mistral). Le proxy
  // appellera consumeFreeDailyQuota() pour décrémenter le bon compteur.
  return { email, planType: 'free' }
}

/**
 * Décrémente le compteur trial KV de 1. Si épuisé (<= 0), retourne
 * `TrialExpired` — le caller émet alors un 403 `trial_expired`. Sinon
 * retourne un `AllowedUser` enrichi avec `trialRemaining` (post-décrément)
 * et la liste `allowedModels`.
 *
 * Race conditions : KV est eventually consistent. Deux appels simultanés
 * peuvent lire la même valeur, décrémenter, et écrire la même nouvelle
 * valeur (perte d'un cran). Acceptable pour un compteur de trial — la
 * dérive est <= 1 message par session active.
 */
async function consumeTrialMessage(env: Env, email: string): Promise<CheckResult> {
  if (!env.KV) {
    // Sans KV on ne peut pas appliquer le quota trial → considère comme
    // expiré pour ne pas distribuer de messages illimités.
    return { error: 'trial_expired', email }
  }

  const key = trialCounterKey(email)
  const raw = await env.KV.get(key)
  const current = raw === null ? 0 : Math.max(0, parseInt(raw, 10) || 0)

  if (current <= 0) {
    return { error: 'trial_expired', email }
  }

  const next = current - 1
  await env.KV.put(key, String(next))

  return {
    email,
    planType: 'trial',
    trialRemaining: next,
    allowedModels: [...TRIAL_ALLOWED_MODELS],
  }
}

/**
 * Détermine le plan de l'utilisateur (sans vérifier le token — l'email doit
 * déjà être validé). Priorité : license active (pro) > sub active/cancelled
 * (subscription/pro/vip) > trial active > free. La période 'cancelled' est
 * traitée comme un accès courant : Lemon Squeezy passe en 'expired' à la
 * fin de la période, donc 'cancelled' = "annulé mais accès jusqu'à la fin
 * du mois payé".
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
         AND plan_type IN ('subscription', 'pro', 'vip', 'trial')
       LIMIT 1`
    )
      .bind(email)
      .first<{ plan_type: string }>()

    if (sub?.plan_type === 'pro') return 'pro'
    if (sub?.plan_type === 'vip') return 'vip'
    if (sub?.plan_type === 'subscription') return 'subscription'
    if (sub?.plan_type === 'trial') return 'trial'

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

/** Réponse 403 standardisée pour un user trial dont le compteur est à 0. */
export function trialExpiredResponse(): Response {
  return Response.json(
    {
      error: 'trial_expired',
      message: 'Ton essai gratuit est terminé. Choisis un plan pour continuer.',
    },
    { status: 403 }
  )
}

/** Réponse 403 standardisée pour un modèle premium demandé en plan trial. */
export function trialModelRestrictedResponse(): Response {
  return Response.json(
    {
      error: 'trial_model_restricted',
      message: 'Les modèles premium ne sont pas disponibles en essai gratuit.',
    },
    { status: 403 }
  )
}

/** Initial message budget for a brand-new trial user. Exposed for tests / init endpoint. */
export const TRIAL_INITIAL_BUDGET = TRIAL_INITIAL_MESSAGES
