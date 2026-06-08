import type { Env } from '../../env'
import { consumeCapAtomic } from './atomicQuota'

/**
 * Vérifie le token Google passé dans `x-google-token` (ou dans
 * `Authorization: Bearer …` en fallback pour les endpoints Google API
 * qui forwardent directement le token user) auprès de l'API userinfo
 * de Google. Retourne l'email vérifié (en minuscules) si le token est
 * valide, null sinon.
 *
 * Usage : gate d'authentification pour les endpoints qui acceptent tout
 * utilisateur Google (BYOK inclus). Empêche le relais anonyme via un
 * header forgé — Google est la source de vérité.
 */
export async function verifyGoogleUser(
  request: Request
): Promise<string | null> {
  const googleToken =
    request.headers.get('x-google-token') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
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
 * Vérifie un access token Google via l'endpoint `tokeninfo` et valide en plus
 * que le token a été émis POUR notre application (`aud`/`azp == expectedAud`)
 * ET que l'email est vérifié. Plus strict que `verifyGoogleUser` (qui passe
 * par `userinfo` sans contrôle d'audience — finding N-1) : à utiliser pour les
 * endpoints sensibles (paiement, écriture d'abonnement/licence) où un token
 * d'une autre app ne doit JAMAIS passer le gate.
 *
 * Retourne l'email vérifié (minuscules) ou null. Source unique réutilisée par
 * `subscription/status.ts` et `checkout/creem.ts`.
 */
export async function verifyTokenViaTokeninfo(
  token: string,
  expectedAud: string | undefined
): Promise<string | null> {
  if (!token) return null
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    )
    if (!res.ok) return null
    const info = (await res.json()) as {
      email?: string
      email_verified?: string | boolean
      aud?: string
      azp?: string
    }
    const email = info.email?.toLowerCase()
    if (!email) return null
    const verified = info.email_verified === 'true' || info.email_verified === true
    if (!verified) return null
    if (expectedAud && info.aud && info.aud !== expectedAud && info.azp !== expectedAud) {
      return null
    }
    return email
  } catch {
    return null
  }
}

/**
 * Réponse 404 uniforme pour les requêtes non autorisées. Ne révèle pas
 * l'existence de l'endpoint à un attaquant (pas de 401/403 distinct).
 * Utilisé par les endpoints qui exigent un user Google identifié.
 */
export function notFoundResponse(): Response {
  return Response.json({ error: 'Not found' }, { status: 404 })
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

/**
 * Crée la table D1 du compteur trial si absente. Exporté car réutilisé par
 * /api/trial/init (lecture du restant). Idempotent.
 *
 * Modèle "used" (incrémente) plutôt que "remaining" (décrémente) : permet
 * l'upsert conditionnel atomique `WHERE used < cap`. Un nouvel user trial sans
 * ligne = used 0 = 30 messages restants (pas besoin de pré-init).
 */
export async function ensureTrialTable(env: Env): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS trial_usage (
        email TEXT PRIMARY KEY,
        used INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`
    ).run()
  } catch (err) {
    console.error('[trial] ensure table failed', err)
  }
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
 * consommés vit dans la table D1 `trial_usage` (cap 30) — incrémenté ici à
 * chaque appel autorisé via un upsert conditionnel atomique.
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
  // ont droit au quota free quotidien (10 Haiku/jour). Le proxy appellera
  // consumeFreeDailyQuota() pour décrémenter le compteur.
  return { email, planType: 'free' }
}

/**
 * Consomme 1 message d'essai via le compteur D1 atomique `trial_usage`
 * (incrément conditionnel `WHERE used < 30`). Si épuisé, retourne
 * `TrialExpired` (le caller émet un 403 `trial_expired`). Sinon retourne un
 * `AllowedUser` avec `trialRemaining` (= 30 - used post-incrément).
 *
 * Migré depuis KV (mai 2026) : le pattern KV get→décrémente→put n'était pas
 * atomique. D1 ferme la course. Fail-open sur incident D1 (modèles trial =
 * cheap, impact négligeable) plutôt que de bloquer un user.
 */
async function consumeTrialMessage(env: Env, email: string): Promise<CheckResult> {
  if (!env.DB) {
    // Sans D1, fail-open : on autorise (les modèles trial sont cheap), on ne
    // peut juste pas décrémenter. Ne devrait pas arriver en prod.
    return {
      email,
      planType: 'trial',
      trialRemaining: TRIAL_INITIAL_MESSAGES,
      allowedModels: [...TRIAL_ALLOWED_MODELS],
    }
  }

  await ensureTrialTable(env)

  const outcome = await consumeCapAtomic(
    env,
    `INSERT INTO trial_usage (email, used, updated_at)
     VALUES (?1, 1, unixepoch())
     ON CONFLICT (email) DO UPDATE SET used = used + 1, updated_at = unixepoch()
       WHERE trial_usage.used < ?2
     RETURNING used AS count`,
    [email, TRIAL_INITIAL_MESSAGES]
  )

  if (outcome.status === 'cap_reached') {
    return { error: 'trial_expired', email }
  }
  if (outcome.status === 'fail_open') {
    // D1 lent/down → on laisse passer sans connaître le restant exact.
    return {
      email,
      planType: 'trial',
      trialRemaining: 1,
      allowedModels: [...TRIAL_ALLOWED_MODELS],
    }
  }
  // consumed : outcome.count = `used` post-incrément.
  return {
    email,
    planType: 'trial',
    trialRemaining: Math.max(0, TRIAL_INITIAL_MESSAGES - outcome.count),
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

    // H-Plan-1 (audit étape 5) — vérifier l'expiration. Une license expirée
    // ne doit plus donner accès Pro même si status='active' (cas où Lemon
    // Squeezy n'a pas encore push le webhook expired).
    const license = await env.DB.prepare(
      `SELECT 1 AS ok FROM licenses
       WHERE user_email = ?1
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > unixepoch())
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
