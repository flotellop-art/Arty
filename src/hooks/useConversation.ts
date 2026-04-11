import { useState, useCallback, useRef } from 'react'
import type { Conversation, Message, FileAttachment } from '../types'
import { generateId } from '../utils/generateId'
import { streamMessage } from '../services/anthropicClient'
import { streamGeminiMessage, geminiResearch } from '../services/geminiClient'
import { streamMistralMessage } from '../services/mistralClient'
import { detectProvider } from '../services/aiRouter'
import * as storage from '../services/storage'
import { useStreaming } from './useStreaming'
import { useFileAttachments, buildApiMessages, buildContentBlocks } from './useFileAttachments'

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

  const createConversation = useCallback((withWelcome?: boolean): string => {
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

    const conv: Conversation = {
      id,
      title: 'Nouvelle conversation',
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
    (text: string, conversationId?: string, files?: FileAttachment[]) => {
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

      const displayContent = files?.length ? `${text}\n\n📎 ${files.map(f => f.name).join(', ')}` : text

      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: displayContent,
        timestamp: Date.now(),
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

      streaming.startStream(targetId)

      const onToken = (token: string) => streaming.onToken(token, targetId)

      const onDone = () => streaming.onDone(targetId)

      const onErr = (err: Error) => {
        streaming.onError(err, targetId)
        if (streaming.isActive(targetId)) {
          setError(err.message)
        }
      }

      const currentFiles = fileAttachments.pendingFilesRef.current
      const provider = (currentFiles && currentFiles.length > 0) ? 'claude' as const : detectProvider(text)

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
        geminiResearch(text).then((research) => {
          const enrichedMessages = conv.messages.map((m) => ({
            role: m.role,
            content: m.content,
          }))
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
        const apiMessages = buildApiMessages(conv.messages)
        controller = streamGeminiMessage(apiMessages as Array<{ role: string; content: string }>, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
        })
      } else if (provider === 'mistral') {
        const apiMessages = conv.messages.map((m) => ({ role: m.role, content: m.content }))
        controller = streamMistralMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
        })
      } else {
        const apiMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = conv.messages.map((m) => {
          return { role: m.role, content: m.content }
        })
        if (currentFiles && currentFiles.length > 0) {
          apiMessages[apiMessages.length - 1] = { role: 'user', content: buildContentBlocks(text, currentFiles) }
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
      }
      storage.saveConversation(newConv)
      refreshConversations()
      return newId
    },
    [refreshConversations]
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
  }
}
