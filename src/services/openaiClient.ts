import i18n from '../i18n'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { getTrialToken } from './emailTrialClient'
import { recordUsage } from './costTracker'
import { updateTrialFromResponse } from './trialClient'

// OpenAI client — deux chemins :
// 1. BYOK : si l'utilisateur a saisi sa clé (getOpenAIKey) → appel direct
//    à api.openai.com avec son Bearer. L'utilisateur paie ses propres appels.
// 2. Serveur : sinon → passe par /api/ai/openai-proxy qui utilise
//    env.OPENAI_API_KEY, gaté par ALLOWED_EMAILS côté Cloudflare.
// Pattern miroir de whisperClient.ts.

const OPENAI_DIRECT_URL = 'https://api.openai.com/v1/chat/completions'
// GPT-5.5 sorti le 23 avril 2026, -60% hallucinations vs GPT-5 (source
// OpenAI). Si OpenAI renvoie un 400 "model does not exist" sur un compte
// qui n'a pas encore accès, le fallback ci-dessous bascule sur gpt-5 (dont
// on sait qu'il fonctionne).
const DEFAULT_MODEL = 'gpt-5.5'
const FALLBACK_MODEL = 'gpt-5'
// Modèle utilisé pour valider une clé BYOK saisie dans la modale — dispo
// sur tous les comptes payants depuis 2024, évite les faux négatifs de
// test si l'utilisateur n'a pas encore accès à gpt-5 / gpt-5.5.
const TEST_MODEL = 'gpt-4o-mini'

const OPENAI_SYSTEM = `Tu es Arty, un assistant IA personnel.
Tu parles comme un pote compétent — direct, cash, pas de flatterie.
Tutoie l'utilisateur. Phrases courtes. Pas de "Excellente question !" ni de formules creuses.
Si l'utilisateur a tort, dis-le clairement. Sois cash mais respectueux.`

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenAIOptions {
  systemPrompt?: string
  model?: string
}

// ─── Error formatting ───

function formatError(status: number): Error {
  if (status === 401) return new Error(i18n.t('errors.openaiKeyInvalid'))
  if (status === 429) return new Error(i18n.t('errors.openaiRateLimit'))
  if (status >= 500) return new Error(i18n.t('errors.openaiServer'))
  return new Error(i18n.t('errors.openaiError', { status }))
}

// ─── Build request ───

function buildMessages(
  messages: OpenAIMessage[],
  systemPrompt: string
): OpenAIMessage[] {
  // Ensure a single system message at the top
  const withoutSystem = messages.filter((m) => m.role !== 'system')
  return [{ role: 'system', content: systemPrompt }, ...withoutSystem]
}

// Route : BYOK direct si clé présente, sinon proxy Cloudflare avec token Google
// pour vérification whitelist (pattern miroir de whisperClient).
async function resolveTarget(
  apiKey: string | null
): Promise<{ url: string; headers: Record<string, string> }> {
  if (apiKey) {
    return {
      url: OPENAI_DIRECT_URL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    }
  }
  const googleToken = await getValidAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (googleToken) {
    headers['x-google-token'] = googleToken
  } else {
    const trialToken = getTrialToken()
    if (trialToken) headers['x-arty-trial-token'] = trialToken
  }
  return { url: apiUrl('/api/ai/openai-proxy'), headers }
}

async function openaiFetch(
  apiKey: string | null,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  const { url, headers } = await resolveTarget(apiKey)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  updateTrialFromResponse(res)
  return res
}

// Certains comptes OpenAI n'ont pas encore accès à gpt-5.5 (gating par tier
// dans les premières semaines après release) — on retente une fois avec gpt-5
// si le 1er appel refuse le modèle, avant même que le stream ait commencé.
// Pattern miroir de whisperClient:71-83.
async function startChatRequest(
  apiKey: string | null,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  const response = await openaiFetch(apiKey, payload, signal)
  if (response.ok) return response
  if (payload.model !== DEFAULT_MODEL) return response
  if (response.status !== 400 && response.status !== 404) return response

  const errText = await response.clone().text().catch(() => '')
  if (!/model|not.?found|does.?not.?exist|unknown|invalid.*model/i.test(errText)) {
    return response
  }
  console.warn('[openai] DEFAULT_MODEL rejected, retrying with FALLBACK:', errText.slice(0, 120))
  return openaiFetch(apiKey, { ...payload, model: FALLBACK_MODEL }, signal)
}

