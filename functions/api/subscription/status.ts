import type { Env } from '../../env'

interface StatusResponse {
  email: string
  plan: 'free' | 'subscription' | 'pro' | 'vip'
  status: 'active' | 'inactive' | 'cancelled' | 'expired' | 'past_due'
  current_period_end: string | null
  premium_pack_remaining: number
  has_active_license: boolean
}

const FREE_RESPONSE: StatusResponse = {
  email: '',
  plan: 'free',
  status: 'inactive',
  current_period_end: null,
  premium_pack_remaining: 0,
  has_active_license: false,
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

  if (!env.DB) {
    return jsonStatus({ ...FREE_RESPONSE, email })
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

  return jsonStatus({
    email,
    plan,
    status,
    current_period_end: sub?.current_period_end ?? null,
    premium_pack_remaining: remaining,
    has_active_license: hasActiveLicense,
  })
}
