import { SYSTEM_PROMPT } from '../constants/systemPrompt'
import { TOOLS } from './toolDefinitions'
import { compressIfNeeded } from './conversationCompressor'
import { getAnthropicKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { buildAiHeaders } from './aiHttp'
import { resolveClaudeThinking, selectClaudeSubModel, PRIVATE_DATA_TRIGGERS, shouldUseWebSearch, type ClaudeThinkingDirective, type ClaudeSubModel } from './aiRouter'
import { isProActivated } from './proLicense'
import { dispatchModelUsed } from './modelLabels'
import type { ReflectionLevel } from './reflectionLevel'
import { buildLocationContext } from './locationContext'
import { recordUsage } from './costTracker'
import { updateTrialFromResponse } from './trialClient'
import i18n from '../i18n'

const ANTI_HALLU_PROMPT = `

Règles de vérité (prioritaires, non-négociables) :
- Si tu n'es pas sûr à 90%+ d'un fait, dis explicitement "je ne suis pas certain" ou utilise web_search pour vérifier.
- NE JAMAIS inventer une date, un chiffre, un nom propre, une citation ou une URL. Préfère "je ne sais pas" à un fait plausible non vérifié.
- Pour toute affirmation factuelle (prix, norme, date, stat), cite la source (URL ou "d'après X").
- En mode réflexion approfondie, ta longue chaîne de pensée ne remplace PAS la vérification. Elle DOIT aboutir soit à un fait sourcé, soit à un aveu d'incertitude.`

// Injecté dans le system prompt quand shouldUseWebSearch() retourne true.
// Force le modèle à toujours appeler web_search avant de répondre — y compris
// quand un fichier est attaché (analyse du fichier + recherche internet pour
// répondre à la question). Décliné en BUG 12 : désactivé pour les requêtes
// sur données privées (Gmail/Drive/Calendar/Contacts) où les tools natifs
// récupèrent les vraies données et web_search ne ferait qu'halluciner.
const FORCE_WEB_SEARCH_PROMPT = `

RECHERCHE WEB OBLIGATOIRE — non négociable :
Pour CE message utilisateur, tu DOIS appeler le tool \`web_search\` AVANT
de formuler ta réponse, même si tu penses connaître la réponse. La
recherche web prime sur ta mémoire d'entraînement (qui est forcément en
retard sur la date du jour).

- Reformule la question en 1-3 mots-clés pertinents pour le tool.
- Si un fichier est attaché, analyse-le ET fais une recherche web :
  la question peut nécessiter du contexte externe pour répondre
  (norme citée dans le PDF, prix marché à comparer, événement actuel, etc.).
- Si le tool retourne peu/pas de résultats, réessaie 1 fois avec une
  reformulation différente avant de répondre sans search.
- Cite les sources web utilisées (URL ou domaine) dans ta réponse.
- Ne dis JAMAIS "j'ai cherché" — c'est le tool qui cherche, pas toi.
  Formule : "selon les sources web", "d'après la recherche".`

// ── Types ────────────────────────────────────────────────────────────────────

type TextBlock = { type: 'text'; text: string }
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
type ThinkingBlock = { type: 'thinking'; thinking: string; signature: string }
type RedactedThinkingBlock = { type: 'redacted_thinking'; data: string }
// Server-side tools (web_search, web_fetch, code_execution) sont gérés
// par Anthropic en interne. Ils apparaissent dans la response stream et
// DOIVENT être renvoyés verbatim dans l'assistant turn suivant — sinon
// Anthropic détecte une "modification" et rejette avec 400 « thinking
// blocks cannot be modified » (BUG 52 variante : pas un thinking corrompu
// mais un index décalé parce qu'on droppait les blocs server tool).
type ServerToolUseBlock = { type: 'server_tool_use'; id: string; name: string; input: Record<string, unknown> }
type WebSearchResultBlock = { type: 'web_search_tool_result'; tool_use_id: string; content: unknown }
type WebFetchResultBlock = { type: 'web_fetch_tool_result'; tool_use_id: string; content: unknown }
type CodeExecResultBlock = { type: 'code_execution_tool_result'; tool_use_id: string; content: unknown }
export type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock | RedactedThinkingBlock | ServerToolUseBlock | WebSearchResultBlock | WebFetchResultBlock | CodeExecResultBlock

type ToolResultContent = string | Array<Record<string, unknown>>
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: ToolResultContent }

