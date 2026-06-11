import { getMistralKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { TOOLS } from './toolDefinitions'
import { convertToolsToOpenAI } from './tools/openaiFormat'
import { buildLocationContext } from './locationContext'
import { recordUsage } from './costTracker'
import { dispatchModelUsed } from './modelLabels'
import { setSearchContext } from './factChecker'
import { shouldUseWebSearch } from './aiRouter'
import { updateTrialFromResponse } from './trialClient'
import i18n from '../i18n'

/**
 * Sélection du modèle Mistral. Depuis mai 2026, Mistral Small est déprécié
 * et tout le trafic Mistral passe par Medium 3.5 — meilleure qualité, vision
 * native, fact-check plus fiable. Mistral n'est plus accessible aux free
 * users (Medium trop coûteux pour le tier gratuit), le proxy renvoie un
 * 403 model_locked dans ce cas.
 *
 * Signature conservée (prend `message`) pour compat avec les appelants
 * existants — l'argument est ignoré.
 */
export function selectMistralModel(_message: string): 'mistral-medium-latest' {
  return 'mistral-medium-latest'
}

const MISTRAL_SYSTEM = `Tu es Arty, un assistant IA personnel.
Tu parles comme un pote compétent — direct, cash, pas de flatterie.
Tutoie l'utilisateur. Phrases courtes. Pas de "Excellente question !" ni de formules creuses.
Si l'utilisateur a tort, dis-le clairement. Sois cash mais respectueux.
Adapte ton vocabulaire au métier de l'utilisateur si tu le connais.`

// Règles SPÉCIFIQUES Mistral — TOUJOURS appendées au prompt, y compris quand
// l'app fournit son prompt contextuel (audit Mistral 11 juin 2026 : avant,
// ces règles ne s'appliquaient QUE dans le comparateur — en chat réel,
// Mistral recevait le prompt générique écrit pour Claude, qui mentionne
// web_fetch (outil qu'il n'a PAS) → c'était la porte ouverte aux
// hallucinations d'URLs que PR #162 croyait avoir fermée).
const MISTRAL_RULES = `

CONTEXTE MISTRAL — ces règles PRIMENT sur toute instruction précédente :
Tu tournes sur Mistral (mode Europe). Tu n'as PAS l'outil web_fetch.
Ignore toute instruction précédente mentionnant web_fetch ou la lecture
directe d'URLs — elle ne s'applique pas à toi.

RÈGLE TEMPS RÉEL — non négociable :
Pour TOUTE question portant sur des données qui changent dans le temps
(actualité, sport, score, météo, prix, cours de bourse, événements en
cours, sorties produits, données 2025+), tu DOIS appeler le tool
web_search AVANT de répondre. Ne devine JAMAIS un score, une date, un
prix, un résultat. Si tu n'as pas appelé web_search alors que la
question le justifie, ta réponse est interdite. Quand le tool renvoie
une réponse vérifiée, reprends-la TELLE QUELLE et cite les sources via
[1], [2], etc. Ne mélange JAMAIS plusieurs sources dans une même
phrase sans le préciser.

RÈGLE NARRATIVE — interdiction absolue :
N'écris JAMAIS "j'ai cherché", "j'ai vérifié", "j'ai consulté",
"j'ai contacté", "j'ai fait une recherche directe sur tel site". C'est
le tool web_search qui fait la recherche, pas toi. Tu reçois juste les
résultats. Formule plutôt : "selon les sources web", "d'après la
recherche", "le tool de recherche n'a pas trouvé X chez Y", "aucun prix
publié sur tel site". Ne te prête PAS d'actions que tu n'as pas faites
— ce sont des mensonges narratifs détectés par le fact-checker.

RÈGLE URLs / VIDÉOS — interdiction absolue :
Tu n'as PAS accès au contenu des URLs ni des vidéos YouTube/autres.
Le tool web_search te renvoie des SNIPPETS d'index, pas le contenu
réel d'une page. Tu ne peux donc PAS lire un article, une vidéo,
un PDF en ligne ou un post de blog à partir de son lien.
Si l'utilisateur colle un lien (http://, https://, youtu.be, etc.)
et te demande un résumé, une analyse ou une citation :
1. DIS franchement que tu ne peux pas ouvrir le lien
2. PROPOSE : "Colle-moi le texte/extrait de l'article ici" ou
   "Switche sur Claude (mode auto) qui peut lire les URLs"
3. NE JAMAIS inventer le contenu, les citations, les chiffres, les
   sources numérotées [1][2][3] d'un article que tu n'as pas lu.
Tu peux te baser sur le TITRE de l'URL si visible, mais tu DOIS dire
explicitement "je n'ai que le titre, pas le contenu".
Fabriquer du contenu d'article est le pire mensonge — c'est détecté
et signalé à l'utilisateur.
EXCEPTION : si le message contient un bloc « CONTENU DE LA PAGE (url) »
ou « CONTENU DU PDF (url) », ce contenu a été récupéré POUR TOI (via
Linkup, hébergé en Europe). Utilise-le comme source fiable, cite l'URL,
et ne dis PAS que tu ne peux pas lire le lien — tu as son contenu.

RÈGLE INCERTITUDE :
Si tu n'es pas certain d'une information et qu'aucun résultat web ne la
confirme, dis-le explicitement — « Je ne suis pas certain, à vérifier » —
au lieu de présenter une estimation comme un fait. Une incertitude
assumée vaut toujours mieux qu'une réponse fausse donnée avec aplomb.`

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>

interface MistralStreamOptions {
  systemPrompt?: string
  onToolCall?: ToolHandler
  // Force un modèle précis (utilisé par le comparateur multi-modèles).
  // Si absent, fallback sur selectMistralModel (défaut Arty : medium).
  model?: string
  // Fix 429 (11 juin 2026) — true quand useConversation a déjà inliné le
  // contenu d'URL/PDF (lot C) dans le dernier message : la recherche web
  // forcée (lot D) serait alors contre-productive — un appel Mistral
  // supplémentaire inutile, dos à dos avec la synthèse, qui tapait le
  // rate limit upstream de la clé serveur.
  urlContentInlined?: boolean
}

// Décision « forcer web_search au 1er tour » — pure et exportée pour test.
// Forcer N'A PAS de sens quand le contenu d'URL est déjà dans le contexte :
// le résumé d'un article inliné ne nécessite aucune recherche.
export function shouldForceSearch(
  lastUserText: string,
  hasToolHandler: boolean,
  urlContentInlined: boolean
): boolean {
  return hasToolHandler && !urlContentInlined && shouldUseWebSearch(lastUserText)
}

// Mistral content blocks pour le multimodal (image_url + text). Format
// OpenAI-compatible — Medium 3.5 a une vision native, donc l'image est
// passée directement avec un data URL base64. Pas de support PDF natif
// chez Mistral à ce jour : les PDFs sont convertis en texte côté
// useFileAttachments avant d'arriver ici.
export type MistralContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type MistralMessageContent = string | MistralContentBlock[]

export function streamMistralMessage(
  messages: Array<{ role: string; content: MistralMessageContent }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: MistralStreamOptions,
  apiKeyOverride?: string
): AbortController {
  const controller = new AbortController()

  const apiKey = apiKeyOverride || getMistralKey()

  runMistralStream(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

// OpenAI-format message types for the tool loop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiMessage = { role: string; content?: MistralMessageContent | null; tool_calls?: any[]; tool_call_id?: string; name?: string }

interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

// Appelle le proxy /api/search/web pour exécuter une recherche web depuis
// Mistral. Le proxy route vers Linkup (par défaut) ou Brave selon la
// variable env SEARCH_PROVIDER côté Cloudflare. Retourne un texte formaté
// que Mistral injecte dans son prochain message comme contexte.
// Bornes d'injection des résultats de recherche dans le contexte Mistral.
// Sans cap, une sourcedAnswer Linkup de plusieurs kB entrait entière à
// chaque tour → contexte qui enfle → le modèle « comble » par extrapolation
// sur les conversations longues (audit Mistral 11 juin 2026, cause n°3a).
const MAX_ANSWER_CHARS = 2000
const MAX_SNIPPET_CHARS = 600

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + ' […]' : text
}

async function executeMistralWebSearch(args: Record<string, unknown>): Promise<{ result: string }> {
  const query = String(args.query || '').trim()
  if (!query) return { result: 'Erreur: paramètre `query` manquant.' }
  // Défaut 5 → 8 : sur les requêtes type rapport/comparatif, 5 snippets ne
  // suffisaient pas face au corpus Gemini/Claude (audit, cause n°2a).
  const maxResults = typeof args.maxResults === 'number' ? Math.min(10, Math.max(1, args.maxResults)) : 8
  const sources = Array.isArray(args.sources)
    ? (args.sources as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 6)
    : undefined

  const googleToken = await getValidAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Le proxy /api/search/web authentifie via x-google-token (checkAllowedUser).
  // PAS d'Authorization ici : ce header n'est pas une clé Mistral, juste le
  // token Google — l'envoyer en double était redondant et trompeur.
  if (googleToken) headers['x-google-token'] = googleToken

  // CRIT-5 — Timeout 30s sur web_search pour éviter les blocages
  // sur cold-start Cloudflare ou réseau flaky.
  const searchCtrl = new AbortController()
  const searchTimeoutId = setTimeout(() => searchCtrl.abort(new DOMException('Timeout', 'AbortError')), 30_000)
  let response: Response
  try {
    response = await fetch(apiUrl('/api/search/web'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, maxResults, ...(sources ? { sources } : {}) }),
      signal: searchCtrl.signal,
    })
  } catch (err) {
    return { result: `Erreur réseau de recherche : ${err instanceof Error ? err.message : 'inconnue'}` }
  } finally {
    clearTimeout(searchTimeoutId)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return { result: `Recherche échouée (${response.status}) : ${body.slice(0, 200)}` }
  }

  const data = (await response.json()) as
    | {
        provider: string
        answer?: string
        results: Array<{ title: string; url: string; snippet: string }>
      }
    | {
        provider: string
        bySource: Record<string, { answer?: string; results: Array<{ title: string; url: string; snippet: string }> }>
      }

  // Notifie l'UI du provider qui a répondu (Linkup ou Brave).
  try {
    window.dispatchEvent(new CustomEvent('arty-search-used', { detail: { provider: data.provider } }))
  } catch {}

  // Capture le contexte de recherche pour que le fact-checker puisse
  // VRAIMENT vérifier les claims contre les sources (v2 du fact-checker).
  // Sans ça, Haiku/Sonnet ne peuvent que se reposer sur leur cutoff de
  // connaissance — incapables de valider les claims actualité.
  if ('bySource' in data) {
    setSearchContext({
      provider: data.provider,
      query,
      bySource: data.bySource,
    })
  } else {
    setSearchContext({
      provider: data.provider,
      query,
      answer: data.answer,
      results: data.results,
    })
  }

  // Multi-source response (Option A) : retour structuré par source avec
  // attribution garantie. On formate de façon à ce que Mistral voie clairement
  // "voici ce qu'il y a chez X / chez Y / chez Z" sans risque de mélanger.
  if ('bySource' in data) {
    const sections: string[] = []
    for (const [source, entry] of Object.entries(data.bySource)) {
      if (entry.answer) {
        sections.push(`### Chez ${source}\n${clip(entry.answer, MAX_ANSWER_CHARS)}`)
      } else if (entry.results.length > 0) {
        const refs = entry.results
          .map((r) => `- ${r.title}\n  ${clip(r.snippet, MAX_SNIPPET_CHARS)}\n  Source: ${r.url}`)
          .join('\n')
        sections.push(`### Chez ${source}\n${refs}`)
      } else {
        sections.push(`### Chez ${source}\nAucun résultat pertinent.`)
      }
    }
    return {
      result:
        `Recherche multi-source (${data.provider}) pour "${query}" :\n\n${sections.join('\n\n')}\n\n` +
        `IMPORTANT : chaque section ci-dessus correspond À UNE SOURCE PRÉCISE. NE MÉLANGE JAMAIS les données entre sources. Si une source dit X et une autre Y, mentionne les deux. Cite via [Brico Dépôt: prix X], [Cedeo: prix Y], etc.`,
    }
  }

  // Single-source — Linkup `sourcedAnswer` ou Brave snippets bruts.
  const sourcesBlock = data.results && data.results.length > 0
    ? '\n\nSources:\n' + data.results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}`).join('\n')
    : ''

  if (data.answer) {
    return {
      result:
        `Réponse vérifiée (${data.provider}) à "${query}" :\n\n${clip(data.answer, MAX_ANSWER_CHARS)}\n\n` +
        `IMPORTANT : reprends ces données telles quelles, ne devine pas, cite les sources via [1], [2], etc.${sourcesBlock}`,
    }
  }

  if (!data.results || data.results.length === 0) {
    return { result: `Aucun résultat trouvé pour "${query}".` }
  }
  const formatted = data.results
    .map((r, i) => `[${i + 1}] **${r.title}**\n${clip(r.snippet, MAX_SNIPPET_CHARS)}\nSource: ${r.url}`)
    .join('\n\n')
  return {
    result:
      `Résultats de recherche (${data.provider}) pour "${query}" :\n\n${formatted}\n\n` +
      `IMPORTANT : ne devine pas, ne mélange pas les sources, cite via [1], [2], etc.`,
  }
}

async function runMistralStream(
  apiKey: string | null,
  originalMessages: Array<{ role: string; content: MistralMessageContent }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options: MistralStreamOptions | undefined,
  controller: AbortController
) {
  try {
    const basePrompt = options?.systemPrompt || MISTRAL_SYSTEM
    // Récupère le texte du dernier message user pour le routing (location,
    // sélection du modèle). Si le contenu est multimodal (array), on extrait
    // les blocs text uniquement.
    const lastUserMsg = [...originalMessages].reverse().find(m => m.role === 'user')
    const lastUserText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : (lastUserMsg?.content || []).filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join(' ')
    const locationContext = await buildLocationContext(lastUserText)
    // Force web_search systématique sauf données privées/triviales (règle
    // user du 10 mai 2026). La RÈGLE TEMPS RÉEL du prompt de base est
    // conditionnelle ("pour TOUTE question portant sur des données qui
    // changent"), donc on durcit en injectant une consigne sans condition
    // sur les requêtes éligibles.
    // ATTENTION : pas de forceWebHint si `options.onToolCall` est absent
    // (ex: comparateur de modèles) — pousser Mistral à appeler web_search
    // alors qu'on n'a pas de handler pour l'exécuter résulte en un panneau
    // vide (toolCalls détectés → onDone direct sans streamer de texte).
    // Symétrique du fix Anthropic dans le wiring du comparateur (compare.tsx).
    const forceWebHint = shouldForceSearch(lastUserText, !!options?.onToolCall, !!options?.urlContentInlined)
      ? `\n\nRECHERCHE WEB OBLIGATOIRE — non négociable :\nPour CE message utilisateur, tu DOIS appeler le tool web_search AVANT de répondre, même si tu penses connaître la réponse. La recherche web prime sur ta mémoire d'entraînement. Si un fichier est attaché, analyse-le ET fais une recherche web. Cite les sources via [1], [2]. Ne dis JAMAIS "j'ai cherché" — c'est le tool qui cherche.`
      : ''
    // Date du jour — sans elle, Mistral ne sait pas se situer par rapport à
    // son cutoff d'entraînement → erreurs systématiques sur tout le récent
    // (audit Mistral 11 juin 2026, cause n°1). Claude reçoit son contexte
    // par ailleurs ; ici on l'injecte côté client à chaque appel.
    const dateLine = `\n\nDate du jour : ${new Date().toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })}.`
    // MISTRAL_RULES TOUJOURS appendées (même avec le prompt contextuel app —
    // voir commentaire de la constante). Les règles déclarent primer sur les
    // instructions précédentes pour neutraliser les mentions web_fetch du
    // prompt générique.
    const systemPrompt = basePrompt + MISTRAL_RULES + dateLine + locationContext + forceWebHint
    // Température basse quand la requête est factuelle (recherche web
    // déclenchée) : 0.7 favorisait la variabilité, donc l'hallucination de
    // chiffres/dates (audit, cause n°4). Conversationnel : 0.7 conservé.
    const temperature = forceWebHint ? 0.3 : 0.7
    // Modèle effectif : `options.model` (forcé par le comparateur) ou
    // selectMistralModel (auto-sélection Arty pour le chat normal — par
    // défaut Mistral Medium 3.5 depuis mai 2026).
    const model = options?.model || selectMistralModel(lastUserText)
    dispatchModelUsed({ model, provider: 'mistral' })

    // Build messages in OpenAI format
    const apiMessages: ApiMessage[] = [
      { role: 'system', content: systemPrompt },
      ...originalMessages.map(m => ({ role: m.role, content: m.content })),
    ]

    // Convert tools to OpenAI format. On y ajoute une définition `web_search`
    // spécifique Mistral — Mistral n'a pas de tool web search natif comme
    // Anthropic ou Gemini, donc on lui en fournit un qui appelle notre proxy
    // /api/search/web (route vers Linkup ou Brave selon SEARCH_PROVIDER).
    //
    // SAUF si `options.onToolCall` est absent (ex: comparateur de modèles) :
    // dans ce cas on ne fournit AUCUN tool, car la boucle ligne ~322
    // appelle onDone() dès qu'un toolCall est détecté sans handler côté
    // client → panneau vide avec 0 token streamé. Symétrique du fix
    // Anthropic dans le wiring du comparateur (compare.tsx).
    const baseTools = options?.onToolCall ? convertToolsToOpenAI(TOOLS) : []
    const openaiTools = options?.onToolCall
      ? [
          ...baseTools,
          {
            type: 'function' as const,
            function: {
              name: 'web_search',
              description: `Recherche web en temps réel. OBLIGATOIRE pour toute donnée récente (actualité, prix, événements, sorties produits, scores sportifs, météo, données 2025+).

Pour les COMPARAISONS multi-sites/multi-revendeurs (ex: "compare prix X chez Brico Dépôt, Cedeo, Mr Bricolage"), tu DOIS utiliser le paramètre 'sources' avec la liste des domaines (ex: ["bricodepot.fr", "cedeo.fr", "mrbricolage.fr"]). Le serveur fait UN APPEL PAR SOURCE et te retourne les résultats organisés par source — l'attribution est ainsi garantie. NE FAIS JAMAIS une seule recherche générique pour comparer plusieurs sources : tu mélangeras inévitablement les données.`,
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'La requête à rechercher (ex: "prix Daikin Altherma 3"). PAS d\'opérateur site: ici — utilise le paramètre `sources` à la place.' },
                  maxResults: { type: 'integer', description: 'Nombre max de résultats par source (défaut 5, max 10)' },
                  sources: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'OBLIGATOIRE pour les comparaisons multi-sites : liste des domaines à interroger séparément. Ex: ["bricodepot.fr", "cedeo.fr"]. Le serveur fait un appel par source. Cap à 6 sources max.',
                  },
                },
                required: ['query'],
              },
            },
          },
        ]
      : []

    // Lot D — forçage du tool web_search au PREMIER tour uniquement quand
    // la recherche est requise. Les tours suivants repassent en 'auto'
    // (sinon Mistral relancerait une recherche à chaque itération).
    let forceSearchNext = forceWebHint !== '' && openaiTools.length > 0

    let maxIterations = 20

    while (maxIterations > 0) {
      maxIterations--

      let once: Awaited<ReturnType<typeof streamOnce>>
      const wantForce = forceSearchNext
      forceSearchNext = false
      try {
        once = await streamOnce(
          apiKey, apiMessages, openaiTools, onToken, controller, model, temperature, wantForce
        )
      } catch (err) {
        // Repli défensif : si l'appel FORCÉ échoue (ex : l'API rejette la
        // forme nommée du tool_choice), on retente UNE fois en 'auto' — la
        // consigne prompt reste alors le seul levier. Jamais de retry sur
        // un abort (Stop utilisateur / timeout) NI sur un rate limit (le
        // backoff de streamOnce a déjà retenté ; ré-attaquer immédiatement
        // enfonçait le 429 — bug live du 11 juin, article Figaro en EU).
        const name = (err as Error).name
        if (!wantForce || name === 'AbortError' || name === 'RateLimitError') throw err
        once = await streamOnce(
          apiKey, apiMessages, openaiTools, onToken, controller, model, temperature, false
        )
      }
      const { content, toolCalls, inputTokens, outputTokens } = once

      try {
        recordUsage(model, inputTokens, outputTokens)
      } catch {
        // Ne casse pas la réponse si le tracking échoue
      }

      // No tool calls — we're done
      if (!toolCalls || toolCalls.length === 0 || !options?.onToolCall) {
        onDone()
        return
      }

      // Add assistant message with tool_calls
      apiMessages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })

      // Execute each tool call and add results
      for (const tc of toolCalls) {
        try {
          const args = JSON.parse(tc.function.arguments)
          // web_search est intercepté ici plutôt que routé vers onToolCall :
          // il appelle notre proxy /api/search/web qui route vers Linkup ou
          // Brave selon SEARCH_PROVIDER. Pas besoin d'enregistrer un handler
          // global — c'est spécifique au flow Mistral.
          let result: { result: string }
          if (tc.function.name === 'web_search') {
            result = await executeMistralWebSearch(args)
          } else {
            result = await options.onToolCall(tc.function.name, args)
          }
          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.result,
          })
        } catch (err) {
          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Erreur: ${err instanceof Error ? err.message : 'outil échoué'}`,
          })
        }
      }
    }

    // Max iterations reached
    onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Deux abandons distincts (audit Mistral 11 juin 2026) :
      // - Stop UTILISATEUR → controller externe aborté → publier le partiel
      //   via onDone() est correct.
      // - TIMEOUT interne (60s stream / 30s search) → le controller externe
      //   n'est PAS aborté. Avant : onDone() publiait une bulle assistant
      //   VIDE sans aucun signal — l'utilisateur voyait Arty « répondre »
      //   du néant. Maintenant : vraie erreur, bandeau + bouton Réessayer.
      if (controller.signal.aborted) {
        onDone()
        return
      }
      onError(new Error(i18n.t('errors.mistralTimeout')))
      return
    }
    onError(err instanceof Error ? err : new Error('Mistral streaming failed'))
  }
}

/**
 * Single streaming request to Mistral API.
 * Returns the accumulated content, any tool_calls, and token usage.
 */
async function streamOnce(
  apiKey: string | null,
  messages: ApiMessage[],
  tools: ReturnType<typeof convertToolsToOpenAI>,
  onToken: (text: string) => void,
  controller: AbortController,
  model: string,
  temperature: number,
  forceSearchTool: boolean
): Promise<{
  content: string
  toolCalls: ToolCall[]
  inputTokens: number
  outputTokens: number
}> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  // Get a valid (refreshed if needed) Google token for whitelist verification
  const googleToken = await getValidAccessToken()
  if (googleToken) {
    headers['x-google-token'] = googleToken
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model,
    messages,
    stream: true,
    max_tokens: 8192,
    temperature,
  }

  // Only include tools if we have some
  if (tools.length > 0) {
    body.tools = tools
    // Lot D (audit Mistral) — quand la recherche web est requise, 'auto'
    // laissait Mistral libre d'ignorer la consigne prompt « RECHERCHE WEB
    // OBLIGATOIRE » et de répondre de mémoire (cutoff) sur de l'actualité.
    // Le forçage API est contraignant, lui. Format OpenAI-compatible
    // supporté par l'API Mistral ; un repli 'auto' est gérén par l'appelant
    // si jamais l'API rejetait la forme nommée.
    body.tool_choice = forceSearchTool
      ? { type: 'function', function: { name: 'web_search' } }
      : 'auto'
  }

  // Fix 429 (11 juin 2026) — Mistral était le SEUL client sans backoff
  // (anthropicClient et geminiClient ont chacun leur fetchWithRetry). Sur
  // 429 : on respecte Retry-After si le proxy le forwarde, sinon backoff
  // court (2s puis 4s), max 2 retentatives, abortable par le Stop
  // utilisateur. Le retry se fait AVANT toute lecture du stream — sûr.
  let response!: Response
  for (let attempt = 0; ; attempt++) {
    // CRIT-5 — Timeout 60s sur le stream Mistral. Cold-start Cloudflare ou
    // réseau flaky peuvent laisser pendre 60-90s sinon. Compose avec le
    // controller externe (annulation utilisateur) pour les deux raisons.
    const timeoutCtrl = new AbortController()
    const timeoutId = setTimeout(() => timeoutCtrl.abort(new DOMException('Timeout', 'AbortError')), 60_000)
    const onExternalAbort = () => timeoutCtrl.abort(controller.signal.reason)
    if (controller.signal.aborted) timeoutCtrl.abort(controller.signal.reason)
    else controller.signal.addEventListener('abort', onExternalAbort)

    try {
      response = await fetch(apiUrl('/api/ai/mistral-proxy'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutCtrl.signal,
      })
    } finally {
      clearTimeout(timeoutId)
      controller.signal.removeEventListener('abort', onExternalAbort)
    }

    if (response.status !== 429 || attempt >= 2) break

    const errBody = await response.text().catch(() => '')
    // Quota journalier du proxy (body { error, count, limit }) : définitif
    // pour aujourd'hui — inutile de retenter, on surface le message précis
    // du proxy au lieu du générique « réessaie dans quelques secondes ».
    try {
      const parsed = JSON.parse(errBody) as { error?: string; count?: number; limit?: number }
      if (typeof parsed.count === 'number' && typeof parsed.limit === 'number') {
        throw Object.assign(new Error(parsed.error || i18n.t('errors.mistralRateLimit')), { name: 'RateLimitError' })
      }
    } catch (e) {
      if ((e as Error).name === 'RateLimitError') throw e
      // body non-JSON → rate limit upstream, on retente
    }
    const retryAfterRaw = response.headers.get('retry-after')
    const retryAfterMs = retryAfterRaw && Number.isFinite(Number(retryAfterRaw))
      ? Math.min(10_000, Math.max(500, Number(retryAfterRaw) * 1000))
      : 2_000 * (attempt + 1)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, retryAfterMs)
      controller.signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  }

  updateTrialFromResponse(response)

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error(i18n.t('errors.mistralKeyInvalid'))
    } else if (response.status === 429) {
      // Toujours 429 après les retentatives — typé pour que la boucle tool
      // (repli tool_choice) ne ré-attaque PAS immédiatement.
      throw Object.assign(new Error(i18n.t('errors.mistralRateLimit')), { name: 'RateLimitError' })
    } else {
      throw new Error(i18n.t('errors.mistralError', { status: response.status, message: err.slice(0, 100) }))
    }
  }

  if (!response.body) {
    throw new Error('Mistral: réponse vide (pas de body)')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let inputTokens = 0
  let outputTokens = 0
  const toolCalls: ToolCall[] = []
  // Accumulate partial tool calls by index
  const partialToolCalls = new Map<number, { id: string; name: string; args: string }>()

  // H-AI-1 (étendu Mistral) — releaseLock en try/finally pour éviter
  // le leak du reader sur erreur.
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
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta

          // Text content
          if (delta?.content) {
            content += delta.content
            onToken(delta.content)
          }

          // Tool calls (streamed incrementally)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (tc.id) {
                // New tool call starting
                partialToolCalls.set(idx, {
                  id: tc.id,
                  name: tc.function?.name || '',
                  args: tc.function?.arguments || '',
                })
              } else {
                // Continue accumulating arguments
                const existing = partialToolCalls.get(idx)
                if (existing) {
                  if (tc.function?.name) existing.name += tc.function.name
                  if (tc.function?.arguments) existing.args += tc.function.arguments
                }
              }
            }
          }

          // Usage
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens || 0
            outputTokens = parsed.usage.completion_tokens || 0
          }
        } catch {
          continue
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }

  // Finalize tool calls
  for (const [, tc] of partialToolCalls) {
    toolCalls.push({
      id: tc.id,
      function: { name: tc.name, arguments: tc.args },
    })
  }

  // Estimate tokens if not provided
  if (outputTokens === 0 && (content || toolCalls.length > 0)) {
    outputTokens = Math.ceil(content.length / 4)
    inputTokens = Math.ceil(JSON.stringify(messages).length / 4)
  }

  return { content, toolCalls, inputTokens, outputTokens }
}
