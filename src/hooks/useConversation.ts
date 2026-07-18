import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatSendOptions, Conversation, Message, FileAttachment } from '../types'
import { generateId } from '../utils/generateId'
import { streamMessage } from '../services/anthropicClient'
import { streamGeminiMessage, geminiResearch } from '../services/geminiClient'
import { streamMistralMessage } from '../services/mistralClient'
import { sendMessageStream as streamOpenAIMessage } from '../services/openaiClient'
import { getOpenAIKey } from '../services/activeApiKey'
import { extractPdfUrls, extractWebUrls } from '../services/aiRouter'
import { canExecuteRoute, resolveRoute } from '../services/router/resolveRoute'
import { gatherRouteInput } from '../services/router/gatherRouteInput'
import { notifyRouteOverrides } from '../services/router/notifyRouteOverrides'
import { fetchPdfMarkdowns, fetchUrlMarkdowns } from '../services/pdfUrlFetch'
import * as storage from '../services/storage'
import { maybeExtractMemory } from '../services/autoMemory'
import { useStreaming } from './useStreaming'
import { useFileAttachments, buildApiMessages, buildContentBlocks, buildTextOnlyMessages, buildMistralMessages, buildMistralContentBlocks } from './useFileAttachments'
import { getReflectionLevel } from '../services/reflectionLevel'
import { putFile } from '../services/secureFileStorage'
import { runFactCheckOnLatest, getFactCheckMode } from '../services/factChecker'
import { detectSuggestedTasks, addTask } from '../services/taskService'
import { TOOLS } from '../services/toolDefinitions'
import { wantsImageGeneration, generateImageToolDefinition } from '../services/tools/imageTools'
import { detectReminderIntent, createReminder } from '../services/reminderService'
import { composeQuickActionText, isQuickActionSelection } from '../services/quickActions'
import { clearConversationComposerDraft } from '../services/composerDrafts'
import i18n from '../i18n'

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>

