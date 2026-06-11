import { useState, useCallback, useEffect, useRef } from 'react'
import type { Conversation, Message, FileAttachment } from '../types'
import { generateId } from '../utils/generateId'
import { streamMessage } from '../services/anthropicClient'
import { streamGeminiMessage, geminiResearch } from '../services/geminiClient'
import { streamMistralMessage } from '../services/mistralClient'
import { sendMessageStream as streamOpenAIMessage } from '../services/openaiClient'
import { getOpenAIKey } from '../services/activeApiKey'
import { detectProvider, extractPdfUrls, extractWebUrls } from '../services/aiRouter'
import { fetchPdfMarkdowns, fetchUrlMarkdowns } from '../services/pdfUrlFetch'
import * as storage from '../services/storage'
import { useStreaming } from './useStreaming'
import { useFileAttachments, buildApiMessages, buildContentBlocks, buildTextOnlyMessages, buildMistralMessages, buildMistralBlocks } from './useFileAttachments'
import { getSelectedModel } from '../services/modelSelector'
import { getReflectionLevel } from '../services/reflectionLevel'
import { putFile } from '../services/secureFileStorage'
import { runFactCheckOnLatest, factCheckContent, getFactCheckMode } from '../services/factChecker'
import { detectSuggestedTasks, addTask } from '../services/taskService'
import { detectReminderIntent, createReminder } from '../services/reminderService'
import i18n from '../i18n'

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>

