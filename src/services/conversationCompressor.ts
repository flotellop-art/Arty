import { apiUrl } from './apiBase'

// Rough token estimation: ~4 chars per token for French text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, m) => total + estimateTokens(m.content) + 10, 0)
}

// Sonnet 4.6 a un contexte de 200k tokens : on peut largement attendre 80k
// avant de compresser. Plus on garde de messages verbatim, plus Claude
// préserve les chiffres et nuances (devis, calculs, contexte client).
const COMPRESSION_THRESHOLD = 80000 // tokens
const KEEP_RECENT = 20 // garde les 20 derniers messages intacts (~10 échanges)

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

  // Build summary of old messages — 2000 chars per message au lieu de 500,
  // pour donner au résumeur assez de matière sur les longues conversations.
  const oldText = oldMessages.map(m => {
    const content = typeof m.content === 'string' ? m.content : '[contenu multimédia]'
    const role = m.role === 'user' ? 'Utilisateur' : 'Arty'
    return `${role}: ${content.slice(0, 2000)}`
  }).join('\n')

  // Ask Claude to summarize (non-streaming, fast)
  try {
    const response = await fetch(apiUrl('/api/ai/proxy'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Sonnet plutôt que Haiku : la compression ne se déclenche qu'au-delà
        // de 80k tokens, donc rare. À ce stade la conversation contient
        // souvent des chiffres/décisions critiques que Haiku perdait.
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `Résume cette conversation en gardant TOUTES les infos clés : noms, chiffres précis (montants, taux, dates), décisions prises, fichiers mentionnés, contexte client/projet. Préserve les nombres exacts. Maximum 1500 mots, en français.\n\n${oldText}`,
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
