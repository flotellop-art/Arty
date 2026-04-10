import type { Env } from '../../env'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { code, redirect_uri } = await request.json() as { code?: string; redirect_uri?: string }

  if (!code || !redirect_uri) {
    return Response.json({ error: 'Missing code or redirect_uri' }, { status: 400 })
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
      return Response.json({ error: data.error_description || data.error }, { status: response.status })
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
