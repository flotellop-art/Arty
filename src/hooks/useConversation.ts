import { useState, useCallback, useRef, useEffect } from 'react'
import type { Conversation, Message } from '../types'
import { generateId } from '../utils/generateId'
import { streamMessage } from '../services/anthropicClient'
import { streamGeminiMessage, geminiResearch } from '../services/geminiClient'
import { detectProvider } from '../services/aiRouter'
import * as storage from '../services/storage'

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>

export function useConversation() {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    storage.getConversations()
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const systemPromptRef = useRef<string | undefined>(undefined)
  const toolHandlerRef = useRef<ToolHandler | undefined>(undefined)

  // Track active streaming state in refs (survives navigation)
  const streamingRef = useRef<{
    targetId: string
    accumulated: string
    saveInterval: ReturnType<typeof setInterval> | null
  } | null>(null)

  // Track active conversation in ref for streaming callbacks
  const activeIdRef = useRef<string | null>(null)

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null

  const refreshConversations = useCallback(() => {
    setConversations(storage.getConversations())
  }, [])

  // Save partial response to storage
  const savePartial = useCallback(() => {
    const s = streamingRef.current
    if (!s || !s.accumulated) return

    const conv = storage.getConversation(s.targetId)
    if (!conv) return

    // Check if we already added a partial assistant message
    const lastMsg = conv.messages[conv.messages.length - 1]
    if (lastMsg?.role === 'assistant' && lastMsg.id === 'streaming') {
      lastMsg.content = s.accumulated
    } else {
      conv.messages.push({
        id: 'streaming',
        role: 'assistant',
        content: s.accumulated,
        timestamp: Date.now(),
      })
    }
    conv.updatedAt = Date.now()
    storage.saveConversation(conv)
  }, [])

  // Finalize: replace partial with final message
  const finalize = useCallback((targetId: string, content: string) => {
    const conv = storage.getConversation(targetId)
    if (!conv) return

    // Remove partial streaming message if exists
    conv.messages = conv.messages.filter((m) => m.id !== 'streaming')

    // Add final message
    conv.messages.push({
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    })
    conv.updatedAt = Date.now()
    storage.saveConversation(conv)
    refreshConversations()
  }, [refreshConversations])

  // Clean up streaming state
  const cleanupStreaming = useCallback(() => {
    if (streamingRef.current?.saveInterval) {
      clearInterval(streamingRef.current.saveInterval)
    }
    streamingRef.current = null
    setIsStreaming(false)
    setStreamingContent('')
    abortRef.current = null
  }, [])

  // Save partial on app close / page hide
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        savePartial()
      }
    }
    const handleBeforeUnload = () => {
      savePartial()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [savePartial])

  const createConversation = useCallback((): string => {
    const id = generateId()
    const conv: Conversation = {
      id,
      title: 'Nouvelle conversation',
      messages: [],
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
    activeIdRef.current = id
    setActiveId(id)
    setError(null)
  }, [])

  const clearActive = useCallback(() => {
    activeIdRef.current = null
    setActiveId(null)
    setError(null)
  }, [])

  const setSystemPrompt = useCallback((prompt: string | undefined) => {
    systemPromptRef.current = prompt
  }, [])

  const setToolHandler = useCallback((handler: ToolHandler) => {
    toolHandlerRef.current = handler
  }, [])

  const sendMessage = useCallback(
    (text: string, conversationId?: string) => {
      const targetId = conversationId ?? activeId
      if (!targetId) return

      setError(null)

      const conv = storage.getConversation(targetId)
      if (!conv) return

      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: text,
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

      activeIdRef.current = targetId
      setIsStreaming(true)
      setStreamingContent('')

      // Setup streaming ref with auto-save every 3 seconds
      streamingRef.current = {
        targetId,
        accumulated: '',
        saveInterval: setInterval(() => savePartial(), 3000),
      }

      // Only update UI state if user is still on this conversation
      const isActive = () => activeIdRef.current === targetId

      const onToken = (token: string) => {
        if (streamingRef.current) {
          streamingRef.current.accumulated += token
        }
        if (isActive()) {
          setStreamingContent((prev) => prev + token)
        }
      }

      const onDone = () => {
        const content = streamingRef.current?.accumulated || ''
        finalize(targetId, content)
        if (isActive()) {
          setIsStreaming(false)
          setStreamingContent('')
        }
        if (streamingRef.current?.saveInterval) {
          clearInterval(streamingRef.current.saveInterval)
        }
        streamingRef.current = null
        abortRef.current = null
      }

      const onErr = (err: Error) => {
        // Save whatever we have so far
        const content = streamingRef.current?.accumulated
        if (content) {
          finalize(targetId, content + '\n\n⚠️ *Réponse interrompue*')
        }
        if (isActive()) {
          setError(err.message)
          setIsStreaming(false)
          setStreamingContent('')
        }
        if (streamingRef.current?.saveInterval) {
          clearInterval(streamingRef.current.saveInterval)
        }
        streamingRef.current = null
        abortRef.current = null
      }

      const provider = detectProvider(text)
      let controller: AbortController

      if (provider === 'hybrid') {
        setStreamingContent('🔍 Recherche en cours (Gemini)...')
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
          if (streamingRef.current) {
            streamingRef.current.accumulated = ''
          }
          setStreamingContent('')
          controller = streamMessage(enrichedMessages, onToken, onDone, onErr, {
            systemPrompt: systemPromptRef.current,
            onToolCall: toolHandlerRef.current,
          })
          abortRef.current = controller
        }).catch(onErr)
        controller = new AbortController()
      } else if (provider === 'gemini') {
        const apiMessages = conv.messages.map((m) => ({ role: m.role, content: m.content }))
        controller = streamGeminiMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
        })
      } else {
        const apiMessages = conv.messages.map((m) => ({ role: m.role, content: m.content }))
        controller = streamMessage(apiMessages, onToken, onDone, onErr, {
          systemPrompt: systemPromptRef.current,
          onToolCall: toolHandlerRef.current,
        })
      }

      abortRef.current = controller
    },
    [activeId, refreshConversations, savePartial, finalize, cleanupStreaming]
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

  const stopStreaming = useCallback(() => {
    // Save partial before stopping
    const content = streamingRef.current?.accumulated
    const targetId = streamingRef.current?.targetId
    if (content && targetId) {
      finalize(targetId, content + '\n\n⚠️ *Réponse arrêtée*')
    }
    if (abortRef.current) {
      abortRef.current.abort()
    }
    cleanupStreaming()
  }, [finalize, cleanupStreaming])

  return {
    conversations,
    activeConversation,
    activeId,
    isStreaming,
    streamingContent,
    error,
    createConversation,
    selectConversation,
    clearActive,
    sendMessage,
    deleteConversation: deleteConv,
    stopStreaming,
    setSystemPrompt,
    setToolHandler,
  }
}
