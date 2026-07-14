const PUBLIC_GOOGLE_SCOPE_SET = new Set([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
])

const SCOPE_ALIASES: Record<string, string> = {
  email: 'https://www.googleapis.com/auth/userinfo.email',
  profile: 'https://www.googleapis.com/auth/userinfo.profile',
}

export type PublicGoogleScopeCheck =
  | { ok: true }
  | { ok: false; reason: 'tokeninfo_unavailable' | 'scope_missing' | 'scope_mismatch' }

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
    )
    if (!response.ok) return { ok: false, reason: 'tokeninfo_unavailable' }

    const data = await response.json() as Record<string, unknown>
    if (typeof data.scope !== 'string' || !data.scope.trim()) {
      return { ok: false, reason: 'scope_missing' }
    }

    const actual = new Set(
      data.scope.trim().split(/\s+/).map((scope) => SCOPE_ALIASES[scope] || scope),
    )
    const exact = actual.size === PUBLIC_GOOGLE_SCOPE_SET.size
      && [...actual].every((scope) => PUBLIC_GOOGLE_SCOPE_SET.has(scope))

    return exact ? { ok: true } : { ok: false, reason: 'scope_mismatch' }
  } catch {
    return { ok: false, reason: 'tokeninfo_unavailable' }
  }
}

export async function revokeGoogleGrant(token: string): Promise<void> {
  if (!token) return
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  } catch {
    // Le jeton n'est jamais renvoyé au client lorsque le contrôle échoue.
  }
}
