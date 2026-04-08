import { useState, useCallback, useRef } from 'react'
import type { Conversation, Message } from '../types'
import { generateId } from '../utils/generateId'
import { streamMessage } from '../services/anthropicClient'
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

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null

  const refreshConversations = useCallback(() => {
    setConversations(storage.getConversations())
  }, [])

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
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsStreaming(false)
    setStreamingContent('')
    setActiveId(id)
    setError(null)
  }, [])

  const clearActive = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsStreaming(false)
    setStreamingContent('')
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

      setIsStreaming(true)
      setStreamingContent('')

      let accumulated = ''

      const apiMessages = conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const controller = streamMessage(
        apiMessages,
        (token) => {
          accumulated += token
          setStreamingContent(accumulated)
        },
        () => {
          const assistantMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: accumulated,
            timestamp: Date.now(),
          }

          const latest = storage.getConversation(targetId)
          if (latest) {
            latest.messages.push(assistantMessage)
            latest.updatedAt = Date.now()
            storage.saveConversation(latest)
            refreshConversations()
          }

          setIsStreaming(false)
          setStreamingContent('')
          abortRef.current = null
        },
        (err) => {
          setError(err.message)
          setIsStreaming(false)
          setStreamingContent('')
          abortRef.current = null
        },
        {
          systemPrompt: systemPromptRef.current,
          onToolCall: toolHandlerRef.current,
        }
      )

      abortRef.current = controller
    },
    [activeId, refreshConversations]
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
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsStreaming(false)
    setStreamingContent('')
  }, [])

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
