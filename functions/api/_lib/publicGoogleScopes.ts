export const CURRENT_GOOGLE_OAUTH_PROFILE = 'calendar-events-owned-v2' as const
export type GoogleOAuthProfile = typeof CURRENT_GOOGLE_OAUTH_PROFILE

const CURRENT_PUBLIC_GOOGLE_SCOPE_SET = new Set([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events.owned',
])

const SCOPE_ALIASES: Record<string, string> = {
  email: 'https://www.googleapis.com/auth/userinfo.email',
  profile: 'https://www.googleapis.com/auth/userinfo.profile',
}

export type PublicGoogleScopeCheck =
  | { ok: true; profile: GoogleOAuthProfile }
  | { ok: false; reason: 'tokeninfo_unavailable' | 'scope_missing' | 'scope_mismatch' }

function setEquals(actual: Set<string>, expected: Set<string>): boolean {
  return actual.size === expected.size && [...actual].every((scope) => expected.has(scope))
}

export function validatePublicGoogleScopeClaim(scopeClaim: unknown): PublicGoogleScopeCheck {
  if (typeof scopeClaim !== 'string' || !scopeClaim.trim()) {
    return { ok: false, reason: 'scope_missing' }
  }
  const actual = new Set(
    scopeClaim.trim().split(/\s+/).map((scope) => SCOPE_ALIASES[scope] || scope),
  )
  return setEquals(actual, CURRENT_PUBLIC_GOOGLE_SCOPE_SET)
    ? { ok: true, profile: CURRENT_GOOGLE_OAUTH_PROFILE }
    : { ok: false, reason: 'scope_mismatch' }
}

/**
 * Vérifie le grant réellement émis par Google, pas seulement la configuration
 * demandée par le client. Tout scope surnuméraire est rejeté : un ancien
 * consentement cumulatif ne peut donc pas réintroduire un accès restreint.
 */
export async function validatePublicGoogleAccessToken(
  accessToken: string,
): Promise<PublicGoogleScopeCheck> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(10_000) },
    )
    if (!response.ok) return { ok: false, reason: 'tokeninfo_unavailable' }

    const data = await response.json() as Record<string, unknown>
    return validatePublicGoogleScopeClaim(data.scope)
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
