import type { Env } from '../../env'

const AI_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/ea69cd5ca383355efe77bf22e68207e4/arty/anthropic/v1/messages'

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  // Get the API key from the request header (user's BYOK key)
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) {
    return Response.json({ error: 'Missing API key' }, { status: 401 })
  }

  // Forward the request body as-is
  const body = await request.text()

  // Build headers — only include non-empty values
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
  }

  // Only add anthropic-beta if it has a value
  const beta = request.headers.get('anthropic-beta')
  if (beta) {
    headers['anthropic-beta'] = beta
  }

  try {
    // Forward to AI Gateway with the user's API key
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers,
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
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 502 }
    )
  }
}