// Flexible message shape used in the multi-turn API loop
type ApiMessage = { role: string; content: string | ContentBlock[] | ToolResultBlock[] }

type SSEParseResult = {
  contentBlocks: ContentBlock[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export type ToolHandler = (
  name: string,
  input: Record<string, unknown>
) => Promise<{ result: string; screenshot?: string; fileData?: { name: string; mimeType: string; base64: string } }>

interface StreamOptions {
  systemPrompt?: string
  onToolCall?: ToolHandler
  // Restreint l'ensemble d'outils exposé au modèle (ex: brief proactif =
  // lecture seule). Par défaut tous les TOOLS sont disponibles. Retirer un
  // outil de cet ensemble est la SEULE garantie qu'il ne sera pas appelé —
  // un prompt "demande confirmation" est contournable par injection.
  tools?: typeof TOOLS
  // Force une déclinaison Claude précise (ex: Haiku pour un brief de fond,
  // pour ne pas consommer le quota premium Sonnet). Désactive aussi le
  // thinking auto : un appel à modèle imposé contrôle son propre coût.
  model?: ClaudeSubModel
  // Niveau de réflexion choisi par l'utilisateur (réglage global). Passé
  // UNIQUEMENT par les vrais appels de chat (useConversation) — jamais par le
  // comparateur / brief / résumé, qui imposent `model` et gardent leur coût
  // sous contrôle. Absent ⇒ 'auto' (heuristique par message, comportement
  // historique). Sans effet si le modèle résolu est Haiku (effort non supporté).
  reflectionLevel?: ReflectionLevel
}

// ── Public API ───────────────────────────────────────────────────────────────

export function streamMessage(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: StreamOptions,
  apiKeyOverride?: string
): AbortController {
  const controller = new AbortController()

  const apiKey = apiKeyOverride || getAnthropicKey()
  if (!apiKey) {
    setTimeout(() => onError(new Error(i18n.t('errors.apiKeyMissing'))), 0)
    return controller
  }

  runWithTools(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findLastUserText(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'user' && typeof m.content === 'string') return m.content
  }
  return ''
}

// ── Error formatting ─────────────────────────────────────────────────────────

function formatApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string | { type?: string; message?: string } }
    const err = parsed?.error

    // Our Cloudflare Functions return { error: 'string' } — surface it
    // directly so users see e.g. "Authentication required — please sign
    // in with Google" instead of the generic "Clé API invalide".
    if (typeof err === 'string' && err) {
      // Audit F-6 : le proxy masque les erreurs upstream server-key en
      // 'AI service error' générique (l'état de la clé owner ne doit pas
      // fuiter). Pour les transients connus, le status HTTP (préservé par
      // le proxy) permet de restaurer un message localisé.
      if (err === 'AI service error') {
        if (status === 529) return i18n.t('errors.apiOverloaded')
        if (status === 429) return i18n.t('errors.apiRateLimit')
      }
      return err
    }

    if (err && typeof err === 'object') {
      const errorType = err.type
      if (errorType === 'overloaded_error') return i18n.t('errors.apiOverloaded')
      if (errorType === 'rate_limit_error') return i18n.t('errors.apiRateLimit')
      // Surface the Anthropic message verbatim when available — "invalid
      // x-api-key", "your credit balance is too low", etc. — instead of the
      // opaque "Clé API invalide ou expirée". Only fall back to i18n when
      // the upstream gave us no message to show (pattern mirrored from the
      // Whisper error surfacing we shipped in 1.0.19).
      if (errorType === 'authentication_error') return err.message || i18n.t('errors.apiKeyInvalid')
      if (errorType === 'invalid_request_error') {
        return i18n.t('errors.apiInvalidRequest', { message: err.message || '?' })
      }
      if (err.message) return err.message
    }
  } catch {
    // Not JSON — fall through to status-based messages
  }

  switch (status) {
    case 401: return i18n.t('errors.apiKeyInvalid')
    case 403: return i18n.t('errors.apiAccessDenied')
    case 429: return i18n.t('errors.apiRateLimit')
    case 500: return i18n.t('errors.apiServer')
    case 529: return i18n.t('errors.apiOverloaded')
    default: return i18n.t('errors.apiConnection', { status })
  }
}

