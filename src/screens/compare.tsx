/**
 * ComparatorScreen — point d'entrée /compare.
 * Branche les vrais clients IA sur SideBySideChat. Lazy-loadé pour ne pas
 * tirer les clients dans le bundle initial.
 *
 * OpenAI a une signature différente (apiKey en 2e position) -> adaptée ici.
 * Les casts `Parameters<...>` réconcilient les types de messages/options
 * hétérogènes des 4 clients avec la signature uniforme du comparateur.
 *
 * IMPORTANT — Comparateur = répondre SANS tools, avec un system prompt neutre.
 *
 * Les 4 clients d'Arty embarquent par défaut leur gros SYSTEM_PROMPT métier
 * (instructions Drive/web_search/agenda, règles Arty, etc.) ET pour
 * Anthropic/Mistral, ils embarquent les TOOLS d'Arty. Pour le comparateur,
 * on veut au contraire :
 *
 * 1. Aucun tool (sinon Anthropic timeout sur web_search natif, et Mistral
 *    appelle un tool sans handler → panneau vide).
 * 2. Un system prompt minimal, neutre, qui ne pousse pas le modèle à
 *    chercher à utiliser des tools qu'il n'a pas — sinon Claude reçoit
 *    son SYSTEM_PROMPT massif orienté "tu DOIS utiliser web_search",
 *    ne peut pas, et finit en réponse vide.
 *
 * `tools: []` côté Anthropic + `systemPrompt` court neutralisent le bug
 * "panneau Claude vide" remonté en live.
 */

import { streamMessage } from '../services/anthropicClient'
import { streamGeminiMessage } from '../services/geminiClient'
import { streamMistralMessage } from '../services/mistralClient'
import { sendMessageStream } from '../services/openaiClient'
import { getOpenAIKey } from '../services/activeApiKey'
import { SideBySideChat } from '../components/comparator/SideBySideChat'
import type { StreamFactories } from '../services/comparator/useMultiProviderChat'

// System prompt minimal pour le comparateur : neutre, sans mention de tools,
// pour que les modèles répondent à partir de leurs connaissances brutes — c'est
// ce que l'utilisateur veut comparer. Court (1 ligne) pour ne pas biaiser la
// comparaison avec des instructions de style spécifiques à Arty.
const COMPARATOR_SYSTEM_PROMPT =
  'Tu es un assistant IA généraliste. Réponds à la question de l\'utilisateur de manière claire et structurée, en français sauf si la question est dans une autre langue.'

const factories: StreamFactories = {
  anthropic: (m, onToken, onDone, onError, options, key) =>
    streamMessage(
      m as Parameters<typeof streamMessage>[0],
      onToken,
      onDone,
      onError,
      {
        ...(options as Parameters<typeof streamMessage>[4]),
        tools: [],
        systemPrompt: COMPARATOR_SYSTEM_PROMPT,
      },
      key,
    ),
  gemini: (m, onToken, onDone, onError, options, key) =>
    streamGeminiMessage(
      m as Parameters<typeof streamGeminiMessage>[0],
      onToken,
      onDone,
      onError,
      {
        ...(options as Parameters<typeof streamGeminiMessage>[4]),
        systemPrompt: COMPARATOR_SYSTEM_PROMPT,
        tools: [],
      },
      key,
    ),
  mistral: (m, onToken, onDone, onError, options, key) =>
    streamMistralMessage(
      m as Parameters<typeof streamMistralMessage>[0],
      onToken,
      onDone,
      onError,
      { ...(options as Parameters<typeof streamMistralMessage>[4]), systemPrompt: COMPARATOR_SYSTEM_PROMPT },
      key,
    ),
  // OpenAI : clé en 2e position, pas d'apiKeyOverride côté comparateur.
  openai: (m, onToken, onDone, onError, options) =>
    sendMessageStream(
      m as Parameters<typeof sendMessageStream>[0],
      getOpenAIKey(),
      onToken,
      onDone,
      onError,
      { ...(options as Parameters<typeof sendMessageStream>[5]), systemPrompt: COMPARATOR_SYSTEM_PROMPT },
    ),
}

export function ComparatorScreen({ onBack }: { onBack: () => void }) {
  return <SideBySideChat factories={factories} onBack={onBack} />
}
