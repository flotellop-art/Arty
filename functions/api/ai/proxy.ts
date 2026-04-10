import type { Env } from '../../env'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const AI_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/ea69cd5ca383355efe77bf22e68207e4/arty/anthropic/v1/messages'

  // Get the API key from the request header (user's BYOK key)
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) {
    return Response.json({ error: 'Missing API key' }, { status: 401 })
  }

  // Forward the request body as-is
  const body = await request.text()

  // Forward to AI Gateway with the user's API key
  const response = await fetch(AI_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
      'anthropic-beta': request.headers.get('anthropic-beta') || '',
    },
    body,
  })

  // Stream the response back to the client
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'text/event-stream',
      'cache-control': 'no-cache',
    },
  })
}