// ── HTTP fetch with exponential-backoff retry ─────────────────────────────────

async function fetchWithRetry(
  requestBody: string,
  apiKey: string | null,
  controller: AbortController
): Promise<Response> {
  const maxRetries = 3
  // `interleaved-thinking-2025-05-14` retiré : obsolète avec le thinking
  // adaptatif (GA sur Opus 4.8/4.7 et Sonnet 5). Le header n'est plus requis,
  // et BUG 18 interdit d'envoyer un header beta inutile.
  const betaHeaders = ['pdfs-2024-09-25', 'prompt-caching-2024-07-31']
  // C9 : trio Content-Type/BYOK(x-api-key, garde server-provided)/google-token
  // factorisé (aiHttp.buildAiHeaders).
  const headers = await buildAiHeaders({
    byokKey: apiKey,
    auth: 'x-api-key',
    extra: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': betaHeaders.join(','),
    },
  })

  let response: Response | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch(apiUrl('/api/ai/proxy'), {
      method: 'POST',
      headers,
      body: requestBody,
      signal: controller.signal,
    })

    const isRetryable = response.status === 429 || response.status === 529 || response.status >= 500
    if (response.ok || !isRetryable || attempt === maxRetries) break

    // P0.7 — le 429 `premium_cap_reached` est DÉFINITIF jusqu'au mois
    // prochain : retenter 3 fois (24 s de backoff) ne sert à rien et fige
    // l'UI. On le distingue du 429 rate-limit transient en lisant le body.
    if (response.status === 429) {
      const peek = await response.clone().text().catch(() => '')
      try {
        if ((JSON.parse(peek) as { error?: string })?.error === 'premium_cap_reached') break
      } catch { /* body non-JSON → rate limit upstream, retry normal */ }
    }

    // Exponential backoff: 2s, 4s, 8s
    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt + 1) * 1000))
  }

  // Met à jour le compteur trial local depuis le header x-trial-remaining.
  updateTrialFromResponse(response!)

  if (!response!.ok) {
    const body = await response!.text().catch(() => '')
    const error = new Error(formatApiError(response!.status, body))
    // Cap premium : attache bucket/cap pour que la modale de choix (P0.7)
    // affiche « 150/150 Sonnet utilisés » avec précision.
    try {
      const parsed = JSON.parse(body) as { error?: string; bucket?: string; cap?: number }
      if (parsed?.error === 'premium_cap_reached') {
        Object.assign(error, { capBucket: parsed.bucket, capLimit: parsed.cap })
      }
    } catch { /* body non-JSON */ }
    throw error
  }

  return response!
}

// ── SSE stream parser ─────────────────────────────────────────────────────────

