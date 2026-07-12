import type { Env } from '../../env'
import { parseAllowedEmails, verifyTokenViaTokeninfo } from '../_lib/checkAllowedUser'
import { PREMIUM_BUCKET_CAPS } from '../_lib/checkPremiumCap'
import {
  FREE_DAILY_LIMITS,
  peekFreeDailyRemaining,
  type ModelFamily,
} from '../_lib/freeQuota'

// Familles de modèles + leurs labels UI. La whitelist d'accès dépend du plan.
// Mistral est désormais réservé aux payants (Medium uniquement, mai 2026).
const ALL_FAMILIES = [
  'claude-haiku',
  'claude-sonnet',
  'claude-opus',
  'mistral-medium',
  'gemini-flash',
  'gemini-pro',
  'gpt-mini',
  'gpt-full',
] as const

type Family = (typeof ALL_FAMILIES)[number]

const FREE_FAMILIES: Family[] = ['claude-haiku']
// Pro/VIP/Subscription débloquent tout sans distinction.
const PAID_FAMILIES: Family[] = [...ALL_FAMILIES]

interface StatusResponse {
  email: string
  plan: 'free' | 'subscription' | 'pro' | 'vip'
  status: 'active' | 'inactive' | 'cancelled' | 'expired' | 'past_due'
  current_period_end: string | null
  premium_pack_remaining: number
  has_active_license: boolean
  // Modèles autorisés / verrouillés pour le frontend (sélecteur de modèle).
  allowed_families: Family[]
  locked_families: Family[]
  // Quotas restants pour les utilisateurs free (par famille). null pour les
  // plans payants (illimité).
  daily_remaining: Partial<Record<ModelFamily, number>> | null
  daily_limits: Partial<Record<ModelFamily, number>> | null
  // P0.6 (plan d'action concurrentiel) — compteurs mensuels premium du plan
  // subscription, par bucket (lecture seule de premium_cap, jamais
  // d'incrément ici). null pour les autres plans (pas de cap).
  monthly_cap: Record<string, { used: number; limit: number; remaining: number }> | null
}

const FREE_RESPONSE: StatusResponse = {
  email: '',
  plan: 'free',
  status: 'inactive',
  current_period_end: null,
  premium_pack_remaining: 0,
  has_active_license: false,
  allowed_families: FREE_FAMILIES,
  locked_families: ALL_FAMILIES.filter((f) => !FREE_FAMILIES.includes(f)),
  daily_remaining: { 'claude-haiku': FREE_DAILY_LIMITS['claude-haiku'] },
  daily_limits: { 'claude-haiku': FREE_DAILY_LIMITS['claude-haiku'] },
  monthly_cap: null,
}

const STATUS_HEADERS = {
  // Public read-only endpoint — middleware overwrites this with the
  // specific Origin for whitelisted callers (tryarty.com, capacitor://…),
  // so '*' only persists for unknown origins. Response carries no PII
  // unless the caller proves identity via a valid Google token, so
  // unauthenticated cross-origin reads return only the inert FREE_RESPONSE.
  'Access-Control-Allow-Origin': '*',
}

function jsonStatus(body: StatusResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...STATUS_HEADERS },
  })
}

export interface SubscriptionRow {
  plan_type: string
  status: string
  current_period_end: string | null
}

interface LicenseRow {
  ok: number
}

interface RemainingRow {
  remaining: number | null
}

function normalizePlan(raw: string | undefined): StatusResponse['plan'] {
  if (raw === 'subscription' || raw === 'pro' || raw === 'vip') return raw
  return 'free'
}

function normalizeStatus(raw: string | undefined): StatusResponse['status'] {
  if (
    raw === 'active' ||
    raw === 'inactive' ||
    raw === 'cancelled' ||
    raw === 'expired' ||
    raw === 'past_due'
  ) {
    return raw
  }
  return 'inactive'
}

function isCurrentSubscription(sub: SubscriptionRow | null, nowMs: number): boolean {
  if (!sub) return false
  if (['active', 'on_trial', 'paused', 'past_due', 'unpaid'].includes(sub.status)) return true
  if (sub.status !== 'cancelled') return false
  if (!sub.current_period_end) return true
  const end = new Date(sub.current_period_end).getTime()
  return Number.isFinite(end) && end > nowMs
}

/**
 * Même priorité que resolveUserPlan : un abonnement payant courant prime sur
 * la licence Pro. C'est indispensable pour un détenteur Pro qui s'abonne :
 * son plan affiché doit rester `subscription` afin d'activer les clés serveur.
 */
