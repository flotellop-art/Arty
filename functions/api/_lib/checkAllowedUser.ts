import type { Env } from '../../env'
import { consumeCapAtomic } from './atomicQuota'

/**
 * Vérifie via `tokeninfo` que le token a été émis POUR Arty (`aud`/`azp`).
 * Retourne :
 *  - `true`  : audience confirmée (`aud` OU `azp` === expectedAud)
 *  - `false` : audience ÉTRANGÈRE explicite (aud/azp présents et ≠ expectedAud)
 *  - `null`  : indéterminé (tokeninfo KO, ou `aud`/`azp` absents) → l'appelant
 *              NE doit PAS verrouiller. Fail-safe : évite de bloquer un token
 *              natif légitime (serverAuthCode, BUG 21/51) ou un incident
 *              tokeninfo transitoire.
 */
async function tokenAudienceMatches(
  token: string,
  expectedAud: string
): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    )
    if (!res.ok) return null
    const info = (await res.json()) as { aud?: string; azp?: string }
    if (!info.aud && !info.azp) return null
    return info.aud === expectedAud || info.azp === expectedAud
  } catch {
    return null
  }
}

function getGoogleToken(request: Request): string {
  return (
    request.headers.get('x-google-token') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  )
}

export interface StrictGoogleIdentity {
  email: string
  /** Stable Google account identifier (userinfo `id`). */
  sub: string | null
}

/**
 * Strict authentication gate for Arty-owned data and privileged relays.
 *
 * Unlike `verifyGoogleUser`, this helper is deliberately fail-closed:
 * - GOOGLE_CLIENT_ID is mandatory;
 * - tokeninfo must answer successfully;
 * - `aud` or `azp` must match Arty's client id;
 * - userinfo must confirm the account identity.
 *
 * Google API pass-through endpoints keep using the legacy helper because they
 * forward the user's token to Google. Arty data/control endpoints must use this
 * helper so a token minted for another OAuth client cannot be replayed here.
 */
