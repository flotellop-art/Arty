import type { Env } from '../../env'
import { verifyTokenViaTokeninfo } from '../_lib/checkAllowedUser'

interface ActivateBody {
  license_key?: unknown
  email?: unknown
  device_id?: unknown
}

interface LicenseRow {
  ls_order_id: string
  status: string
  max_activations: number
  activation_count: number
}

const CORS_HEADERS = {
  // Public activation endpoint — middleware overwrites this for whitelisted
  // origins. Non-GET requests with an unknown Origin are blocked upstream
  // (CSRF check in functions/api/_middleware.ts), so '*' here is decorative.
  'Access-Control-Allow-Origin': '*',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LICENSE_KEY_RE = /^[A-Za-z0-9-]{8,128}$/

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function maskKey(key: string): string {
  return key.length <= 4 ? '****' : `****${key.slice(-4)}`
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) {
    return jsonResponse({ error: 'database_not_configured' }, 500)
  }

  let body: ActivateBody
  try {
    body = (await request.json()) as ActivateBody
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const licenseKey = typeof body.license_key === 'string' ? body.license_key.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : ''

  if (!licenseKey || !email || !deviceId) {
    return jsonResponse({ error: 'missing_fields' }, 400)
  }
  if (!LICENSE_KEY_RE.test(licenseKey)) {
    return jsonResponse({ error: 'invalid_license_key' }, 400)
  }
  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ error: 'invalid_email' }, 400)
  }
  if (!UUID_RE.test(deviceId)) {
    return jsonResponse({ error: 'invalid_device_id' }, 400)
  }

  // Soft-require Google : si un token est fourni, il DOIT correspondre à l'email
  // du body — ça lie l'activation à l'utilisateur Google authentifié. Absence de
  // token (utilisateurs email-OTP ou clé API sans Google, ~majorité des comptes
  // Pro=BYOK) → la paire secrète (license_key, email) en D1 reste l'unique preuve,
  // comportement inchangé pour eux. verifyTokenViaTokeninfo est strict (aud +
  // email_verified) : adapté à un endpoint de paiement (vs verifyGoogleUser,
  // finding N-1). Edge-case assumé : un user Google activant une licence achetée
  // sous un AUTRE email sera rejeté ici (le token doit matcher).
  const googleToken = request.headers.get('x-google-token') || ''
  if (googleToken) {
    if (!env.GOOGLE_CLIENT_ID) {
      console.error('[license/activate] GOOGLE_CLIENT_ID manquant — garde aud désactivée')
    }
    const verifiedEmail = await verifyTokenViaTokeninfo(googleToken, env.GOOGLE_CLIENT_ID)
    if (!verifiedEmail || verifiedEmail !== email) {
      // 404 uniforme : ne révèle pas l'existence de la licence (cf. RÈGLE 6 leak).
      return jsonResponse({ error: 'license_not_found' }, 404)
    }
  }

  let license: LicenseRow | null = null
  try {
    license = await env.DB.prepare(
      `SELECT ls_order_id, status, max_activations, activation_count
         FROM licenses
        WHERE license_key = ?1 AND user_email = ?2
        LIMIT 1`
    )
      .bind(licenseKey, email)
      .first<LicenseRow>()
  } catch (err) {
    console.error(`[license/activate] lookup failed key=${maskKey(licenseKey)}`, err)
    return jsonResponse({ error: 'license_not_found' }, 404)
  }

  if (!license) {
    console.log(`[license/activate] not_found key=${maskKey(licenseKey)}`)
    return jsonResponse({ error: 'license_not_found' }, 404)
  }

  if (license.status !== 'active') {
    return jsonResponse({ error: 'license_inactive' }, 403)
  }

  if (license.activation_count >= license.max_activations) {
    return jsonResponse(
      { error: 'max_activations_reached', max: license.max_activations },
      403
    )
  }

  // Atomic increment guarded by the activation_count we just read — prevents
  // a race where two parallel activations both pass the cap check above and
  // each bump the counter past max_activations.
  const update = await env.DB.prepare(
    `UPDATE licenses
        SET activation_count = activation_count + 1
      WHERE license_key = ?1
        AND user_email = ?2
        AND ls_order_id = ?3
        AND status = 'active'
        AND activation_count < max_activations`
  )
    .bind(licenseKey, email, license.ls_order_id)
    .run()

  if (!update.success || (update.meta?.changes ?? 0) === 0) {
    return jsonResponse(
      { error: 'max_activations_reached', max: license.max_activations },
      403
    )
  }

  const newActivations = license.activation_count + 1

  try {
    // Garde anti-downgrade : ne PAS écraser un abonnement mensuel actif (ou un
    // VIP) en `pro` (= BYOK, accès clé serveur perdu). Pour free/trial/inactive
    // → devient pro. created_at préservé (hors INSERT/SET).
    await env.DB.prepare(
      `INSERT INTO subscriptions
        (user_email, plan_type, status, ls_subscription_id, ls_customer_id,
         ls_variant_id, current_period_end, updated_at)
       VALUES (?1, 'pro', 'active', NULL, NULL, NULL, NULL, datetime('now'))
       ON CONFLICT(user_email) DO UPDATE SET
         plan_type = 'pro',
         status = 'active',
         updated_at = datetime('now')
       WHERE subscriptions.plan_type NOT IN ('subscription', 'vip')`
    )
      .bind(email)
      .run()
  } catch (err) {
    console.error('[license/activate] subscriptions upsert failed', err)
    // Activation already counted — surface success but log so we can heal
    // the subscriptions row out-of-band rather than rolling back the count.
  }

  console.log(
    `[license/activate] ok key=${maskKey(licenseKey)} act=${newActivations}/${license.max_activations}`
  )

  return jsonResponse({
    success: true,
    plan_type: 'pro',
    activations_used: newActivations,
    activations_max: license.max_activations,
  })
}