export function useConversation() {
  // H1 (audit frontend) — storage.getConversations() retourne la RÉFÉRENCE du
  // cache mémoire, muté en place par saveConversation. La repasser telle
  // quelle à setState ferait bail-out React (même identité → pas de
  // re-render : pin invisible, rappels qui n'apparaissent pas). On copie
  // le tableau à chaque lecture pour garantir une identité neuve.
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    [...storage.getConversations()]
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const systemPromptRef = useRef<string | undefined>(undefined)
  const toolHandlerRef = useRef<ToolHandler | undefined>(undefined)

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null

  const refreshConversations = useCallback(() => {
    setConversations([...storage.getConversations()])
  }, [])

  const streaming = useStreaming({ refreshConversations })
  const fileAttachments = useFileAttachments()
  // H2 (audit frontend) — identités stables extraites une fois. L'objet
  // `streaming` porte streamingContent → il change à chaque frame pendant un
  // stream. L'utiliser comme dep des callbacks ci-dessous les recréerait à
  // 60 fps et casserait les memo de MessageItem/Sidebar. Les fonctions,
  // elles, sont stables (useCallback à deps stables dans useStreaming).
  const {
    canStart, startStream, setActiveStream, setHideContent, markStreamDone,
    finalize: finalizeStream, completeStreaming, onToken: streamToken,
    onDone: streamDone, onError: streamError, setProgressContent,
    setAbortController, resetAccumulated, hasStream, isActive, stopStreaming,
  } = streaming
  const { setPendingFiles, pendingFilesRef } = fileAttachments

  // Conversations are encrypted at rest and decrypted asynchronously after
  // crypto init. The useState initializer above runs before that finishes,
  // so on a fresh boot it returns an empty list. Re-read once the decrypted
  // cache is ready (BUG 43 pattern — listen for the ready event).
  useEffect(() => {
    const onReady = () => setConversations([...storage.getConversations()])
    window.addEventListener('conversations-storage-ready', onReady)
    return () => window.removeEventListener('conversations-storage-ready', onReady)
  }, [])

  // Feature 8: detect action items in new assistant messages and suggest as tasks
  const lastScannedRef = useRef<string | null>(null)
  useEffect(() => {
    if (streaming.isStreaming) return
    const active = conversations.find((c) => c.id === activeId)
    if (!active || active.messages.length === 0) return
    const last = active.messages[active.messages.length - 1]
    if (!last || last.role !== 'assistant') return
    if (lastScannedRef.current === last.id) return
    lastScannedRef.current = last.id
    const suggestions = detectSuggestedTasks(last.content)
    for (const text of suggestions) {
      addTask(text, active.id)
    }
  }, [conversations, activeId, streaming.isStreaming])

  const createConversation = useCallback((withWelcome?: boolean, euOnly?: boolean): string => {
    const id = generateId()
    const messages: Message[] = []

    if (withWelcome) {
      messages.push({
        id: generateId(),
        role: 'assistant',
        content: `Salut ! Moi c'est **Arty**, ton assistant IA.\n\nTu peux me poser des questions, m'envoyer des photos, ou me dicter un message.\n\nEn haut à droite, tu peux changer le **ton** de mes réponses et le **modèle IA** utilisé. Appuie sur **?** pour voir les détails.\n\nSi tu connectes ton compte Google, je pourrai aussi lire tes mails, accéder à tes fichiers Drive et gérer ton agenda.\n\nQu'est-ce que je peux faire pour toi ?`,
        timestamp: Date.now(),
      })
    }

    if (euOnly) {
      messages.push({
        id: generateId(),
        role: 'assistant',
        content: `🇪🇺 **Conversation confidentielle EU**\n\nCette conversation utilise exclusivement **Mistral** (serveurs en France). Tes données ne quitteront pas l'Europe.\n\nJe peux lire tes mails, accéder à Drive et gérer ton calendrier — tout reste en EU.`,
        timestamp: Date.now(),
      })
    }

    const conv: Conversation = {
      id,
      title: euOnly ? '🇪🇺 Conversation EU' : 'Nouvelle conversation',
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(euOnly ? { euOnly: true, usedModels: ['mistral'] } : {}),
    }
    storage.saveConversation(conv)
    refreshConversations()
    setActiveStream(id)
    setActiveId(id)
    setError(null)
    return id
  }, [refreshConversations, setActiveStream])

  const selectConversation = useCallback((id: string) => {
    setActiveStream(id)
    setActiveId(id)
    setError(null)
  }, [setActiveStream])

  const clearActive = useCallback(() => {
    setActiveStream(null)
    setActiveId(null)
    setError(null)
  }, [setActiveStream])

  const clearError = useCallback(() => setError(null), [])

  const setSystemPrompt = useCallback((prompt: string | undefined) => {
    systemPromptRef.current = prompt
  }, [])

  const setToolHandler = useCallback((handler: ToolHandler) => {
    toolHandlerRef.current = handler
  }, [])

  const sendMessage = useCallback(
    async (text: string, conversationId?: string, files?: FileAttachment[]) => {
      const targetId = conversationId ?? activeId
      if (!targetId) return

      setError(null)

      const conv = storage.getConversation(targetId)
      if (!conv) {
        // H5 (audit frontend) — fenêtre de boot : l'historique chiffré n'est
        // pas encore déchiffré, saveConversation est no-op, la conv créée
        // n'existe pas → l'envoi serait silencieusement perdu. On affiche une
        // erreur au lieu de dropper l'action de l'utilisateur.
        if (!storage.isCacheReady()) {
          setError(i18n.t('errors.storageNotReady'))
        }
        return
      }

      // Cap multi-conv : refuse l'envoi si le cap de streams concurrents est
      // atteint. La check est faite AVANT d'ajouter le user message pour ne
      // pas laisser un message orphelin sans réponse.
      if (!canStart(targetId)) {
        setError(i18n.t('errors.tooManyConcurrentStreams'))
        return
      }

      // Roadmap Phase 2 C — détection d'intent rappel.
      // Avant l'envoi LLM, on check si le message demande un rappel
      // ("rappelle-moi mardi à 9h de répondre à Marie"). Si oui, on crée
      // la tâche + notification planifiée, on répond par un faux message
      // assistant, et on ne consomme PAS de quota LLM.
      // Détection conservative : trigger explicite + date claire + body
      // non vide. Si ambigu, on laisse passer au LLM.
      const reminderIntent = detectReminderIntent(text)
      if (reminderIntent) {
        const userMsg: Message = {
          id: generateId(),
          role: 'user',
          content: text,
          timestamp: Date.now(),
        }
        const label = await createReminder(reminderIntent, targetId)
        const reminderResponse: Message = {
          id: generateId(),
          role: 'assistant',
          content: label,
          timestamp: Date.now(),
        }
        conv.messages.push(userMsg, reminderResponse)
        conv.updatedAt = Date.now()
        storage.saveConversation(conv)
        refreshConversations()
        return
      }

      // Handle /aide command
      if (text.trim().toLowerCase() === '/aide') {
        const helpMsg: Message = {
          id: generateId(),
          role: 'user',
          content: '/aide',
          timestamp: Date.now(),
        }
        const helpResponse: Message = {
          id: generateId(),
          role: 'assistant',
          content: `## Aide — Arty\n\n**Ce que je sais faire :**\n- Répondre à tes questions sur tous les sujets\n- Analyser des photos et documents (bouton **+**)\n- Dicter par la voix (bouton **micro**)\n- Lire tes mails Gmail et y répondre\n- Accéder à tes fichiers Google Drive\n- Gérer ton agenda Google Calendar\n- Faire des recherches web en temps réel\n\n**Commandes :**\n- \`/aide\` — Affiche cette aide\n\n**Réglages (en haut à droite) :**\n- **Ton** — Normal, Concis, Détaillé, Formel, Technique\n- **Modèle** — Auto, Claude, Mistral EU, Gemini\n- **?** — Explication détaillée de chaque option\n\n**Astuce :** Connecte ton compte Google pour que je puisse accéder à tes mails et fichiers.`,
          timestamp: Date.now(),
        }
        conv.messages.push(helpMsg, helpResponse)
        conv.updatedAt = Date.now()
        storage.saveConversation(conv)
        refreshConversations()
        return
      }

      // Persiste les binaires dans IndexedDB chiffré AVANT de sauvegarder le
      // Message. On garde uniquement {id, name, type, size} sur le Message —
      // le binaire est rechargé à la volée par buildApiMessages au moment de
      // l'envoi API. Si putFile throw (quota dépassé), on continue avec les
      // fichiers en RAM uniquement (perdus au refresh, mais le tour courant
      // marche).
      let persistedFiles: FileAttachment[] | undefined
      if (files && files.length > 0) {
        persistedFiles = await Promise.all(
          files.map(async (f) => {
            // Si f.data est absent (cas retry/edit : déjà persisté),
            // on garde la référence telle quelle.
            if (!f.data) return f
            try {
              const id = await putFile(f)
              return { id, name: f.name, type: f.type, size: f.size }
            } catch (err) {
              if (import.meta.env.DEV) console.warn('putFile failed:', err)
              // Ne PAS retourner l'objet avec data — saveConversation écrirait
              // le base64 en localStorage et risquerait la limite 5 MB (BUG 11).
              // Le tour courant marche via pendingFilesRef qui contient encore
              // les data en RAM. Les renders futurs verront "Image indispo".
              return { id: f.id, name: f.name, type: f.type, size: f.size }
            }
          })
        )
      }

      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        ...(persistedFiles ? { files: persistedFiles } : {}),
      }

      conv.messages.push(userMessage)
      // Titre auto au PREMIER message utilisateur. L'ancienne condition
      // `messages.length === 1` ne matchait jamais quand la conv démarrait
      // avec un message de bienvenue ou le préambule EU (length === 2 au
      // premier message user) → titre "Nouvelle conversation" pour toujours.
      // Pas de préfixe 🇪🇺 dans le titre : la Sidebar affiche déjà le badge EU
      // sur la ligne d'aperçu (doublon relevé en relecture).
      const userMessageCount = conv.messages.filter((m) => m.role === 'user').length
      if (userMessageCount === 1) {
        conv.title = text.trim().slice(0, 50) + (text.trim().length > 50 ? '...' : '')
      }
      conv.updatedAt = Date.now()
      storage.saveConversation(conv)
      refreshConversations()
      setActiveStream(targetId)
      setActiveId(targetId)

      setPendingFiles((files && files.length > 0) ? files : null)

      // Mode "publish-after-fact-check" : si fact-check actif, on cache
      // les tokens en live (TypingIndicator au lieu de bulle stream) et on
      // retarde le finalize jusqu'à la fin du fact-check. Évite à
      // l'utilisateur de voir la version non vérifiée. Mode 'off' garde
      // l'ancien flow streaming visible + fact-check async.
      // RGPD (RÈGLE 5.3) — audit Mistral 11 juin 2026 : le fact-checker
      // tourne sur Claude (Anthropic, serveurs US). L'exécuter sur une
      // conversation euOnly enverrait question + réponse (jusqu'à 8 000
      // chars, mails/Drive inclus) hors Europe — violation silencieuse de
      // la promesse « tes données ne quitteront pas l'Europe ». Fact-check
      // désactivé sur les convs EU ; le sheet « ⋯ » l'indique (euLocked).
      const factCheckMode = conv.euOnly ? 'off' : getFactCheckMode()
      const deferPublish = factCheckMode !== 'off'

      // Relecture (audit) — canStart est vérifié plus haut mais des `await`
      // (putFile, createReminder) s'intercalent : le cap peut être atteint
      // entre-temps. Ignorer ce retour lançait un appel LLM orphelin dont le
      // onDone finalisait une bulle assistant VIDE.
      if (!startStream(targetId)) {
        setError(i18n.t('errors.tooManyConcurrentStreams'))
        return
      }
      setHideContent(deferPublish, targetId)

      const onToken = (token: string) => streamToken(token, targetId)

      const onDone = async () => {
        // Signale au PlanBadge de rafraîchir ses compteurs free quotidiens.
        try { window.dispatchEvent(new CustomEvent('arty-message-sent')) } catch {}

        if (!deferPublish) {
          // Mode 'off' : publication immédiate, pas de fact-check.
          streamDone(targetId)
          return
        }

        // Mode fact-check actif : retient le placeholder, lance la vérif,
        // puis publie la bulle finale avec contenu corrigé d'un coup.
        const content = markStreamDone(targetId)

        // Trouve le user message qui précède pour le fact-check.
        const conv = storage.getConversation(targetId)
        type Msg = NonNullable<typeof conv>['messages'][number]
        let userMsg: Msg | undefined
        if (conv) {
          for (let i = conv.messages.length - 1; i >= 0; i--) {
            const m = conv.messages[i]
            if (m && m.role === 'user') {
              userMsg = m
              break
            }
          }
        }

        // Fallback : si pas de content ou pas de user msg, on publie ce
        // qu'on a et on tente le fact-check après (ancien flow).
        if (!content || !userMsg) {
          finalizeStream(targetId, content)
          completeStreaming(targetId)
          if (content) void runFactCheckOnLatest(targetId, refreshConversations)
          return
        }

        const fc = await factCheckContent(userMsg.content, content, factCheckMode)

        // H4 (audit frontend) — si l'utilisateur a cliqué Stop PENDANT le
        // fact-check, stopStreaming() a déjà finalisé (bulle "interrompue")
        // et démonté le stream. Re-finaliser ici pousserait une DEUXIÈME
        // bulle assistant persistée. Le stream absent = stop déjà traité.
        if (!hasStream(targetId)) return

        const finalContent = fc?.correctedContent || content

        // Publie la bulle finale. finalize crée un message avec un nouvel
        // ID — on attache le factCheck juste après via une lecture/écriture
        // de la conv.
        finalizeStream(targetId, finalContent)
        if (fc?.result) {
          // Succès : attache le résultat normal.
          const fresh = storage.getConversation(targetId)
          if (fresh) {
            const last = fresh.messages[fresh.messages.length - 1]
            if (last && last.role === 'assistant') {
              last.factCheck = fc.result
              storage.saveConversation(fresh)
              refreshConversations()
            }
          }
        } else if (fc) {
          // fc.result === null mais fc !== null → fact-check a vraiment été
          // tenté et a échoué (timeout/parse/réseau). Affiche le badge pour
          // que l'utilisateur sache que la réponse n'est pas vérifiée.
          const fresh = storage.getConversation(targetId)
          if (fresh) {
            const last = fresh.messages[fresh.messages.length - 1]
            if (last && last.role === 'assistant') {
              last.factCheck = {
                overallConfidence: 'medium',
                claims: [],
                modelLabel: `⚠ Fact-check indisponible${fc.failReason ? ` (${fc.failReason})` : ''}`,
                checkedAt: Date.now(),
                status: 'failed',
              }
              storage.saveConversation(fresh)
              refreshConversations()
            }
          }
        }
        // fc === null → skip intentionnel (mode off ou réponse triviale)
        // → on n'attache pas de factCheck du tout, pas de badge visible.
        completeStreaming(targetId)
      }

      const onErr = (err: Error) => {
        streamError(err, targetId)
        if (isActive(targetId)) {
          setError(err.message)
        }
      }

      const currentFiles = pendingFilesRef.current
      const hasFiles = !!(currentFiles && currentFiles.length > 0)
      const hasPdf = hasFiles && currentFiles!.some((f) => f.type === 'application/pdf')
      const selectedModel = getSelectedModel()
      // EU-only conversations always use Mistral (data stays in Europe).
      // Sinon : si fichiers attachés, on choisit le provider selon ce que
      // le modèle sélectionné peut gérer. Mistral Medium 3.5 a une vision
      // native depuis avril → on respecte le choix de l'utilisateur s'il
      // a explicitement choisi Mistral et qu'aucun PDF n'est attaché (PDF
      // pas supporté nativement par Mistral). Gemini/OpenAI multimodal
      // non câblés ici → fallback Claude pour ces cas. Sans ça, l'app
      // forçait Sonnet même quand l'utilisateur avait sélectionné Mistral.
      let provider: ReturnType<typeof detectProvider> | 'mistral' | 'claude'
      if (conv.euOnly) {
        provider = 'mistral'
      } else if (hasFiles) {
        if (selectedModel === 'mistral' && !hasPdf) {
          provider = 'mistral'
        } else {
          provider = 'claude'
        }
      } else {
        provider = detectProvider(text)
      }

      // Track which models are used in this conversation
      const usedModels = conv.usedModels || []
      const modelName = provider === 'hybrid' ? 'gemini' : provider
      if (!usedModels.includes(modelName)) {
        usedModels.push(modelName)
        conv.usedModels = usedModels
        storage.saveConversation(conv)
      }

      // Roadmap PR 12.1 — déclenche la reconstruction du system prompt avec
      // le user message courant. useAppSetup écoute cet event de manière
      // synchrone (dispatchEvent → handler → setSystemPrompt → ref updated)
      // donc systemPromptRef.current est à jour quand on appelle le LLM
      // ci-dessous. Sans cet event : fallback legacy = mémoire complète
      // injectée (5k tokens parasites sur "salut"). Avec : profil minimal
      // si le message ne touche pas à la mémoire.
      try {
        window.dispatchEvent(
          new CustomEvent('arty-rebuild-prompt', { detail: { userMessage: text } })
        )
      } catch { /* SSR / test env */ }

      let controller: AbortController

      // M1 (audit frontend) — try/catch global sur toute la phase de
      // préparation + dispatch. Sans lui, un throw après startStream (atob sur
      // base64 corrompu, reject IndexedDB, builder qui explose) laissait le
      // stream fantôme dans streamsRef : bouton Stop permanent, textarea
      // bloquée, quota de streams consommé jusqu'au reload.
      try {

      // URLs de PDF public collées : ni `web_fetch`/`url_context` (Claude/
      // Gemini n'avalent pas un PDF binaire) ni Mistral (aucune lecture d'URL)
      // ne savent les lire. On convertit chaque PDF en Markdown via Linkup
      // (/api/fetch/url) et on l'inline dans le message courant, quel que soit
      // le provider. Échec = on laisse passer tel quel. Linkup est déjà dans
      // le chemin de données euOnly (recherche web Mistral via /api/search/web)
      // et hébergé en EU → compatible avec la promesse "données EU".
      let outgoingText = text
      if (provider !== 'hybrid') {
        const pdfUrls = extractPdfUrls(text)
        if (pdfUrls.length > 0) {
          setProgressContent('📄 Lecture du PDF...', targetId)
          const pdfSections = await fetchPdfMarkdowns(pdfUrls)
          if (pdfSections) {
            outgoingText = `${text}\n\n${pdfSections}`
          }
          resetAccumulated(targetId)
          setProgressContent('', targetId)
        }

        // Lot C (audit Mistral) — conversations euOnly : Mistral n'a aucune
        // lecture d'URL native ; hors EU, une URL route vers Claude
        // (web_fetch), mais le verrou euOnly court-circuite ce garde-fou.
        // On récupère donc le contenu des pages via Linkup (hébergé EU,
        // même chemin que les PDF ci-dessus) et on l'inline — les données
        // ne quittent pas l'Europe. Échec = on laisse passer tel quel,
        // MISTRAL_RULES fait déclarer la limite honnêtement.
        if (conv.euOnly) {
          const webUrls = extractWebUrls(text).filter((u) => !pdfUrls.includes(u))
          if (webUrls.length > 0) {
            setProgressContent('🔗 Lecture du lien (EU)...', targetId)
            const { block, unreadable } = await fetchUrlMarkdowns(webUrls)
            if (block) {
              outgoingText = `${outgoingText}\n\n${block}`
            }
            // Page protégée (paywall) / illisible : sans ce marqueur, Mistral
            // retombait sur son fallback générique « je ne peux pas lire,
            // passe sur Claude » — faux ET impossible en mode EU. On lui dit
            // précisément quoi répondre (bug live 11 juin, article Figaro).
            if (unreadable.length > 0) {
              outgoingText =
                `${outgoingText}\n\n[Note système : le contenu de ${unreadable.join(', ')} n'a pas pu être récupéré (page protégée par un abonnement/paywall ou non extractible). Dis-le clairement à l'utilisateur et demande-lui de coller le texte de l'article ici. Ne propose PAS de changer de modèle ou de "passer sur Claude" — cette conversation est verrouillée en mode Europe.]`
            }
            resetAccumulated(targetId)
            setProgressContent('', targetId)
          }
        }
      }

      if (provider === 'hybrid') {
        setProgressContent('🔍 Recherche en cours (Gemini)...', targetId)
        Promise.all([geminiResearch(text), buildApiMessages(conv.messages)]).then(([research, enrichedMessages]) => {
          // Si l'utilisateur a cliqué Stop PENDANT la recherche Gemini,
          // stopStreaming() a déjà nettoyé le stream. Sans ce garde, le .then
          // démarrerait quand même une génération Claude "zombie" après le Stop.
          if (!hasStream(targetId)) return
          if (research) {
            enrichedMessages[enrichedMessages.length - 1] = {
              role: 'user',
              content: `${text}\n\n--- RECHERCHE WEB (données Gemini, à jour) ---\n${research}\n--- FIN RECHERCHE ---\n\nUtilise ces données pour ton rapport. Cite les sources trouvées.`,
            }
          }
          resetAccumulated(targetId)
          setProgressContent('', targetId)
          controller = streamMessage(enrichedMessages, onToken, onDone, onErr, {
            systemPrompt: systemPromptRef.current,
            onToolCall: toolHandlerRef.current,
            // Niveau de réflexion utilisateur (chat réel uniquement — jamais
            // sur les appels imposés type comparateur/brief). Cf. anthropicClient.
            reflectionLevel: getReflectionLevel(),
          })
          setAbortController(targetId, controller)
        }).catch(onErr)
        controller = new AbortController()
      } else if (provider === 'gemini') {
        // Gemini text-only pour l'instant — le multimodal Gemini sera dans
        // une PR future (formats parts/inlineData différents de Claude).
        const apiMessages = await buildTextOnlyMessages(conv.messages)
        if (outgoingText !== text) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        controller = streamGeminiMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          reflectionLevel: getReflectionLevel(),
        })
      } else if (provider === 'mistral') {
        // Mistral Medium 3.5 a une vision native → on utilise le builder
        // multimodal pour passer les images en image_url. Indispensable pour
        // que les conversations euOnly puissent analyser des images sans
        // sortir d'EU vers Claude/Gemini.
        const apiMessages = await buildMistralMessages(conv.messages)
        // Pour le message courant, on ré-injecte les fichiers depuis la RAM
        // (pendingFilesRef) : ça bypass l'IndexedDB roundtrip et garantit
        // que Mistral voit l'image même si putFile a échoué silencieusement
        // ou si le commit IndexedDB n'a pas encore été visible côté lecture.
        // Symétrique du path Claude (voir plus bas).
        if (currentFiles && currentFiles.length > 0) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: buildMistralBlocks(outgoingText, currentFiles) }
          setPendingFiles(null)
        } else if (outgoingText !== text) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        controller = streamMistralMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          onToolCall: toolHandlerRef.current,
          // Fix 429 — outgoingText ≠ text ⇔ du contenu d'URL/PDF a été
          // inliné (lot C) : la recherche forcée serait un appel Mistral
          // de plus pour rien, dos à dos avec la synthèse (rate limit).
          urlContentInlined: outgoingText !== text,
          euOnly: conv.euOnly,
        })
      } else if (provider === 'openai') {
        // openaiKey peut être null — dans ce cas le client passe par le proxy
        // serveur (/api/ai/openai-proxy) qui utilise env.OPENAI_API_KEY.
        const openaiKey = getOpenAIKey()
        const textOnly = await buildTextOnlyMessages(conv.messages)
        const apiMessages = textOnly.map((m) => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.content,
        }))
        if (outgoingText !== text && apiMessages.length > 0) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        controller = streamOpenAIMessage(apiMessages, openaiKey, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
        })
      } else {
        // Claude path — historique complet avec content blocks pour les images
        // et PDFs des tours précédents (rechargés depuis IndexedDB via
        // buildApiMessages/hydrateFiles). Plus de bug de fichier oublié au
        // tour suivant.
        const apiMessages = await buildApiMessages(conv.messages)
        if (currentFiles && currentFiles.length > 0) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: await buildContentBlocks(outgoingText, currentFiles) }
          setPendingFiles(null)
        } else if (outgoingText !== text) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        controller = streamMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          onToolCall: toolHandlerRef.current,
          reflectionLevel: getReflectionLevel(),
        })
      }

      setAbortController(targetId, controller)

      } catch (err) {
        // onErr finalize ce qui a été accumulé, démonte le stream et affiche
        // l'erreur — exactement comme une erreur réseau du client LLM.
        onErr(err instanceof Error ? err : new Error(String(err)))
      }
    },
    [
      activeId, refreshConversations, canStart, startStream, setActiveStream,
      setHideContent, markStreamDone, finalizeStream, completeStreaming,
      streamToken, streamDone, streamError, setProgressContent,
      setAbortController, resetAccumulated, hasStream, isActive,
      setPendingFiles, pendingFilesRef,
    ]
  )

  const deleteConv = useCallback(
    (id: string) => {
      // Si la conv supprimée a un stream en cours, l'arrêter d'abord pour
      // libérer son saveInterval et abort le fetch en cours. Sinon l'interval
      // continuerait à essayer de sauver dans une conv qui n'existe plus.
      if (hasStream(id)) {
        stopStreaming(id)
      }
      storage.deleteConversation(id)
      refreshConversations()
      if (activeId === id) {
        setActiveId(null)
      }
    },
    [activeId, refreshConversations, hasStream, stopStreaming]
  )

  // Renommage manuel d'une conversation depuis la Sidebar (audit UX — le
  // titre auto tronqué n'était ni régénéré ni éditable).
  const renameConversation = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      const conv = storage.getConversation(id)
      if (!conv) return
      conv.title = trimmed.slice(0, 80)
      storage.saveConversation(conv)
      refreshConversations()
    },
    [refreshConversations]
  )

  // Branch a conversation from a specific message index
  const branchConversation = useCallback(
    (fromConvId: string, messageIndex: number): string | null => {
      const conv = storage.getConversation(fromConvId)
      if (!conv) return null

      const branchedMessages = conv.messages.slice(0, messageIndex + 1)
      const newId = generateId()
      const newConv: Conversation = {
        id: newId,
        title: `${conv.title} (branche)`,
        messages: branchedMessages.map(m => ({ ...m, id: generateId() })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // Preserve EU flag and model history from parent conversation
        ...(conv.euOnly ? { euOnly: true } : {}),
        ...(conv.usedModels ? { usedModels: [...conv.usedModels] } : {}),
      }
      storage.saveConversation(newConv)
      refreshConversations()
      return newId
    },
    [refreshConversations]
  )

  // Toggle pinned flag on a specific message (Feature 3)
  const togglePinMessage = useCallback(
    (conversationId: string, messageId: string) => {
      const conv = storage.getConversation(conversationId)
      if (!conv) return
      const msg = conv.messages.find((m) => m.id === messageId)
      if (!msg) return
      // H1 (audit frontend) — remplacement IMMUTABLE du message. Muter
      // msg.pinned en place laissait la même référence d'objet → le memo de
      // MessageItem ne voyait aucun changement → l'épingle n'apparaissait
      // qu'au prochain remount de la conversation.
      conv.messages = conv.messages.map((m) =>
        m.id === messageId ? { ...m, pinned: !m.pinned } : m
      )
      conv.updatedAt = Date.now()
      storage.saveConversation(conv)
      refreshConversations()
    },
    [refreshConversations]
  )

  // Retry an interrupted assistant message: find the user message right
  // before it, drop everything from there on, and resend that user message.
  // Reuses editAndResend's truncation logic.
  const retryMessage = useCallback(
    (assistantMessageId: string) => {
      const targetId = activeId
      if (!targetId) return
      const conv = storage.getConversation(targetId)
      if (!conv) return

      const idx = conv.messages.findIndex((m) => m.id === assistantMessageId)
      if (idx <= 0) return
      // Walk backwards to find the most recent user message
      let userIdx = idx - 1
      while (userIdx >= 0 && conv.messages[userIdx]?.role !== 'user') userIdx--
      if (userIdx < 0) return
      const userMsg = conv.messages[userIdx]
      if (!userMsg) return

      const originalFiles = userMsg.files
      conv.messages = conv.messages.slice(0, userIdx)
      conv.updatedAt = Date.now()
      storage.saveConversation(conv)
      refreshConversations()

      sendMessage(userMsg.content, targetId, originalFiles)
    },
    [activeId, refreshConversations, sendMessage]
  )

  // Edit the last message in a conversation and re-send (Feature 12)
  const editAndResend = useCallback(
    (messageId: string, newContent: string) => {
      const targetId = activeId
      if (!targetId) return
      const conv = storage.getConversation(targetId)
      if (!conv) return

      const idx = conv.messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      const msg = conv.messages[idx]
      if (!msg || msg.role !== 'user') return

      // Truncate everything after this message and update its content
      const originalFiles = msg.files
      conv.messages = conv.messages.slice(0, idx)
      conv.updatedAt = Date.now()
      storage.saveConversation(conv)
      refreshConversations()

      // Re-send the edited message
      sendMessage(newContent, targetId, originalFiles)
    },
    [activeId, refreshConversations, sendMessage]
  )

  // Retry depuis le bandeau d'erreur (audit UX) : quand l'appel échoue AVANT
  // le premier token, aucun message assistant `interrupted` n'existe → pas de
  // bouton retry inline. Celui-ci rejoue le DERNIER message utilisateur de la
  // conversation active sans que l'utilisateur ait à le retaper.
  const retryLastUserMessage = useCallback(() => {
    const targetId = activeId
    if (!targetId) return
    const conv = storage.getConversation(targetId)
    if (!conv) return
    let userIdx = conv.messages.length - 1
    while (userIdx >= 0 && conv.messages[userIdx]?.role !== 'user') userIdx--
    if (userIdx < 0) return
    const userMsg = conv.messages[userIdx]
    if (!userMsg) return

    const originalFiles = userMsg.files
    conv.messages = conv.messages.slice(0, userIdx)
    conv.updatedAt = Date.now()
    storage.saveConversation(conv)
    refreshConversations()

    sendMessage(userMsg.content, targetId, originalFiles)
  }, [activeId, refreshConversations, sendMessage])

  return {
    conversations,
    activeConversation,
    activeId,
    isStreaming: streaming.isStreaming,
    streamingContent: streaming.streamingContent,
    streamingConvIds: streaming.streamingConvIds,
    isStreamingFor: streaming.isStreamingFor,
    error,
    clearError,
    createConversation,
    selectConversation,
    clearActive,
    sendMessage,
    deleteConversation: deleteConv,
    renameConversation,
    branchConversation,
    stopStreaming,
    setSystemPrompt,
    setToolHandler,
    togglePinMessage,
    editAndResend,
    retryMessage,
    retryLastUserMessage,
  }
}