export async function verifyGoogleIdentityStrict(
  request: Request,
  expectedAud: string | null | undefined
): Promise<StrictGoogleIdentity | null> {
  const googleToken = getGoogleToken(request)
  const audience = expectedAud?.trim()
  if (!googleToken || !audience) return null

  try {
    const tokenRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleToken)}`
    )
    if (!tokenRes.ok) return null
    const tokenInfo = (await tokenRes.json()) as { aud?: string; azp?: string }
    if (tokenInfo.aud !== audience && tokenInfo.azp !== audience) return null

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })
    if (!userRes.ok) return null
    const userInfo = (await userRes.json()) as {
      email?: string
      id?: string
      verified_email?: boolean
    }
    const email = userInfo.email?.trim().toLowerCase()
    if (!email || userInfo.verified_email !== true) return null
    return { email, sub: userInfo.id || null }
  } catch {
    return null
  }
}

export async function verifyGoogleUserStrict(
  request: Request,
  expectedAud: string | null | undefined
): Promise<string | null> {
  return (await verifyGoogleIdentityStrict(request, expectedAud))?.email ?? null
}

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
 *
 * N-1 (audit OAuth) : quand `expectedAud` est fourni (= GOOGLE_CLIENT_ID,
 * passé par les proxys IA qui dépensent la clé serveur owner), on rejette en
 * plus tout token émis pour une AUTRE app (audience étrangère). Fail-safe :
 * un `aud` indéterminé/absent ou un tokeninfo KO NE verrouille PAS (on garde
 * l'email userinfo) — seul un `aud` étranger EXPLICITE est rejeté. ⚠️ tester
 * web ET natif avant déploiement (les tokens serverAuthCode natifs, BUG 21/51).
 */
export async function verifyGoogleUser(
  request: Request,
  expectedAud?: string | null
): Promise<string | null> {
  const googleToken = getGoogleToken(request)
  if (!googleToken) return null

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })
    if (!res.ok) return null
    const userInfo = (await res.json()) as { email?: string }
    const email = userInfo.email?.toLowerCase() ?? null
    if (!email) return null
    if (expectedAud && (await tokenAudienceMatches(googleToken, expectedAud)) === false) {
      return null
    }
    return email
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
    // M-3 (audit) : rejeter aussi un token SANS `aud`/`azp` quand un expectedAud
    // est exigé (le `&& info.aud` court-circuitait la garde → token sans aud
    // accepté). Ces endpoints (paiement) reçoivent des tokens web où aud est
    // toujours présent → durcissement sûr.
    if (expectedAud && info.aud !== expectedAud && info.azp !== expectedAud) {
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
 * TODO (repoussé) : retirer le fallback legacy ALLOWED_EMAILS (pas parseAllowedEmails, réutilisée ailleurs) une fois le flux d'abonnement Lemon Squeezy validé en prod ; à réévaluer après le lancement commercial (aucun abonné à ce jour).
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
  /** Interne proxy : vrai uniquement si CET appel a atomiquement incrémenté D1. */
  trialDebited?: true
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
 * Matche par famille (claude→haiku, gpt→mini, gemini→flash, mistral→medium)
 * pour tolérer les suffixes de versions API. Les proxys IA étant scopés par
 * fournisseur, le préfixe `claude-` / `gpt-` / `gemini-` / `mistral-` est
 * implicite ; on regarde juste la sous-famille.
 *
 * F-16 (audit visibilité modèle, corrigé C-E) : cette fonction exigeait
 * encore `small` pour Mistral alors que TRIAL_ALLOWED_MODELS déclare
 * `mistral-medium` depuis la dépréciation de Small (mai 2026) ET que le swap
 * trial de mistral-proxy cible mistral-medium-latest — la cible de la
 * substitution échouait elle-même le test. Aligné sur `medium` : aucun
 * changement de coût (medium était déjà servi via le swap), le swap devient
 * simplement inutile pour le défaut Mistral.
 */
export function isModelAllowedInTrial(model: string): boolean {
  const m = model.toLowerCase()
  if (m.startsWith('claude')) return m.includes('haiku')
  if (m.startsWith('gpt')) return m.includes('mini')
  if (m.startsWith('gemini')) return m.includes('flash')
  if (m.startsWith('mistral')) return m.includes('medium')
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
  // Les chemins « peek » peuvent dépenser des clés owner. L'audience Arty est
  // donc obligatoire et toute panne/absence de `aud` échoue fermée.
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
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
  // Ce gate dépense les clés owner : audience Arty obligatoire, fail-closed.
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
  if (!email) return null

  // ALLOWED_EMAILS = beta testeurs VIP, bypass du check D1
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowed.includes(email)) {
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
    trialDebited: true,
  }
}

/**
 * Rembourse un message trial réservé par `checkAllowedUser` lorsqu'aucune
 * requête IA n'est finalement servie (timeout/refus vision pré-upstream).
 * Best-effort et borné à zéro ; sans D1, le chemin d'origine était fail-open.
 */
export async function voidTrialMessage(env: Env, email: string): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `UPDATE trial_usage
       SET used = MAX(0, used - 1), updated_at = unixepoch()
       WHERE email = ?1`,
    ).bind(email).run()
  } catch (err) {
    console.error('[trial] void failed', err)
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
    // Expiration des abonnements (audit 14 juin) — symétrie avec le garde des
    // licences plus bas. `active` = unconditionnel (un renouvellement en cours
    // dont le webhook traîne ne doit PAS éjecter un payeur). `cancelled` = accès
    // conservé JUSQU'À la fin de période (current_period_end, stocké en ISO-8601
    // par le webhook Lemon Squeezy `renews_at`) ; au-delà → plus d'accès, même
    // si le webhook `expired` n'est jamais arrivé (sinon fuite de revenu :
    // premium indéfini sur un abo annulé). `unixepoch(ISO)` parse bien le format
    // (vérifié sur D1). period_end NULL sur un cancelled = anomalie → fail-open
    // (on garde l'accès plutôt que d'éjecter à tort).
    const sub = await env.DB.prepare(
      `SELECT plan_type FROM subscriptions
       WHERE user_email = ?1
         AND plan_type IN ('subscription', 'pro', 'vip', 'trial')
         AND (
           status IN ('active', 'on_trial', 'paused', 'past_due', 'unpaid')
           OR (status = 'cancelled'
               AND (current_period_end IS NULL
                    OR unixepoch(current_period_end) > unixepoch()))
         )
       LIMIT 1`
    )
      .bind(email)
      .first<{ plan_type: string }>()

    if (sub?.plan_type === 'pro') return 'pro'
    if (sub?.plan_type === 'vip') return 'vip'
    if (sub?.plan_type === 'subscription') return 'subscription'
    if (sub?.plan_type === 'trial') return 'trial'

    // Licences Pro = à vie (pas de colonne `expires_at` dans le schéma prod —
    // l'ancienne condition `expires_at ...` faisait planter la requête → tout
    // détenteur de licence était vu comme `free`). Réconciliation 15 juin :
    // le gate est simplement `status = 'active'`.
    const license = await env.DB.prepare(
      `SELECT 1 AS ok FROM licenses
       WHERE user_email = ?1
         AND status = 'active'
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

/**
 * Pro (licence à vie 39 €) = BYOK. La licence donne l'accès à l'APP à vie, PAS
 * l'accès à la clé serveur d'Arty (recadrage P2.5 du plan concurrentiel). Un
 * compte Pro DOIT fournir sa propre clé API. Les plans subscription/vip/trial/
 * free gardent l'accès clé serveur (soumis à leurs quotas respectifs).
 * Source de vérité partagée par les 4 proxys IA — sans ce gate, un achat unique
 * à 39 € donnerait un accès serveur illimité à vie (trou de marge, vigie 14 juin).
 */
export function planUsesServerKey(plan: PlanType): boolean {
  return plan !== 'pro'
}

/** 403 : licence Pro active mais aucune clé BYOK fournie (Pro = BYOK, P2.5). */
export function proKeyRequiredResponse(): Response {
  return Response.json(
    {
      error: 'pro_byok_required',
      message: 'Licence Pro active : ajoute ta propre clé API (BYOK) pour utiliser l’IA.',
    },
    { status: 403 }
  )
}

/** Initial message budget for a brand-new trial user. Exposed for tests / init endpoint. */
export const TRIAL_INITIAL_BUDGET = TRIAL_INITIAL_MESSAGES
