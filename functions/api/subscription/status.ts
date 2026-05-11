import type { Env } from '../../env'
import { parseAllowedEmails } from '../_lib/checkAllowedUser'
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

async function verifyTokenViaTokeninfo(token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    )
    if (!res.ok) return null
    const info = (await res.json()) as { email?: string; email_verified?: string | boolean }
    const email = info.email?.toLowerCase()
    if (!email) return null
    return email
  } catch {
    return null
  }
}

interface SubscriptionRow {
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization')
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) return jsonStatus(FREE_RESPONSE)

  const email = await verifyTokenViaTokeninfo(token)
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
    license = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM licenses
        WHERE user_email = ?1 AND status = 'active'
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

  // License active overrides subscription plan to 'pro' (one-shot purchase
  // grants Pro access regardless of any prior sub state).
  const hasActiveLicense = !!license
  const plan: StatusResponse['plan'] = hasActiveLicense
    ? 'pro'
    : normalizePlan(sub?.plan_type)
  const status: StatusResponse['status'] = hasActiveLicense
    ? 'active'
    : normalizeStatus(sub?.status)

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
  })
}
