/**
 * ComparatorScreen — point d'entrée /compare.
 * Branche les vrais clients IA sur SideBySideChat. Lazy-loadé pour ne pas
 * tirer les clients dans le bundle initial.
 *
 * OpenAI a une signature différente (apiKey en 2e position) -> adaptée ici.
 * Les casts `Parameters<...>` réconcilient les types de messages/options
 * hétérogènes des 4 clients avec la signature uniforme du comparateur.
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
    streamMessage(m as Parameters<typeof streamMessage>[0], onToken, onDone, onError, options as Parameters<typeof streamMessage>[4], key),
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
