import type { Env } from '../../env'

// Durcissement (audit 29 mai) — un redirect_uri valide est soit '' (app native
// qui échange via serverAuthCode, BUG 2/28), soit une URL http(s) dont le path
// est exactement /auth/callback. Bloque les schemes exotiques (javascript:,
// data:) et les path/query injectés. Google revérifie la correspondance
// code↔redirect_uri — défense en profondeur.
function isValidRedirectUri(uri: string): boolean {
  if (uri === '') return true
  try {
    const u = new URL(uri)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.pathname === '/auth/callback'
  } catch {
    return false
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { code, redirect_uri } = await request.json() as { code?: string; redirect_uri?: string }

  if (!code || redirect_uri === undefined || redirect_uri === null) {
    return Response.json({ error: 'Missing code or redirect_uri' }, { status: 400 })
  }

  if (!isValidRedirectUri(redirect_uri)) {
    return Response.json({ error: 'Invalid redirect_uri' }, { status: 400 })
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri,
        grant_type: 'authorization_code',
      }),
    })

    const data = await response.json() as Record<string, unknown>

    if (!response.ok) {
      // Preserve Google's original `error` code AND the description.
      // Same fix as /api/auth/refresh — used to overwrite `error` with
      // the human-readable description, breaking client-side detection.
      return Response.json(
        {
          error: data.error,
          error_description: data.error_description,
        },
        { status: response.status },
      )
    }

    return Response.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    })
  } catch {
    return Response.json({ error: 'Token exchange failed' }, { status: 500 })
  }
}
