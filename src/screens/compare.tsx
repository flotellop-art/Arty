/**
 * ComparatorScreen — point d'entrée /compare.
 * Branche les vrais clients IA sur SideBySideChat. Lazy-loadé pour ne pas
 * tirer les clients dans le bundle initial.
 *
 * OpenAI a une signature différente (apiKey en 2e position) -> adaptée ici.
 * Les casts `Parameters<...>` réconcilient les types de messages/options
 * hétérogènes des 4 clients avec la signature uniforme du comparateur.
 *
 * IMPORTANT — Désactivation des tools côté Anthropic pour le comparateur :
 * `streamMessage` embarque par défaut tous les TOOLS d'Arty (web_search,
 * gmail_*, drive_*, calendar_*, computer_use, etc.). Sur des questions
 * factuelles type "audit ITE en France", Claude lance des web_search
 * serveur qui peuvent prendre 30-60s chacune → cumulées, ça atteint le
 * timeout du Worker (~120s) AVANT que Claude n'ait généré le moindre
 * token de texte → panneau qui finit "terminé" avec 0 out tokens visible.
 *
 * Le comparateur sert à juger la qualité des modèles, pas leurs tools —
 * on désactive donc tools côté Anthropic pour avoir une réponse texte
 * pure et streamée immédiatement. Les autres providers (Gemini/Mistral/
 * OpenAI) n'ont pas ce pattern de tools auto-embarqué.
 */

import { streamMessage } from '../services/anthropicClient'
import { streamGeminiMessage } from '../services/geminiClient'
import { streamMistralMessage } from '../services/mistralClient'
import { sendMessageStream } from '../services/openaiClient'
import { getOpenAIKey } from '../services/activeApiKey'
import { SideBySideChat } from '../components/comparator/SideBySideChat'
import type { StreamFactories } from '../services/comparator/useMultiProviderChat'

const factories: StreamFactories = {
  anthropic: (m, onToken, onDone, onError, options, key) =>
    streamMessage(
      m as Parameters<typeof streamMessage>[0],
      onToken,
      onDone,
      onError,
      { ...(options as Parameters<typeof streamMessage>[4]), tools: [] },
      key,
    ),
  gemini: (m, onToken, onDone, onError, options, key) =>
    streamGeminiMessage(m as Parameters<typeof streamGeminiMessage>[0], onToken, onDone, onError, options as Parameters<typeof streamGeminiMessage>[4], key),
  mistral: (m, onToken, onDone, onError, options, key) =>
    streamMistralMessage(m as Parameters<typeof streamMistralMessage>[0], onToken, onDone, onError, options as Parameters<typeof streamMistralMessage>[4], key),
  // OpenAI : clé en 2e position, pas d'apiKeyOverride côté comparateur.
  openai: (m, onToken, onDone, onError, options) =>
    sendMessageStream(m as Parameters<typeof sendMessageStream>[0], getOpenAIKey(), onToken, onDone, onError, options as Parameters<typeof sendMessageStream>[5]),
}

export function ComparatorScreen({ onBack }: { onBack: () => void }) {
  return <SideBySideChat factories={factories} onBack={onBack} />
}