async function parseSSEStream(
  response: Response,
  onToken: (text: string) => void
): Promise<SSEParseResult> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  const contentBlocks: ContentBlock[] = []
  let currentToolInput = ''
  let currentBlockType = ''
  let currentTextContent = ''
  let currentThinkingText = ''
  let currentThinkingSignature = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let buffer = ''
  let eventType = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        // LOW (audit étape 13) — reset eventType sur ligne vide. SSE spec :
        // chaque event est séparé par un blank line, et eventType devrait
        // se reset entre events. Sans ça, un data sans `event: ` aurait
        // attribué l'eventType de l'event précédent (en pratique l'API
        // Anthropic est bien formée donc pas vu, mais defense en profondeur).
        if (line === '') {
          eventType = ''
          continue
        }
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
          continue
        }
        if (!line.startsWith('data: ')) continue

        const jsonStr = line.slice(6)
        if (jsonStr === '[DONE]') continue

        let data: Record<string, unknown>
        try {
          data = JSON.parse(jsonStr) as Record<string, unknown>
        } catch {
          continue
        }

        switch (eventType) {
          case 'message_start': {
            const usage = (data.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined)?.usage
            if (usage) {
              inputTokens = usage.input_tokens || 0
              cacheReadTokens = usage.cache_read_input_tokens || 0
              cacheCreationTokens = usage.cache_creation_input_tokens || 0
            }
            break
          }
          case 'content_block_start': {
            const block = data.content_block as { type?: string; id?: string; name?: string; data?: string } | undefined
            if (block?.type === 'text') {
              currentBlockType = 'text'
              currentTextContent = ''
            } else if (block?.type === 'tool_use') {
              currentBlockType = 'tool_use'
              currentToolInput = ''
              contentBlocks.push({ type: 'tool_use', id: block.id || '', name: block.name || '', input: {} })
            } else if (block?.type === 'thinking') {
              // Extended thinking block — must be preserved in the conversation
              // history when the assistant makes tool calls (Anthropic API requirement).
              // We don't stream thinking content to the UI.
              currentBlockType = 'thinking'
              currentThinkingText = ''
              currentThinkingSignature = ''
            } else if (block?.type === 'redacted_thinking') {
              // Encrypted thinking returned by Anthropic — push as-is; must be
              // echoed back verbatim on the next turn.
              contentBlocks.push({ type: 'redacted_thinking', data: block.data || '' })
              currentBlockType = 'redacted_thinking'
            } else if (block?.type === 'server_tool_use') {
              // server_tool_use (web_search, web_fetch côté Anthropic).
              // L'input est typiquement streamé via input_json_delta comme
              // un tool_use classique → on push le bloc ici avec input
              // vide, on accumulera dans currentToolInput puis on
              // finalisera au content_block_stop.
              currentBlockType = 'server_tool_use'
              currentToolInput = ''
              contentBlocks.push({
                type: 'server_tool_use',
                id: block.id || '',
                name: block.name || '',
                input: {},
              } as ContentBlock)
            } else if (
              block?.type === 'web_search_tool_result' ||
              block?.type === 'web_fetch_tool_result' ||
              block?.type === 'code_execution_tool_result'
            ) {
              // Tool results côté Anthropic — viennent COMPLETS dans le
              // content_block_start (pas streamés). On push le bloc tel
              // quel pour qu'il soit renvoyé verbatim au tour suivant.
              currentBlockType = 'server_tool_result'
              contentBlocks.push(block as unknown as ContentBlock)
            }
            break
          }
          case 'content_block_delta': {
            const delta = data.delta as { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string } | undefined
            if (delta?.type === 'text_delta' && delta.text) {
              onToken(delta.text)
              currentTextContent += delta.text
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              currentToolInput += delta.partial_json
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              currentThinkingText += delta.thinking
            } else if (delta?.type === 'signature_delta' && delta.signature) {
              currentThinkingSignature += delta.signature
            }
            break
          }
          case 'content_block_stop':
            // Toujours pousser les blocs reçus, même vides — Anthropic conserve
            // tous les blocs de la réponse côté serveur. Si on en drop un, les
            // index décalent au tour suivant et l'API rejette avec
            // « thinking blocks cannot be modified ». La validation d'intégrité
            // (signature présente, etc.) est faite par assertContentBlocksValid
            // avant le resend dans la boucle tool-use.
            if (currentBlockType === 'text') {
              contentBlocks.push({ type: 'text', text: currentTextContent })
            } else if (currentBlockType === 'tool_use' && currentToolInput) {
              const lastTool = contentBlocks[contentBlocks.length - 1]
              if (lastTool?.type === 'tool_use') {
                try {
                  lastTool.input = JSON.parse(currentToolInput) as Record<string, unknown>
                } catch {
                  lastTool.input = {}
                }
              }
            } else if (currentBlockType === 'server_tool_use' && currentToolInput) {
              // Finalise l'input du dernier server_tool_use poussé au start.
              const last = contentBlocks[contentBlocks.length - 1] as { type?: string; input?: unknown } | undefined
              if (last?.type === 'server_tool_use') {
                try {
                  ;(last as { input: unknown }).input = JSON.parse(currentToolInput)
                } catch {
                  ;(last as { input: unknown }).input = {}
                }
              }
            } else if (currentBlockType === 'thinking') {
              contentBlocks.push({
                type: 'thinking',
                thinking: currentThinkingText,
                signature: currentThinkingSignature,
              })
            }
            currentBlockType = ''
            break

          case 'message_delta': {
            const usage = (data as { usage?: { output_tokens?: number } }).usage
            if (usage) outputTokens = usage.output_tokens || 0
            break
          }
          case 'error': {
            // Erreurs en milieu de stream (l'API a accepté la requête HTTP
            // mais Anthropic rencontre un problème pendant la génération :
            // surcharge, rate limit, etc.). On passe par formatApiError
            // pour traduire les types connus (overloaded_error,
            // rate_limit_error...) en messages utilisateur clairs. Sans
            // ça, le user voit "Overloaded" brut au lieu du message i18n.
            const err = (data as { error?: { type?: string; message?: string } }).error
            const errorBody = JSON.stringify({ error: err })
            throw new Error(formatApiError(529, errorBody))
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { contentBlocks, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
}

// ── Content blocks validation ────────────────────────────────────────────────

// Anthropic rejette le resend si un bloc thinking arrive sans signature ou si
// un bloc redacted_thinking a un data vide. Plutôt que laisser le 400 fuir
// dans l'UI, on lève une erreur claire qui sera transformée en message
// utilisateur via formatApiError → onError.
function assertContentBlocksValid(blocks: ContentBlock[]): void {
  for (const b of blocks) {
    if (b.type === 'thinking' && !b.signature) {
      throw new Error(i18n.t('errors.responseIncomplete'))
    }
    if (b.type === 'redacted_thinking' && !b.data) {
      throw new Error(i18n.t('errors.responseIncomplete'))
    }
  }
}

// ── Tool execution ────────────────────────────────────────────────────────────

// P0.9 — bornes économiques de la boucle d'outils. Les tool_results (texte +
// base64 des documents) s'accumulent dans apiMessages et sont RENVOYÉS à
// l'API à chaque itération de la boucle (jusqu'à 30) : sans budget, un seul
// message peut coûter plusieurs dollars (leçon T3 Chat).
// - MAX_TOOL_FILE_BASE64_CHARS : ~8 MB binaire (défense en profondeur — les
//   proxys Gmail/Drive cappent déjà à 8 MB côté serveur).
// - TOOL_CONTEXT_BUDGET_CHARS : ~150 K tokens de tool_results cumulés par
//   message. Au-delà, on n'exécute plus les tools : le modèle est invité à
//   synthétiser avec ce qu'il a déjà lu (transparent, jamais silencieux).
const MAX_TOOL_FILE_BASE64_CHARS = 11_000_000
const TOOL_CONTEXT_BUDGET_CHARS = 600_000

function toolResultSize(results: ToolResultBlock[]): number {
  let total = 0
  for (const r of results) {
    if (typeof r.content === 'string') {
      total += r.content.length
    } else if (Array.isArray(r.content)) {
      for (const block of r.content as Array<Record<string, unknown>>) {
        if (typeof block.text === 'string') total += block.text.length
        const source = block.source as { data?: string } | undefined
        if (typeof source?.data === 'string') total += source.data.length
      }
    }
  }
  return total
}

async function executeToolCalls(
  contentBlocks: ContentBlock[],
  onToolCall: ToolHandler
): Promise<ToolResultBlock[]> {
  const toolResults: ToolResultBlock[] = []

  for (const block of contentBlocks) {
    if (block.type !== 'tool_use') continue

    const toolResult = await onToolCall(block.name, block.input)

    if (toolResult.fileData) {
      // P0.9 — garde taille : un document trop gros ferait exploser le coût
      // de chaque itération suivante (1 char base64 ≈ 1/3 token). Résultat
      // explicite pour que le modèle s'adapte (page précise, extrait…).
      if (toolResult.fileData.base64.length > MAX_TOOL_FILE_BASE64_CHARS) {
        const sizeMb = Math.round((toolResult.fileData.base64.length * 0.75) / 1024 / 1024)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Fichier trop volumineux pour être injecté dans la conversation (~${sizeMb} MB, max 8 MB). Demande à l'utilisateur un extrait, une version allégée ou une page précise.`,
        })
        continue
      }
      // Tool returned a file — send it as a native document/image block
      const fileBlocks: Array<Record<string, unknown>> = [{ type: 'text', text: toolResult.result }]
      const mime = toolResult.fileData.mimeType
      if (mime === 'application/pdf') {
        fileBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: toolResult.fileData.base64 },
        })
      } else if (mime?.startsWith('image/')) {
        fileBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mime, data: toolResult.fileData.base64 },
        })
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: fileBlocks })
    } else {
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: toolResult.result })
    }
  }

  return toolResults
}

