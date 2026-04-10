// Rough token estimation: ~4 chars per token for French text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, m) => total + estimateTokens(m.content) + 10, 0)
}

// Max tokens before compression kicks in (~60k chars = ~15k tokens)
const COMPRESSION_THRESHOLD = 12000 // tokens
const KEEP_RECENT = 6 // always keep last N messages uncompressed

interface ApiMessage {
  role: string
  content: string | Array<Record<string, unknown>>
}

export async function compressIfNeeded(
  messages: ApiMessage[],
  _systemPrompt: string | undefined,
  apiKey: string
): Promise<ApiMessage[]> {
  // Only compress text messages (skip content blocks with files)
  const textMessages = messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '[contenu multimédia]',
  }))

  const totalTokens = estimateMessagesTokens(textMessages)

  // Under threshold — no compression needed
  if (totalTokens < COMPRESSION_THRESHOLD || messages.length <= KEEP_RECENT + 2) {
    return messages
  }

  // Split: old messages to compress + recent messages to keep
  const oldMessages = messages.slice(0, -KEEP_RECENT)
  const recentMessages = messages.slice(-KEEP_RECENT)

  // Build summary of old messages
  const oldText = oldMessages.map(m => {
    const content = typeof m.content === 'string' ? m.content : '[contenu multimédia]'
    const role = m.role === 'user' ? 'Utilisateur' : 'Arty'
    return `${role}: ${content.slice(0, 500)}`
  }).join('\n')

  // Ask Claude to summarize (non-streaming, fast)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Résume cette conversation en gardant les infos clés (noms, chiffres, décisions, fichiers mentionnés). Maximum 500 mots, en français.\n\n${oldText}`,
        }],
      }),
    })

    if (!response.ok) {
      // Compression failed — return original messages
      return messages
    }

    const data = await response.json()
    const summary = data.content?.[0]?.text || ''

    if (!summary) return messages

    // Build compressed messages: summary + recent
    const compressedMessages: ApiMessage[] = [
      {
        role: 'user',
        content: `[Résumé des messages précédents de cette conversation :\n${summary}\n— Fin du résumé. La conversation continue ci-dessous.]`,
      },
      {
        role: 'assistant',
        content: 'Compris, j\'ai le contexte de notre conversation précédente. Je continue.',
      },
      ...recentMessages,
    ]

    return compressedMessages
  } catch {
    // On error, return original messages
    return messages
  }
}