// ─── Streaming ───

/**
 * Streaming message to OpenAI using SSE.
 * Returns an AbortController that can be used to cancel the request.
 * apiKey=null fait passer la requête par le proxy serveur Cloudflare.
 */
export function sendMessageStream(
  messages: OpenAIMessage[],
  apiKey: string | null,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  options?: OpenAIOptions
): AbortController {
  const controller = new AbortController()

  const run = async () => {
    try {
      const systemPrompt = options?.systemPrompt || OPENAI_SYSTEM
      const model = options?.model || DEFAULT_MODEL
      const payload = {
        model,
        messages: buildMessages(messages, systemPrompt),
        stream: true,
        // gpt-5 / o-series : "max_tokens" renommé en "max_completion_tokens".
        // max_completion_tokens fonctionne aussi sur gpt-4o donc pas de branchement.
        max_completion_tokens: 4096,
        // Note : on ne set pas "temperature". gpt-5 / o-series n'acceptent que
        // la valeur par défaut (1) — OpenAI renvoie 400 unsupported_value sur
        // n'importe quelle autre valeur. Laisser le default évite le branchement.
        // include_usage permet au proxy serveur de capturer prompt_tokens /
        // completion_tokens dans le dernier chunk SSE pour le tracking coût.
        stream_options: { include_usage: true },
      }

      const response = await startChatRequest(apiKey, payload, controller.signal)

      if (!response.ok) {
        // P0.7 — cap premium mensuel : code structuré surfacé tel quel (la
        // modale de choix l'intercepte), au lieu du « Trop de requêtes »
        // générique qui masquait totalement le cap.
        const errBody = await response.clone().text().catch(() => '')
        try {
          const parsed = JSON.parse(errBody) as { error?: string; bucket?: string; cap?: number }
          if (parsed?.error === 'premium_cap_reached') {
            const e = new Error('premium_cap_reached')
            Object.assign(e, { capBucket: parsed.bucket, capLimit: parsed.cap })
            throw e
          }
        } catch (e) {
          if ((e as Error).message === 'premium_cap_reached') throw e
        }
        throw formatError(response.status)
      }
      if (!response.body) throw new Error('OpenAI: réponse vide')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let promptTokens = 0
      let completionTokens = 0
      let usedModel = model

      // H-AI-2 — releaseLock en try/finally pour éviter le leak du reader
      // sur erreur (le body n'était jamais GC autrement).
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>
                usage?: { prompt_tokens?: number; completion_tokens?: number }
                model?: string
              }
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) onChunk(delta)
              // include_usage: true dans la requête → OpenAI envoie un dernier
              // chunk avec usage rempli. On capture aussi le model effectif au
              // cas où le proxy serveur ait fait un fallback transparent.
              if (parsed.usage) {
                promptTokens = parsed.usage.prompt_tokens || promptTokens
                completionTokens = parsed.usage.completion_tokens || completionTokens
              }
              if (parsed.model) usedModel = parsed.model
            } catch {
              // Skip malformed chunks
            }
          }
        }
      } finally {
        try { reader.releaseLock() } catch { /* already released */ }
      }

      try {
        recordUsage(usedModel, promptTokens, completionTokens)
      } catch {
        // Tracking ne doit pas casser la réponse
      }

      onDone()
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onDone()
        return
      }
      onError(err instanceof Error ? err : new Error('OpenAI streaming failed'))
    }
  }

  run()
  return controller
}

/**
 * Validate that an OpenAI key is accepted by the API. Toujours direct —
 * la validation porte sur la clé BYOK de l'utilisateur, jamais sur la clé
 * serveur. Utilise gpt-4o-mini (universellement disponible sur les comptes
 * payants) pour éviter les faux négatifs sur les comptes sans accès gpt-5.
 */
export async function testApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) return false
  try {
    const response = await fetch(OPENAI_DIRECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TEST_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        max_completion_tokens: 1,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}
