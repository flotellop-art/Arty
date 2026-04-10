import type { Env } from '../../env'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { refresh_token } = await request.json() as { refresh_token?: string }

  if (!refresh_token) {
    return Response.json({ error: 'Missing refresh_token' }, { status: 400 })
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
      return Response.json({ error: data.error_description || data.error }, { status: response.status })
    }

    return Response.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    })
  } catch {
    return Response.json({ error: 'Token refresh failed' }, { status: 500 })
  }
}