export function resolveStatusEntitlement(
  sub: SubscriptionRow | null,
  hasActiveLicense: boolean,
  nowMs = Date.now(),
): Pick<StatusResponse, 'plan' | 'status'> {
  const currentSub = isCurrentSubscription(sub, nowMs) ? sub : null
  const currentSubPlan = normalizePlan(currentSub?.plan_type)

  if (currentSubPlan !== 'free') {
    return { plan: currentSubPlan, status: normalizeStatus(currentSub?.status) }
  }
  if (hasActiveLicense) return { plan: 'pro', status: 'active' }
  return { plan: 'free', status: normalizeStatus(sub?.status) }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization')
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) return jsonStatus(FREE_RESPONSE)

  const email = await verifyTokenViaTokeninfo(token, env.GOOGLE_CLIENT_ID)
  if (!email) return jsonStatus(FREE_RESPONSE)

  // ALLOWED_EMAILS = bypass VIP : reflète le runtime de checkAllowedUser pour
  // que l'UI affiche "VIP · ∞" même quand la ligne D1 dit autre chose
  // (c'était le bug où Noah voyait "trial" alors qu'il était whitelist VIP).
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowed.includes(email)) {
    return jsonStatus({
      email,
      plan: 'vip',
      status: 'active',
      current_period_end: null,
      premium_pack_remaining: 0,
      has_active_license: false,
      allowed_families: PAID_FAMILIES,
      locked_families: [],
      daily_remaining: null,
      daily_limits: null,
      monthly_cap: null,
    })
  }

  if (!env.DB) {
    const remaining = await peekFreeDailyRemaining(env, email)
    return jsonStatus({
      ...FREE_RESPONSE,
      email,
      daily_remaining: remaining,
    })
  }

  // Tables may not exist if no Lemon Squeezy webhook has fired yet — treat
  // any DB error as "no subscription found" rather than 500ing the client.
  let sub: SubscriptionRow | null = null
  let license: LicenseRow | null = null
  let remaining = 0

  try {
    sub = await env.DB.prepare(
      `SELECT plan_type, status, current_period_end
         FROM subscriptions
        WHERE user_email = ?1
        ORDER BY updated_at DESC
        LIMIT 1`
    )
      .bind(email)
      .first<SubscriptionRow>()
  } catch (err) {
    console.error('[subscription/status] subscriptions query failed', err)
  }

  try {
    // Licences Pro = à vie (pas de colonne `expires_at` en prod — l'ancien
    // filtre faisait planter la requête → catch → Pro affiché comme free).
    // Réconciliation 15 juin : gate = `status = 'active'`.
    license = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM licenses
        WHERE user_email = ?1
          AND status = 'active'
        LIMIT 1`
    )
      .bind(email)
      .first<LicenseRow>()
  } catch (err) {
    console.error('[subscription/status] licenses query failed', err)
  }

  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(messages_total - messages_used), 0) AS remaining
         FROM premium_packs
        WHERE user_email = ?1 AND messages_used < messages_total`
    )
      .bind(email)
      .first<RemainingRow>()
    remaining = Math.max(0, row?.remaining ?? 0)
  } catch (err) {
    console.error('[subscription/status] premium_packs query failed', err)
  }

  const hasActiveLicense = !!license
  const { plan, status } = resolveStatusEntitlement(sub, hasActiveLicense)

  // Construit l'allowlist de familles + le quota restant. Free → familles
  // limitées + compteurs KV, payant → tout illimité.
  const isFree = plan === 'free'
  const allowedFamilies = isFree ? FREE_FAMILIES : PAID_FAMILIES
  const lockedFamilies = isFree
    ? ALL_FAMILIES.filter((f) => !FREE_FAMILIES.includes(f))
    : []
  const dailyRemaining = isFree ? await peekFreeDailyRemaining(env, email) : null
  const dailyLimits = isFree
    ? {
        'claude-haiku': FREE_DAILY_LIMITS['claude-haiku'],
      }
    : null

  // P0.6 — compteurs mensuels premium, plan subscription uniquement (les
  // autres plans n'ont pas de cap). Lecture seule de premium_cap, une seule
  // requête, jamais d'incrément ici (checkPremiumCap reste le seul écrivain).
  // L'identité (email) vient du token vérifié ci-dessus, jamais du client.
  let monthlyCap: StatusResponse['monthly_cap'] = null
  if (plan === 'subscription') {
    const month = new Date().toISOString().slice(0, 7)
    const used: Record<string, number> = {}
    try {
      const rows = await env.DB.prepare(
        `SELECT bucket, count FROM premium_cap WHERE email = ?1 AND month = ?2`
      )
        .bind(email, month)
        .all<{ bucket: string; count: number }>()
      for (const r of rows.results ?? []) used[r.bucket] = r.count
    } catch (err) {
      // Table absente au premier mois (créée au premier appel premium) —
      // tous les compteurs sont alors à 0, ce qui est correct.
      console.error('[subscription/status] premium_cap query failed', err)
    }
    monthlyCap = {}
    for (const [bucket, limit] of Object.entries(PREMIUM_BUCKET_CAPS)) {
      const u = Math.min(used[bucket] ?? 0, limit)
      monthlyCap[bucket] = { used: u, limit, remaining: limit - u }
    }
  }

  return jsonStatus({
    email,
    plan,
    status,
    current_period_end: sub?.current_period_end ?? null,
    premium_pack_remaining: remaining,
    has_active_license: hasActiveLicense,
    allowed_families: allowedFamilies,
    locked_families: lockedFamilies,
    daily_remaining: dailyRemaining,
    daily_limits: dailyLimits,
    monthly_cap: monthlyCap,
  })
}