// P1.5 — outils Google qui font ENTRER du contenu (fichier, agenda,
// contact) dans le contexte → la réponse peut en contenir. Sert à flaguer
// `hasGoogleData` pour l'avertissement renforcé avant un partage public.
const GOOGLE_TOOL_NAMES = new Set([
  'list_drive', 'search_drive', 'read_drive_file',
  'list_calendar', 'search_contacts',
])

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
    canStart, startStream, setActiveStream, onToken: streamToken,
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

  const createConversation = useCallback((withWelcome?: boolean, euOnly?: boolean): string | null => {
    // Symétrie avec le garde H5 de sendMessage : tant que l'historique
    // chiffré n'est pas déchiffré (bootstrap en cours ou échec),
    // saveConversation est un no-op silencieux — naviguer vers l'id d'une
    // conversation qui n'existe nulle part laissait ChatRoute rendre `null`
    // en permanence (écran vide, juillet 2026). On refuse la création avec
    // une erreur visible plutôt que de dropper l'action de l'utilisateur.
    if (!storage.isCacheReady()) {
      setError(i18n.t('errors.storageNotReady'))
      return null
    }
    if (euOnly) {
      const access = gatherRouteInput({
        originalText: '',
        hasFiles: false,
        hasPdf: false,
        euOnly: true,
        hasPrivateHistory: false,
      })
      if (!canExecuteRoute(access)) {
        setError(i18n.t('errors.euPlanRequired'))
        return null
      }
    }
    const id = generateId()
    const messages: Message[] = []

    if (withWelcome) {
      messages.push({
        id: generateId(),
        role: 'assistant',
        content: `Salut ! Moi c'est **Arty**, ton assistant IA.\n\nTu peux me poser des questions, m'envoyer des photos ou documents, ou me dicter un message.\n\nPour travailler sur un e-mail, colle, joins ou partage simplement son contenu dans la conversation : je n'accède pas à ta boîte mail.\n\nQu'est-ce que je peux faire pour toi ?`,
        timestamp: Date.now(),
      })
    }

    if (euOnly) {
      messages.push({
        id: generateId(),
        role: 'assistant',
        content: `🇪🇺 **Conversation confidentielle EU**\n\nLe traitement IA de cette conversation se fait exclusivement chez **Mistral** (serveurs en France) — rien n'est envoyé à Claude, Gemini ou OpenAI, dictée vocale comprise. Tes messages restent stockés sur ton appareil, chiffrés.\n\nJe peux analyser les contenus que tu colles, joins ou partages ici, mais je n'accède pas à ta boîte mail.`,
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
    // ⚠️ INVARIANT (revue #353) : tout `return false` (refus) DOIT rester
    // SYNCHRONE — placé avant le premier `await` de cette fonction. Deux
    // consommateurs en dépendent : handleSendFromHome (App.tsx) capte les
    // refus via un Promise.race à 0 ms avant de naviguer, et InputBar
    // restaure le brouillon vidé optimistiquement en comptant sur une
    // résolution quasi immédiate (composant encore monté). Un refus ajouté
    // APRÈS un await perdrait la course silencieusement : navigation vers
    // une conversation vide + brouillon perdu.
    async (
      text: string,
      conversationId?: string,
      files?: FileAttachment[],
      options?: ChatSendOptions,
    ): Promise<boolean> => {
      const targetId = conversationId ?? activeId
      if (!targetId) return false

      // Seul un ID connu peut activer une instruction invisible. Le texte
      // saisi reste la source d'affichage, de titre, de recherche et de copie.
      const quickAction = isQuickActionSelection(options?.quickAction)
        ? options.quickAction
        : undefined
      const modelText = composeQuickActionText(text, quickAction)

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
        return false
      }

      // Roadmap Phase 2 C — détection d'intent rappel.
      // Avant l'envoi LLM, on check si le message demande un rappel
      // ("rappelle-moi mardi à 9h de répondre à Marie"). Si oui, on crée
      // la tâche + notification planifiée, on répond par un faux message
      // assistant, et on ne consomme PAS de quota LLM.
      // Détection conservative : trigger explicite + date claire + body
      // non vide. Si ambigu, on laisse passer au LLM.
      // Une action rapide explicite doit gagner sur les automations locales :
      // un texte à résumer contenant « rappelle-moi mardi » ne doit pas créer
      // un vrai rappel à la place du résumé demandé.
      const reminderIntent = quickAction ? null : detectReminderIntent(text)
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
        return true
      }

      // Handle /aide command
      if (!quickAction && text.trim().toLowerCase() === '/aide') {
        const helpMsg: Message = {
          id: generateId(),
          role: 'user',
          content: '/aide',
          timestamp: Date.now(),
        }
        const helpResponse: Message = {
          id: generateId(),
          role: 'assistant',
          content: `## Aide — Arty\n\n**Ce que je sais faire :**\n- Répondre à tes questions sur tous les sujets\n- Analyser des photos et documents (bouton **+**)\n- Analyser ou résumer un e-mail que tu colles, joins ou partages dans le chat\n- Dicter par la voix (bouton **micro**)\n- Gérer ton agenda Google Calendar\n- Faire des recherches web en temps réel\n\nJe n'accède pas à ta boîte mail et je ne peux pas envoyer de message à ta place.\n\n**Commandes :**\n- \`/aide\` — Affiche cette aide`,
          timestamp: Date.now(),
        }
        conv.messages.push(helpMsg, helpResponse)
        conv.updatedAt = Date.now()
        storage.saveConversation(conv)
        refreshConversations()
        return true
      }

      // Cap multi-conv : il ne concerne que les parcours qui démarrent un
      // stream. Les réponses locales ci-dessus restent disponibles même si
      // une autre conversation est déjà en cours.
      if (!canStart(targetId)) {
        setError(i18n.t('errors.tooManyConcurrentStreams'))
        return false
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
        ...(quickAction ? { quickAction } : {}),
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

      // Fact-check ASYNCHRONE (retrait du mode publish-after-fact-check,
      // juillet 2026) : la réponse streame et se publie immédiatement, la
      // vérif tourne ensuite en arrière-plan et RÉTRO-APPLIQUE ses
      // corrections sur le message publié (badge pending → résultat, diff
      // barré→corrigé visible — pas de bascule silencieuse). L'ancien mode
      // retenait la bulle derrière un TypingIndicator pendant génération +
      // vérif (jusqu'à ~45 s) — plainte « fact-check lent ».
      // RGPD (RÈGLE 5.3) — audit Mistral 11 juin 2026 : le fact-checker
      // tourne sur Claude (Anthropic, serveurs US). L'exécuter sur une
      // conversation euOnly enverrait question + réponse (jusqu'à 8 000
      // chars, mails/Drive inclus) hors Europe — violation silencieuse de
      // la promesse « tes données ne quitteront pas l'Europe ». Fact-check
      // désactivé sur les convs EU ; le sheet « ⋯ » l'indique (euLocked).
      // runFactCheckOnLatest re-vérifie euOnly en défense en profondeur.
      const factCheckMode = conv.euOnly ? 'off' : getFactCheckMode()

      // Relecture (audit) — canStart est vérifié plus haut mais des `await`
      // (putFile, createReminder) s'intercalent : le cap peut être atteint
      // entre-temps. Ignorer ce retour lançait un appel LLM orphelin dont le
      // onDone finalisait une bulle assistant VIDE.
      if (!startStream(targetId)) {
        setError(i18n.t('errors.tooManyConcurrentStreams'))
        return true
      }

      const onToken = (token: string) => streamToken(token, targetId)

      const onDone = () => {
        // Signale au PlanBadge de rafraîchir ses compteurs free quotidiens.
        try { window.dispatchEvent(new CustomEvent('arty-message-sent')) } catch {}

        // P1.1 — mémoire automatique : extraction asynchrone des faits durables
        // depuis les messages USER (déjà persistés à ce stade — aucune course
        // avec la finalisation du stream). Fire-and-forget, jamais bloquant,
        // tous les garde-fous (toggle, euOnly, trial, debounce) sont dans le
        // service.
        void maybeExtractMemory(storage.getConversation(targetId))

        // Publication immédiate dans tous les cas.
        streamDone(targetId)

        // Puis vérification en arrière-plan. Les gardes fins (euOnly,
        // réponse interrompue/trop courte, déjà vérifié, quota du jour)
        // vivent dans runFactCheckOnLatest.
        if (factCheckMode !== 'off') {
          void runFactCheckOnLatest(targetId, refreshConversations)
        }
      }

      const onErr = (err: Error) => {
        streamError(err, targetId)
        // P0.7 — cap premium atteint : pas de bandeau rouge ni de redirect
        // muet vers /upgrade. On dispatche un event que CapReachedModal
        // (App.tsx) écoute pour proposer un CHOIX explicite : continuer en
        // standard / +100 messages / attendre le mois prochain.
        if (err.message.includes('premium_cap_reached')) {
          const capErr = err as Error & { capBucket?: string; capLimit?: number }
          try {
            window.dispatchEvent(new CustomEvent('arty-cap-reached', {
              // conversationId : permet au bouton « Relancer sur Mistral » de
              // ne relancer QUE si la conv qui a capé est celle affichée —
              // l'event peut venir d'un stream d'arrière-plan (revue C-D).
              detail: { bucket: capErr.capBucket, cap: capErr.capLimit, conversationId: targetId },
            }))
          } catch { /* contexte sans window (tests) */ }
          return
        }
        // C-D / F-13 — sentinel des clients (refus trial du proxy) traduit au
        // point d'affichage, pas dans le message d'erreur comparé.
        if (err.message === 'trial_model_restricted') {
          if (isActive(targetId)) setError(i18n.t('errors.trialModelRestricted'))
          return
        }
        if (isActive(targetId)) {
          setError(err.message)
        }
      }

      const currentFiles = pendingFilesRef.current
      const hasFiles = !!(currentFiles && currentFiles.length > 0)
      const hasPdf = hasFiles && currentFiles!.some((f) => f.type === 'application/pdf')
      // Décision de routage UNIQUE (refonte routage, étape 2) : euOnly,
      // fichiers, choix manuel et cascade auto vivent désormais dans
      // resolveRoute — même ordre d'invariants qu'avant (RÈGLE 5.3, BUG 12).
      // Calculée sur la requête effective (action rapide + texte), avant
      // enrichissement PDF/hybride,
      // et transmise aux clients via options.routeDecision : anthropicClient
      // ne re-route plus sur un texte contaminé ou du tour précédent.
      const routeInput = gatherRouteInput({
        originalText: modelText,
        hasFiles,
        hasPdf,
        euOnly: !!conv.euOnly,
        hasPrivateHistory: !!conv.hasGoogleData,
      })
      // Une ancienne conversation EU peut survivre à l'expiration d'un
      // abonnement. On bloque alors localement : jamais de fallback Claude
      // hors EU, jamais de requête Mistral vouée au 403.
      if (!canExecuteRoute(routeInput)) {
        onErr(new Error(i18n.t('errors.euPlanRequired')))
        return true
      }
      const routeDecision = resolveRoute(routeInput)
      const provider = routeDecision.provider

      // « Jamais de bascule silencieuse » (stratégie produit) : resolveRoute
      // ne remplit `overrides` QUE quand un choix explicite de l'utilisateur
      // est contredit (fichier → Claude malgré Gemini/OpenAI sélectionné,
      // données privées → Claude, ou mode Europe → Mistral). Toast info
      // non-bloquant — les décisions Auto normales ne toastent jamais.
      notifyRouteOverrides(routeDecision.overrides)

      // Track which models are used in this conversation.
      // Hybride = les DEUX providers (F-5, audit visibilité modèle) : Gemini
      // fait la recherche mais c'est Claude qui RÉDIGE la réponse affichée —
      // n'enregistrer que 'gemini' faussait l'export, le partage public et
      // le point Sidebar (texte attribué à Gemini alors que Claude l'a écrit).
      const usedModels = conv.usedModels || []
      const modelNames = provider === 'hybrid' ? ['gemini', 'claude'] : [provider]
      let usedModelsChanged = false
      for (const modelName of modelNames) {
        if (!usedModels.includes(modelName)) {
          usedModels.push(modelName)
          usedModelsChanged = true
        }
      }
      if (usedModelsChanged) {
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
          new CustomEvent('arty-rebuild-prompt', { detail: { userMessage: modelText } })
        )
      } catch { /* SSR / test env */ }

      // P1.5 — flag les conversations contenant des données Google. Le texte
      // des réponses peut intégrer le contenu d'un mail/fichier lu par un tool ;
      // ce flag déclenche l'avertissement renforcé avant un partage public.
      // Wrappe le handler global pour capter le targetId (que le handler n'a
      // pas) au moment exact de l'appel.
      const trackedToolHandler: ToolHandler = async (name, input) => {
        if (GOOGLE_TOOL_NAMES.has(name)) {
          const c = storage.getConversation(targetId)
          if (c && !c.hasGoogleData) {
            c.hasGoogleData = true
            storage.saveConversation(c)
          }
        }
        const handler = toolHandlerRef.current
        return handler ? handler(name, input) : { result: '' }
      }

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
      let outgoingText = modelText
      if (provider !== 'hybrid') {
        const pdfUrls = extractPdfUrls(text)
        if (pdfUrls.length > 0) {
          setProgressContent('📄 Lecture du PDF...', targetId)
          const pdfSections = await fetchPdfMarkdowns(pdfUrls)
          if (pdfSections) {
            outgoingText = `${outgoingText}\n\n${pdfSections}`
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
        Promise.all([geminiResearch(modelText, undefined, getReflectionLevel()), buildApiMessages(conv.messages)]).then(([research, enrichedMessages]) => {
          // Si l'utilisateur a cliqué Stop PENDANT la recherche Gemini,
          // stopStreaming() a déjà nettoyé le stream. Sans ce garde, le .then
          // démarrerait quand même une génération Claude "zombie" après le Stop.
          if (!hasStream(targetId)) return
          if (research) {
            enrichedMessages[enrichedMessages.length - 1] = {
              role: 'user',
              content: `${modelText}\n\n--- RECHERCHE WEB (données Gemini, à jour) ---\n${research}\n--- FIN RECHERCHE ---\n\nUtilise ces données pour ton rapport. Cite les sources trouvées.`,
            }
          }
          resetAccumulated(targetId)
          setProgressContent('', targetId)
          controller = streamMessage(enrichedMessages, onToken, onDone, onErr, {
            systemPrompt: systemPromptRef.current,
            onToolCall: trackedToolHandler,
            // Niveau de réflexion utilisateur (chat réel uniquement — jamais
            // sur les appels imposés type comparateur/brief). Cf. anthropicClient.
            reflectionLevel: getReflectionLevel(),
            conversationId: targetId,
            // Décision calculée sur le texte ORIGINAL — sans elle, le
            // sous-modèle/thinking se recalculait sur le message enrichi de
            // la recherche Gemini (bug contamination hybride).
            routeDecision,
          })
          setAbortController(targetId, controller)
        }).catch(onErr)
        controller = new AbortController()
      } else if (provider === 'gemini') {
        // Gemini text-only pour l'instant — le multimodal Gemini sera dans
        // une PR future (formats parts/inlineData différents de Claude).
        const apiMessages = await buildTextOnlyMessages(conv.messages)
        if (outgoingText !== modelText) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        controller = streamGeminiMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          reflectionLevel: getReflectionLevel(),
          conversationId: targetId,
          routeReason: routeDecision.reason,
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
          apiMessages[apiMessages.length - 1] = { role: 'user', content: await buildMistralContentBlocks(outgoingText, currentFiles) }
          setPendingFiles(null)
        } else if (outgoingText !== modelText) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        controller = streamMistralMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          onToolCall: trackedToolHandler,
          // Fix 429 — outgoingText ≠ modelText ⇔ du contenu d'URL/PDF a été
          // inliné (lot C) : la recherche forcée serait un appel Mistral
          // de plus pour rien, dos à dos avec la synthèse (rate limit).
          urlContentInlined: outgoingText !== modelText,
          euOnly: conv.euOnly,
          conversationId: targetId,
          routeReason: routeDecision.reason,
          webSearch: routeDecision.webSearch,
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
        if (outgoingText !== modelText && apiMessages.length > 0) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        controller = streamOpenAIMessage(apiMessages, openaiKey, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          conversationId: targetId,
          routeReason: routeDecision.reason,
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
        } else if (outgoingText !== modelText) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: outgoingText }
        }
        // P1.3 — le tool generate_image n'est EXPOSÉ au modèle que si
        // l'utilisateur demande explicitement une image (seule garantie
        // anti-faux-déclenchement, cf. imageTools). euOnly n'atteint jamais ce
        // chemin (forcé sur Mistral) → génération naturellement bloquée en EU.
        const imageTools = wantsImageGeneration(modelText)
          ? [...TOOLS, generateImageToolDefinition]
          : undefined
        controller = streamMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          onToolCall: trackedToolHandler,
          reflectionLevel: getReflectionLevel(),
          conversationId: targetId,
          routeDecision,
          ...(imageTools ? { tools: imageTools as typeof TOOLS } : {}),
        })
      }

      setAbortController(targetId, controller)

      } catch (err) {
        // onErr finalize ce qui a été accumulé, démonte le stream et affiche
        // l'erreur — exactement comme une erreur réseau du client LLM.
        onErr(err instanceof Error ? err : new Error(String(err)))
      }
      return true
    },
    [
      activeId, refreshConversations, canStart, startStream, setActiveStream,
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
      // GC du brouillon composeur associé (mémoire + blob chiffré) — sans
      // cible, il ne serait plus jamais ni restauré ni nettoyé.
      clearConversationComposerDraft(id)
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

  // P1.8 — pose/retire les étiquettes d'une conversation. Liste vide → on
  // stocke `undefined` (pas de tableau vide qui traîne). Même pattern de
  // persistance que renameConversation (save synchrone + refresh).
  const setConversationTags = useCallback(
    (id: string, tags: string[]) => {
      const conv = storage.getConversation(id)
      if (!conv) return
      conv.tags = tags.length > 0 ? tags : undefined
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
        // Un factCheck 'pending' copié ne serait JAMAIS résolu : la vérif en
        // vol ne retouche que l'id original dans la conv source (possible
        // depuis la publication immédiate — le message existe et se branche
        // pendant que sa vérif tourne). On le strippe ; les résultats
        // finalisés, eux, se copient normalement.
        messages: branchedMessages.map(m => {
          const { factCheck, ...rest } = m
          const isPending = factCheck &&
            (factCheck.status === 'pending' || factCheck.modelLabel === 'Vérification en cours…')
          return { ...rest, id: generateId(), ...(factCheck && !isPending ? { factCheck } : {}) }
        }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // Preserve EU flag, model history AND tags from parent conversation
        // (une branche hérite du contexte d'organisation — P1.8).
        ...(conv.euOnly ? { euOnly: true } : {}),
        ...(conv.usedModels ? { usedModels: [...conv.usedModels] } : {}),
        ...(conv.tags ? { tags: [...conv.tags] } : {}),
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

      sendMessage(
        userMsg.content,
        targetId,
        originalFiles,
        userMsg.quickAction ? { quickAction: userMsg.quickAction } : undefined,
      )
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
      sendMessage(
        newContent,
        targetId,
        originalFiles,
        msg.quickAction ? { quickAction: msg.quickAction } : undefined,
      )
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

    sendMessage(
      userMsg.content,
      targetId,
      originalFiles,
      userMsg.quickAction ? { quickAction: userMsg.quickAction } : undefined,
    )
  }, [activeId, refreshConversations, sendMessage])

  // D4 (CDC visibilité modèle) — « Relancer sur Mistral » de CapReachedModal :
  // la modale bascule le sélecteur puis dispatche cet event pour rejouer la
  // question restée sans réponse (le clic explicite vaut consentement — ce
  // n'est PAS une bascule silencieuse). Relance UNIQUEMENT si la conversation
  // qui a capé est celle affichée : l'event cap peut venir d'un stream
  // d'arrière-plan (MAX_CONCURRENT_STREAMS=3) — dans ce cas le switch de
  // modèle s'applique mais on ne rejoue pas le message d'une autre conv.
  useEffect(() => {
    const onRetryLast = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string }>).detail
      if (detail?.conversationId && detail.conversationId !== activeId) return
      retryLastUserMessage()
    }
    window.addEventListener('arty-retry-last', onRetryLast)
    return () => window.removeEventListener('arty-retry-last', onRetryLast)
  }, [activeId, retryLastUserMessage])

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
    setConversationTags,
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
