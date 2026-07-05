import { apiUrl } from './apiBase'
import { buildAiHeaders, fetchWithTimeout } from './aiHttp'

// Nom de l'event émis quand on vient de compresser le contexte d'une conversation.
// L'UI (bannière discrète) écoute pour PRÉVENIR l'utilisateur — la compression
// silencieuse violait le principe « jamais de bascule cachée » (P1.7, 14 juin).
export const CONTEXT_COMPRESSED_EVENT = 'arty-context-compressed'

function notifyCompressed(keptRecent: number): void {
  try {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent(CONTEXT_COMPRESSED_EVENT, { detail: { keptRecent } })
    )
  } catch {
    /* pas de window (tests) — non bloquant */
  }
}

// ── Estimation de tokens ───────────────────────────────────────────────────────
// Deux corrections par rapport au naïf `length / 4` :
//  1. Le français s'encode à ~3,8 caractères/token sur le tokenizer de Claude
//     (vs ~4 pour l'anglais) — ajustement mineur.
//  2. CRITIQUE : l'ancien code écrasait TOUT message non-string (les
//     tool_results qui portent les corps d'emails, le texte Drive, les pages
//     web…) en la chaîne '[contenu multimédia]' (~4 tokens) AVANT de compter.
//     Une conversation avec plusieurs lectures Gmail/Drive (8-10k caractères
//     chacune) était donc estimée minuscule et ne franchissait jamais le seuil
//     → context rot. On parcourt maintenant les blocs pour compter leur vrai
//     texte.
//
// On NE compte volontairement PAS la taille réelle des octets base64 des blocs
// document/image (contrairement à toolResultSize() dans anthropicClient, qui
// borne le coût d'UN message dans la boucle d'outils) : un gros PDF vit le plus
// souvent dans les messages récents conservés, que la compression ne peut pas
// réduire — le compter en entier déclencherait un résumé Sonnet coûteux à
// CHAQUE tour pour rien. Un poids nominal modeste reflète son coût sans ce thrash.
const CHARS_PER_TOKEN = 3.8
const FILE_BLOCK_NOMINAL_TOKENS = 2000

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function estimateContentTokens(content: string | Array<Record<string, unknown>>): number {
  if (typeof content === 'string') return estimateTextTokens(content)
  if (!Array.isArray(content)) return 0
  let tokens = 0
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const type = typeof block.type === 'string' ? block.type : ''
    // Bloc texte (message simple) ou bloc thinking de l'assistant.
    if (typeof block.text === 'string') tokens += estimateTextTokens(block.text)
    if (typeof block.thinking === 'string') tokens += estimateTextTokens(block.thinking)
    // tool_use : les arguments de l'outil.
    if (block.input !== undefined) tokens += estimateTextTokens(JSON.stringify(block.input))
    // tool_result : content = string OU tableau de sous-blocs (texte + fichiers).
    if (block.content !== undefined) {
      const c = block.content
      if (typeof c === 'string') {
        tokens += estimateTextTokens(c)
      } else if (Array.isArray(c)) {
        for (const sub of c as Array<Record<string, unknown>>) {
          if (sub && typeof sub.text === 'string') tokens += estimateTextTokens(sub.text)
          if (sub && sub.source !== undefined) tokens += FILE_BLOCK_NOMINAL_TOKENS
        }
      }
    }
    // Bloc document/image directement au niveau du message (PJ utilisateur).
    if ((type === 'document' || type === 'image') && block.source !== undefined) {
      tokens += FILE_BLOCK_NOMINAL_TOKENS
    }
  }
  return tokens
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
): number {
  return messages.reduce((total, m) => total + estimateContentTokens(m.content) + 10, 0)
}

// Sonnet 4.6 a un contexte de 200k tokens : on peut largement attendre 80k
// avant de compresser. Plus on garde de messages verbatim, plus Claude
// préserve les chiffres et nuances (devis, calculs, contexte client).
export const COMPRESSION_THRESHOLD = 80000 // tokens
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
  // Estime sur les messages RÉELS (texte des tool_results inclus) — le flatten
  // précédent en '[contenu multimédia]' sous-estimait massivement les convs
  // riches en lectures Gmail/Drive et empêchait toute compression.
  const totalTokens = estimateMessagesTokens(messages)

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

  // Ask Claude to summarize (non-streaming, fast).
  //
  // Headers via buildAiHeaders (C9) — ce fichier envoyait `x-api-key: apiKey`
  // brut, SANS le garde BUG 25 ni `x-google-token`. Double casse :
  //  1. sentinelle 'server-provided' envoyée comme vraie clé → le proxy la
  //     prenait pour du BYOK → 401 Anthropic upstream ;
  //  2. aucun x-google-token → resolveProxyIdentity (anti-relais CRIT-2/4)
  //     rejetait l'appel en 401 AVANT même le forward, y compris en vrai BYOK.
  // Résultat : la compression ne fonctionnait pour PERSONNE (catch silencieux
  // → messages renvoyés intacts → context rot au-delà de 80k tokens).
  //
  // fetchWithTimeout (45s) : appel non-streamé avec ~60-80k tokens d'input,
  // TTFB long (cf. factChecker : 25-30s mesurés en prod sur non-streamé) —
  // sans timeout, un fetch pendu gelait l'envoi du message utilisateur
  // (compressIfNeeded est await-é sur le chemin d'envoi ; leçon BUG 47).
  // Sur timeout/échec : catch existant → messages originaux, non bloquant.
  try {
    const headers = await buildAiHeaders({
      byokKey: apiKey,
      auth: 'x-api-key',
      extra: { 'anthropic-version': '2023-06-01' },
    })
    const response = await fetchWithTimeout(apiUrl('/api/ai/proxy'), {
      method: 'POST',
      headers,
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
    }, 45_000)

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

    // Compression réellement effectuée → préviens l'UI (bannière discrète).
    notifyCompressed(recentMessages.length)

    return compressedMessages
  } catch {
    // On error, return original messages
    return messages
  }
}
