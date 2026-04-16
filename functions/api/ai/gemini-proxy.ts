import type { Env } from '../../env'
import { checkAllowedUser } from '../_lib/checkAllowedUser'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Require a verified Google account — prevents anonymous relay use.
  const email = await checkAllowedUser(request, env)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK obligatoire — pas de fallback sur les clés serveur
  const apiKey = request.headers.get('authorization')?.replace('Bearer ', '') || ''

  if (!apiKey) {
    return Response.json(
      { error: 'Clé API requise — veuillez configurer votre clé dans les paramètres' },
      { status: 401 }
    )
  }

  try {
    const { model, stream, ...body } = await request.json() as { model: string; stream: boolean; [key: string]: unknown }

    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const suffix = stream ? '?alt=sse' : ''
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}${suffix}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown Gemini error')
      return new Response(errorText, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'text/event-stream',
        'cache-control': 'no-cache',
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gemini proxy error' },
      { status: 502 }
    )
  }
}
