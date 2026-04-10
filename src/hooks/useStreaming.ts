import { useState, useCallback, useRef, useEffect } from 'react'
import { generateId } from '../utils/generateId'
import * as storage from '../services/storage'

export function useStreaming(deps: {
  refreshConversations: () => void
}) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Track active streaming state in refs (survives navigation)
  const streamingRef = useRef<{
    targetId: string
    accumulated: string
    saveInterval: ReturnType<typeof setInterval> | null
  } | null>(null)

  // Track active conversation in ref for streaming callbacks
  const activeIdRef = useRef<string | null>(null)

  // Save partial response to storage
  const savePartial = useCallback(() => {
    const s = streamingRef.current
    if (!s || !s.accumulated) return

    const conv = storage.getConversation(s.targetId)
    if (!conv) return

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

    conv.messages = conv.messages.filter((m) => m.id !== 'streaming')
    conv.messages.push({
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    })
    conv.updatedAt = Date.now()
    storage.saveConversation(conv)
    deps.refreshConversations()
  }, [deps])

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

  const startStream = useCallback((targetId: string) => {
    activeIdRef.current = targetId
    setIsStreaming(true)
    setStreamingContent('')

    streamingRef.current = {
      targetId,
      accumulated: '',
      saveInterval: setInterval(() => savePartial(), 3000),
    }
  }, [savePartial])

  const isActive = useCallback((targetId: string) => {
    return activeIdRef.current === targetId
  }, [])

  const onToken = useCallback((token: string, targetId: string) => {
    if (streamingRef.current) {
      streamingRef.current.accumulated += token
    }
    if (activeIdRef.current === targetId) {
      setStreamingContent((prev) => prev + token)
    }
  }, [])

  const onDone = useCallback((targetId: string) => {
    const content = streamingRef.current?.accumulated || ''
    finalize(targetId, content)
    if (activeIdRef.current === targetId) {
      setIsStreaming(false)
      setStreamingContent('')
    }
    if (streamingRef.current?.saveInterval) {
      clearInterval(streamingRef.current.saveInterval)
    }
    streamingRef.current = null
    abortRef.current = null
  }, [finalize])

  const onError = useCallback((err: Error, targetId: string) => {
    const content = streamingRef.current?.accumulated
    if (content) {
      finalize(targetId, content + '\n\n⚠️ *Réponse interrompue*')
    }
    if (activeIdRef.current === targetId) {
      setIsStreaming(false)
      setStreamingContent('')
    }
    if (streamingRef.current?.saveInterval) {
      clearInterval(streamingRef.current.saveInterval)
    }
    streamingRef.current = null
    abortRef.current = null
    return err
  }, [finalize])

  const stopStreaming = useCallback(() => {
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
    isStreaming,
    streamingContent,
    abortRef,
    activeIdRef,
    streamingRef,
    startStream,
    isActive,
    onToken,
    onDone,
    onError,
    stopStreaming,
    setStreamingContent,
    savePartial,
    finalize,
    cleanupStreaming,
  }
}
