import { useState, useCallback, useEffect, useRef } from 'react'
import type { Conversation, Message, FileAttachment } from '../types'
import { generateId } from '../utils/generateId'
import { streamMessage } from '../services/anthropicClient'
import { streamGeminiMessage, geminiResearch } from '../services/geminiClient'
import { streamMistralMessage } from '../services/mistralClient'
import { sendMessageStream as streamOpenAIMessage } from '../services/openaiClient'
import { getOpenAIKey } from '../services/activeApiKey'
import { detectProvider } from '../services/aiRouter'
import * as storage from '../services/storage'
import { useStreaming } from './useStreaming'
import { useFileAttachments, buildApiMessages, buildContentBlocks, buildTextOnlyMessages, buildMistralMessages } from './useFileAttachments'
import { putFile } from '../services/secureFileStorage'
import { runFactCheckOnLatest, factCheckContent, getFactCheckMode } from '../services/factChecker'
import { detectSuggestedTasks, addTask } from '../services/taskService'

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>

export function useConversation() {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    storage.getConversations()
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const systemPromptRef = useRef<string | undefined>(undefined)
  const toolHandlerRef = useRef<ToolHandler | undefined>(undefined)

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null

  const refreshConversations = useCallback(() => {
    setConversations(storage.getConversations())
  }, [])

  const streaming = useStreaming({ refreshConversations })
  const fileAttachments = useFileAttachments()

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
    setActiveId(id)
    setError(null)
    return id
  }, [refreshConversations])

  const selectConversation = useCallback((id: string) => {
    streaming.activeIdRef.current = id
    setActiveId(id)
    setError(null)
  }, [streaming])

  const clearActive = useCallback(() => {
    streaming.activeIdRef.current = null
    setActiveId(null)
    setError(null)
  }, [streaming])

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
      if (!conv) return

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
              return f
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
      if (conv.messages.length === 1) {
        conv.title = text.slice(0, 50) + (text.length > 50 ? '...' : '')
      }
      conv.updatedAt = Date.now()
      storage.saveConversation(conv)
      refreshConversations()
      setActiveId(targetId)

      fileAttachments.setPendingFiles((files && files.length > 0) ? files : null)

      // Mode "publish-after-fact-check" : si fact-check actif, on cache
      // les tokens en live (TypingIndicator au lieu de bulle stream) et on
      // retarde le finalize jusqu'à la fin du fact-check. Évite à
      // l'utilisateur de voir la version non vérifiée. Mode 'off' garde
      // l'ancien flow streaming visible + fact-check async.
      const factCheckMode = getFactCheckMode()
      const deferPublish = factCheckMode !== 'off'

      streaming.setHideContent(deferPublish)
      streaming.startStream(targetId)

      const onToken = (token: string) => streaming.onToken(token, targetId)

      const onDone = async () => {
        // Signale au PlanBadge de rafraîchir ses compteurs free quotidiens.
        try { window.dispatchEvent(new CustomEvent('arty-message-sent')) } catch {}

        if (!deferPublish) {
          // Mode 'off' : publication immédiate, pas de fact-check.
          streaming.onDone(targetId)
          return
        }

        // Mode fact-check actif : retient le placeholder, lance la vérif,
        // puis publie la bulle finale avec contenu corrigé d'un coup.
        const content = streaming.markStreamDone(targetId)

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
          streaming.finalize(targetId, content)
          streaming.completeStreaming(targetId)
          if (content) void runFactCheckOnLatest(targetId, refreshConversations)
          return
        }

        const fc = await factCheckContent(userMsg.content, content, factCheckMode)
        const finalContent = fc?.correctedContent || content

        // Publie la bulle finale. finalize crée un message avec un nouvel
        // ID — on attache le factCheck juste après via une lecture/écriture
        // de la conv.
        streaming.finalize(targetId, finalContent)
        if (fc?.result) {
          const fresh = storage.getConversation(targetId)
          if (fresh) {
            const last = fresh.messages[fresh.messages.length - 1]
            if (last && last.role === 'assistant') {
              last.factCheck = fc.result
              storage.saveConversation(fresh)
              refreshConversations()
            }
          }
        } else {
          // Fact-check a échoué / timeout — publie quand même avec un badge
          // d'indisponibilité pour pas laisser le placeholder gelé.
          const fresh = storage.getConversation(targetId)
          if (fresh) {
            const last = fresh.messages[fresh.messages.length - 1]
            if (last && last.role === 'assistant') {
              last.factCheck = {
                overallConfidence: 'medium',
                claims: [],
                modelLabel: '⚠ Fact-check indisponible',
                checkedAt: Date.now(),
              }
              storage.saveConversation(fresh)
              refreshConversations()
            }
          }
        }
        streaming.completeStreaming(targetId)
      }

      const onErr = (err: Error) => {
        streaming.onError(err, targetId)
        if (streaming.isActive(targetId)) {
          setError(err.message)
        }
      }

      const currentFiles = fileAttachments.pendingFilesRef.current
      // EU-only conversations always use Mistral (data stays in Europe)
      const provider = conv.euOnly
        ? 'mistral' as const
        : (currentFiles && currentFiles.length > 0) ? 'claude' as const : detectProvider(text)

      // Track which models are used in this conversation
      const usedModels = conv.usedModels || []
      const modelName = provider === 'hybrid' ? 'gemini' : provider
      if (!usedModels.includes(modelName)) {
        usedModels.push(modelName)
        conv.usedModels = usedModels
        storage.saveConversation(conv)
      }

      let controller: AbortController

      if (provider === 'hybrid') {
        streaming.setStreamingContent('🔍 Recherche en cours (Gemini)...')
        Promise.all([geminiResearch(text), buildApiMessages(conv.messages)]).then(([research, enrichedMessages]) => {
          if (research) {
            enrichedMessages[enrichedMessages.length - 1] = {
              role: 'user',
              content: `${text}\n\n--- RECHERCHE WEB (données Gemini, à jour) ---\n${research}\n--- FIN RECHERCHE ---\n\nUtilise ces données pour ton rapport. Cite les sources trouvées.`,
            }
          }
          if (streaming.streamingRef.current) {
            streaming.streamingRef.current.accumulated = ''
          }
          streaming.setStreamingContent('')
          controller = streamMessage(enrichedMessages, onToken, onDone, onErr, {
            systemPrompt: systemPromptRef.current,
            onToolCall: toolHandlerRef.current,
          })
          streaming.abortRef.current = controller
        }).catch(onErr)
        controller = new AbortController()
      } else if (provider === 'gemini') {
        // Gemini text-only pour l'instant — le multimodal Gemini sera dans
        // une PR future (formats parts/inlineData différents de Claude).
        const apiMessages = await buildTextOnlyMessages(conv.messages)
        controller = streamGeminiMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
        })
      } else if (provider === 'mistral') {
        // Mistral Medium 3.5 a une vision native → on utilise le builder
        // multimodal pour passer les images en image_url. Indispensable pour
        // que les conversations euOnly puissent analyser des images sans
        // sortir d'EU vers Claude/Gemini.
        const apiMessages = await buildMistralMessages(conv.messages)
        controller = streamMistralMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          onToolCall: toolHandlerRef.current,
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
          apiMessages[apiMessages.length - 1] = { role: 'user', content: await buildContentBlocks(text, currentFiles) }
          fileAttachments.setPendingFiles(null)
        }
        controller = streamMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          onToolCall: toolHandlerRef.current,
        })
      }

      streaming.abortRef.current = controller
    },
    [activeId, refreshConversations, streaming, fileAttachments]
  )

  const deleteConv = useCallback(
    (id: string) => {
      storage.deleteConversation(id)
      refreshConversations()
      if (activeId === id) {
        setActiveId(null)
      }
    },
    [activeId, refreshConversations]
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
      msg.pinned = !msg.pinned
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

  return {
    conversations,
    activeConversation,
    activeId,
    isStreaming: streaming.isStreaming,
    streamingContent: streaming.streamingContent,
    error,
    createConversation,
    selectConversation,
    clearActive,
    sendMessage,
    deleteConversation: deleteConv,
    branchConversation,
    stopStreaming: streaming.stopStreaming,
    setSystemPrompt,
    setToolHandler,
    togglePinMessage,
    editAndResend,
    retryMessage,
  }
}
