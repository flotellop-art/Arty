import type { Env } from '../../env'
import {
  CURRENT_GOOGLE_OAUTH_PROFILE,
  isLegacyGoogleOAuthCompatActive,
  revokeGoogleGrant,
  validatePublicGoogleAccessToken,
} from '../_lib/publicGoogleScopes'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { refresh_token, oauth_profile } = await request.json() as {
    refresh_token?: string
    oauth_profile?: string
  }

  if (!refresh_token) {
    return Response.json({ error: 'Missing refresh_token' }, { status: 400 })
  }
  if (oauth_profile !== undefined && oauth_profile !== CURRENT_GOOGLE_OAUTH_PROFILE) {
    return Response.json({ error: 'unsupported_oauth_profile' }, { status: 400 })
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    })

    const data = await response.json() as Record<string, unknown>

    if (!response.ok) {
      // Preserve Google's original `error` code (e.g. "invalid_grant") AND
      // the human-readable description. Earlier this returned only the
      // description as `error`, which broke client-side detection of
      // revoked refresh tokens (BUG 48).
      return Response.json(
        {
          error: data.error,
          error_description: data.error_description,
        },
        { status: response.status },
      )
    }

    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    if (!accessToken) {
      return Response.json({ error: 'Google token response missing access token' }, { status: 502 })
    }

    const scopeCheck = await validatePublicGoogleAccessToken(accessToken, {
      requiredProfile: oauth_profile === CURRENT_GOOGLE_OAUTH_PROFILE
        ? CURRENT_GOOGLE_OAUTH_PROFILE
        : undefined,
      allowLegacy: oauth_profile === undefined
        && isLegacyGoogleOAuthCompatActive(env.GOOGLE_OAUTH_LEGACY_COMPAT_UNTIL),
    })
    if (!scopeCheck.ok) {
      // Un grant n'est révoqué que lorsque des scopes surnuméraires sont
      // effectivement observés. Les indisponibilités de tokeninfo échouent
      // fermé pour l'appel courant sans détruire un grant potentiellement sain.
      if (scopeCheck.reason === 'scope_mismatch') {
        await revokeGoogleGrant(refresh_token)
      }
      return Response.json(
        { error: 'invalid_scope_set' },
        { status: scopeCheck.reason === 'scope_mismatch' ? 403 : 502 },
      )
    }
    if (scopeCheck.profile !== CURRENT_GOOGLE_OAUTH_PROFILE) {
      console.info('[google-oauth] accepted legacy-calendar-v1 refresh')
    }

    return Response.json({
      access_token: accessToken,
      expires_in: data.expires_in,
      token_type: data.token_type,
      oauth_profile: scopeCheck.profile,
    })
  } catch {
    return Response.json({ error: 'Token refresh failed' }, { status: 500 })
  }
}