// ── Prompt caching de l'historique ────────────────────────────────────────────

// Pose un breakpoint de cache (`cache_control: ephemeral`) sur le dernier bloc
// du dernier message. Effet : le préfixe accumulé (système + outils + tout
// l'historique) est relu depuis le cache Anthropic (~0,1× du tarif input) au
// lieu d'être renvoyé plein tarif. Sans ça, seuls système+outils étaient cachés
// (lignes systemBlocks/cachedTools) ; tout l'historique de conversation ET la
// boucle d'outils repartaient à chaque fois en input neuf.
//
// À appeler à CHAQUE itération de la boucle d'outils (pas une fois par tour
// utilisateur) : le lookback de cache remonte au plus 20 blocs pour retrouver
// l'entrée précédente, or une chaîne d'outils longue (thinking + N tool_use +
// N tool_result) dépasse vite 20 blocs entre deux tours → cache miss silencieux
// + réécriture (1,25×) = optim négative. Re-poser le marqueur par itération
// garde la distance < 20 blocs.
//
// Idempotent : retire tout marqueur de message déjà posé avant d'en poser un
// nouveau. Sinon on empile les breakpoints au fil de la boucle et on dépasse la
// limite API de 4 (système + dernier outil + ce marqueur = 3). On ne balaye que
// les messages `user` : un marqueur n'est jamais posé ailleurs, et toucher un
// message `assistant` (blocs thinking à signature intègre) risquerait le 400
// « thinking blocks cannot be modified » (BUG 52).
function markLastBlockForCaching(messages: ApiMessage[]): void {
  for (const m of messages) {
    if (m.role === 'assistant' || typeof m.content === 'string') continue
    for (const block of m.content as unknown as Array<Record<string, unknown>>) {
      if (block && 'cache_control' in block) delete block.cache_control
    }
  }

  const last = messages[messages.length - 1]
  // Garde BUG 52 : ne jamais réécrire un message assistant. En pratique le
  // dernier message est toujours un `user` (question d'origine ou tool_results).
  if (!last || last.role === 'assistant') return

  if (typeof last.content === 'string') {
    // user à contenu string → on le transforme en un bloc text porteur du
    // marqueur (cache_control va sur un bloc, pas sur une string brute).
    last.content = [
      { type: 'text', text: last.content, cache_control: { type: 'ephemeral' } },
    ] as unknown as ContentBlock[]
  } else {
    const blocks = last.content as unknown as Array<Record<string, unknown>>
    const lastBlock = blocks[blocks.length - 1]
    // tool_result (ou text) : le cache_control va sur l'OBJET bloc lui-même,
    // jamais en transformant son `content`.
    if (lastBlock) lastBlock.cache_control = { type: 'ephemeral' }
  }
}

