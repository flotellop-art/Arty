export const CURRENT_GOOGLE_OAUTH_PROFILE = 'calendar-events-v1' as const
export const LEGACY_GOOGLE_OAUTH_PROFILE = 'legacy-calendar-v1' as const
export type GoogleOAuthProfile =
  | typeof CURRENT_GOOGLE_OAUTH_PROFILE
  | typeof LEGACY_GOOGLE_OAUTH_PROFILE

const CURRENT_PUBLIC_GOOGLE_SCOPE_SET = new Set([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events',
])

const LEGACY_PUBLIC_GOOGLE_SCOPE_SET = new Set([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
])
const HARD_MAX_LEGACY_COMPAT_UNTIL_MS = Date.parse('2026-07-21T23:59:59Z')

const SCOPE_ALIASES: Record<string, string> = {
  email: 'https://www.googleapis.com/auth/userinfo.email',
  profile: 'https://www.googleapis.com/auth/userinfo.profile',
}

export type PublicGoogleScopeCheck =
  | { ok: true; profile: GoogleOAuthProfile }
  | { ok: false; reason: 'tokeninfo_unavailable' | 'scope_missing' | 'scope_mismatch' }

export function isLegacyGoogleOAuthCompatActive(until: string | undefined): boolean {
  if (!until) return false
  const cutoff = Date.parse(until)
  return Number.isFinite(cutoff)
    && cutoff <= HARD_MAX_LEGACY_COMPAT_UNTIL_MS
    && Date.now() <= cutoff
}

function setEquals(actual: Set<string>, expected: Set<string>): boolean {
  return actual.size === expected.size && [...actual].every((scope) => expected.has(scope))
}

/**
 * Vérifie le grant réellement émis par Google, pas seulement la configuration
 * demandée par le client. Tout scope surnuméraire est rejeté : un ancien
 * consentement cumulatif ne peut donc pas réintroduire un accès restreint.
 */
export async function validatePublicGoogleAccessToken(
  accessToken: string,
  options: {
    requiredProfile?: typeof CURRENT_GOOGLE_OAUTH_PROFILE
    allowLegacy?: boolean
  } = {},
): Promise<PublicGoogleScopeCheck> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    )
    if (!response.ok) return { ok: false, reason: 'tokeninfo_unavailable' }

    const data = await response.json() as Record<string, unknown>
    if (typeof data.scope !== 'string' || !data.scope.trim()) {
      return { ok: false, reason: 'scope_missing' }
    }

    const actual = new Set(
      data.scope.trim().split(/\s+/).map((scope) => SCOPE_ALIASES[scope] || scope),
    )
    if (setEquals(actual, CURRENT_PUBLIC_GOOGLE_SCOPE_SET)) {
      return { ok: true, profile: CURRENT_GOOGLE_OAUTH_PROFILE }
    }
    if (
      !options.requiredProfile
      && options.allowLegacy
      && setEquals(actual, LEGACY_PUBLIC_GOOGLE_SCOPE_SET)
    ) {
      return { ok: true, profile: LEGACY_GOOGLE_OAUTH_PROFILE }
    }
    return { ok: false, reason: 'scope_mismatch' }
  } catch {
    return { ok: false, reason: 'tokeninfo_unavailable' }
  }
}

export async function revokeGoogleGrant(token: string): Promise<boolean> {
  if (!token) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: controller.signal,
    })
    return response.ok
  } catch {
    // Le jeton n'est jamais renvoyé au client lorsque le contrôle échoue.
    return false
  } finally {
    clearTimeout(timeout)
  }
}
