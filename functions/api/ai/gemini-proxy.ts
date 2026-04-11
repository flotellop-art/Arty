import type { Env } from '../../env'
import { checkAllowedUser } from '../_lib/checkAllowedUser'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Use client's BYOK key first
  let apiKey = request.headers.get('authorization')?.replace('Bearer ', '') || ''

  // If no BYOK key, check if user is allowed to use server key
  if (!apiKey && env.GEMINI_API_KEY) {
    const allowed = await checkAllowedUser(request, env)
    if (allowed) {
      apiKey = env.GEMINI_API_KEY
    }
  }

  if (!apiKey) {
    return Response.json({ error: 'Missing Gemini API key' }, { status: 401 })
  }

  try {
    const { model, stream, ...body } = await request.json() as { model: string; stream: boolean; [key: string]: unknown }

    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const suffix = stream ? '?alt=sse' : ''
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}${suffix}&key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