// ── Main streaming loop with tool use ────────────────────────────────────────

async function runWithTools(
  apiKey: string,
  originalMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options: StreamOptions | undefined,
  controller: AbortController
) {
  try {
    const compressed = await compressIfNeeded(
      originalMessages.map((m) => ({ role: m.role, content: m.content })),
      options?.systemPrompt,
      apiKey
    )

    const apiMessages: ApiMessage[] = compressed as ApiMessage[]

    const lastUserText = findLastUserText(originalMessages)
    const isPrivateData = PRIVATE_DATA_TRIGGERS.some((r) => r.test(lastUserText))
    const isPro = isProActivated()
    // Réflexion (thinking étendu) :
    //  - Appel à modèle imposé (brief proactif, comparateur, résumé) → coupée :
    //    ces appels contrôlent leur propre coût et ne doivent JAMAIS hériter du
    //    réglage global de l'utilisateur (sinon le comparateur comparerait un
    //    Claude « dopé » au lieu du comportement par défaut).
    //  - Chat réel → niveau passé explicitement via options.reflectionLevel
    //    (depuis useConversation). Absent ⇒ 'auto' = heuristique par message.
    const thinking: ClaudeThinkingDirective = options?.model
      ? { enabled: false, budget: 0, effort: null }
      : resolveClaudeThinking(lastUserText, options?.reflectionLevel ?? 'auto', isPro)
    const ANTHROPIC_MODEL = options?.model || selectClaudeSubModel(lastUserText, thinking, isPrivateData, isPro)
    // Garde-fou Haiku : effort/adaptive thinking renvoient 400 sur Haiku 4.5.
    // selectClaudeSubModel ne renvoie Haiku QUE si thinking.enabled est false
    // (message trivial) OU si le plan est free (verrouillé Haiku). Dans le 1er
    // cas effort est déjà null ; le garde couvre le seul cas résiduel (un user
    // free qui a réglé « Approfondi/Max ») → réflexion ignorée silencieusement.
    const isHaiku = ANTHROPIC_MODEL.includes('haiku')
    const effortActive = thinking.enabled && !isHaiku
    const effort = effortActive ? thinking.effort : null
    // Notifie l'UI du modèle exact appelé (ChatTopBar) + si la réflexion est
    // active (StreamingIndicator affiche « réflexion approfondie »).
    dispatchModelUsed({ model: ANTHROPIC_MODEL, provider: 'claude', reflecting: effortActive })
    const locationContext = await buildLocationContext(lastUserText)

    const baseSystemText = options?.systemPrompt || SYSTEM_PROMPT
    // ANTI_HALLU parle de « ta longue chaîne de pensée » → ne l'ajouter que
    // quand la réflexion est réellement active (pas sur Haiku, où effort est off).
    const withThinking = effortActive ? baseSystemText + ANTI_HALLU_PROMPT : baseSystemText
    // Force web_search sur toute requête non-privée et non-triviale (règle
    // user du 10 mai 2026). Les requêtes "mes mails / mon Drive / agenda"
    // sont exclues car les tools natifs Gmail/Drive/Calendar récupèrent les
    // vraies données — web_search ne ferait qu'halluciner (cf. BUG 12).
    // Pas de forçage web_search sur un appel à modèle imposé (ex: brief
    // proactif) : son jeu d'outils est restreint et n'inclut pas web_search,
    // donc pousser le modèle à l'appeler n'aurait aucun sens.
    const webSearchHint = (!options?.model && shouldUseWebSearch(lastUserText)) ? FORCE_WEB_SEARCH_PROMPT : ''
    const systemText = withThinking + locationContext + webSearchHint
    const systemBlocks = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    // Add prompt-caching hint to last tool definition. L'ensemble d'outils
    // peut être restreint via options.tools (brief proactif = lecture seule).
    const toolSet = options?.tools ?? TOOLS
    const cachedTools = toolSet.map((t, i) =>
      i === toolSet.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
    )

    // H-AI-3 (audit étape 4) — Mistral est à 20 itérations max. 200 ici était
    // trop permissif : un bug dans un tool (boucle d'appels) pouvait consommer
    // des dizaines de $ silencieusement. 30 reste large pour des chaînes de
    // tool calls complexes (read_email → analyze → search → write_doc).
    let maxIterations = 30
    // P0.9 — cumul des chars de tool_results de CE message (texte + base64).
    let toolContextChars = 0
    while (maxIterations-- > 0) {
      // Haiku max output = 64000 tokens (API limit). Cap unconditionally.
      const maxTokens = isHaiku ? 64000 : 65536
      // Cache de l'historique : (re)pose le marqueur sur le dernier bloc à
      // CHAQUE itération (cf. lookback 20 blocs dans markLastBlockForCaching).
      markLastBlockForCaching(apiMessages)
      const requestBody = JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        // temperature/top_p/top_k ont été RETIRÉS de l'API de réflexion
        // moderne : les envoyer à Opus 4.8/4.7 (et Sonnet 5) renvoie 400.
        // On ne les garde que pour Haiku, qui n'a pas de réflexion et accepte
        // encore le sampling (modèle du plan free — comportement inchangé).
        ...(isHaiku && { temperature: 0.7 }),
        stream: true,
        system: systemBlocks,
        // N'inclus le champ `tools` que s'il est non-vide. La doc Anthropic
        // attend un array non-vide OU pas de champ. Envoyer `tools: []` est
        // toléré mais peut combiner avec un SYSTEM_PROMPT orienté tools pour
        // produire des réponses vides (Claude "refuse" parce que le SP lui
        // dit d'appeler web_search/gmail/drive qu'on ne lui fournit pas).
        // Cas d'usage légitime de tools=[] : le comparateur de modèles.
        ...(cachedTools.length > 0 && { tools: cachedTools }),
        messages: apiMessages,
        // Réflexion moderne : thinking adaptatif + niveau d'effort. Remplace
        // l'ancien thinking:{type:'enabled', budget_tokens} (déprécié → 400 sur
        // Opus 4.8/4.7). Jamais sur Haiku (effort non supporté → 400, garde
        // effortActive). budget_tokens n'est plus envoyé du tout.
        ...(effortActive && { thinking: { type: 'adaptive' } }),
        ...(effort && { output_config: { effort } }),
      })

      const response = await fetchWithRetry(requestBody, apiKey, controller)
      const { contentBlocks, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = await parseSSEStream(response, onToken)

      // Track cost. Anthropic facture les "cache_creation_input_tokens" comme
      // de l'input standard (en réalité ~1,25× — on garde 1× = légère
      // sous-estimation bornée) et les "cache_read_input_tokens" à ~0,1× du
      // tarif input. Depuis qu'on cache l'historique (markLastBlockForCaching),
      // les lectures de cache deviennent volumineuses : les compter plein tarif
      // ferait paraître l'optimisation PLUS chère qu'avant (faux signal vers
      // l'écran Coûts / CostIndicator, cf. BUG 54). On pondère donc les reads
      // à 0,1× pour rester proche du coût réel facturé.
      try {
        recordUsage(
          ANTHROPIC_MODEL,
          inputTokens + cacheCreationTokens + Math.ceil(cacheReadTokens * 0.1),
          outputTokens
        )
      } catch {
        // Le tracking ne doit jamais casser le flux de réponse.
      }

      // Dev only : vérifier que le cache mord réellement. Si cacheReadTokens
      // reste à 0 sur des tours répétés, c'est un lookup raté (>20 blocs) ou un
      // invalidateur silencieux du préfixe — pas l'optim qui marche.
      if (import.meta.env.DEV) {
        console.log(
          `[anthropic cache] read=${cacheReadTokens} creation=${cacheCreationTokens} fresh=${inputTokens}`
        )
      }

      const hasToolUse = contentBlocks.some((b) => b.type === 'tool_use')
      if (!hasToolUse || !options?.onToolCall) {
        onDone()
        return
      }

      // Avant de renvoyer l'assistant turn à Anthropic pour exécuter les tools,
      // s'assurer que chaque bloc est intègre (signature thinking présente,
      // data redacted_thinking non vide). Si non, on abort la boucle proprement.
      assertContentBlocksValid(contentBlocks)

      // P0.9 — budget de contexte par message. Une fois le budget consommé,
      // on n'exécute PLUS les tools : chaque tool_use reçoit un résultat
      // explicite demandant la synthèse. Le modèle conclut au lieu de
      // continuer à accumuler (et l'utilisateur n'est jamais bloqué en
      // silence — cohérent P0.7).
      let toolResults: ToolResultBlock[]
      if (toolContextChars >= TOOL_CONTEXT_BUDGET_CHARS) {
        toolResults = contentBlocks
          .filter((b): b is ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({
            type: 'tool_result' as const,
            tool_use_id: b.id,
            content:
              'Budget de contexte de ce message atteint — n\'appelle plus d\'outils. Synthétise ta réponse avec les données déjà lues, et propose à l\'utilisateur de continuer dans un message suivant si besoin.',
          }))
      } else {
        toolResults = await executeToolCalls(contentBlocks, options.onToolCall)
        toolContextChars += toolResultSize(toolResults)
      }
      apiMessages.push({ role: 'assistant', content: contentBlocks })
      apiMessages.push({ role: 'user', content: toolResults })
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err)
    }
  }
}
