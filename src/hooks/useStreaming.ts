import { useState, useCallback, useRef, useEffect } from 'react'
import { generateId } from '../utils/generateId'
import * as storage from '../services/storage'

export function useStreaming(deps: {
  refreshConversations: () => void
}) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Si true, onToken accumule en background mais N'AFFICHE PAS les tokens
  // en live. Utilisé par le flow "publish-after-fact-check" pour cacher
  // la réponse non vérifiée jusqu'à la fin du fact-check — on garde
  // l'accumulation pour savePartial et pour le finalize final.
  const hideContentRef = useRef(false)

  const setHideContent = useCallback((hide: boolean) => {
    hideContentRef.current = hide
    if (hide) setStreamingContent('')
  }, [])

  // Track active streaming state in refs (survives navigation)
  const streamingRef = useRef<{
    targetId: string
    accumulated: string
    saveInterval: ReturnType<typeof setInterval> | null
  } | null>(null)

  // Track active conversation in ref for streaming callbacks
  const activeIdRef = useRef<string | null>(null)

  // CRIT-7 (audit étape 6) — throttle des setState par token via RAF.
  // Avant : 1000 tokens = 1000 setState = 1000 re-renders React + 1000
  // reparse Markdown (avec MarkdownRenderer non mémo'ed). Sur Pixel 6A
  // ou iPhone 11, le chat freezait visiblement pendant les longues réponses.
  // Maintenant : on accumule dans le ref, et on flush au max 1× par frame
  // (~16ms = ~60fps) avec la valeur accumulée la plus récente.
  const pendingFlushRef = useRef<number | null>(null)

  const cancelPendingFlush = useCallback(() => {
    if (pendingFlushRef.current !== null) {
      cancelAnimationFrame(pendingFlushRef.current)
      pendingFlushRef.current = null
    }
  }, [])

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
  const finalize = useCallback((targetId: string, content: string, interrupted?: boolean) => {
    const conv = storage.getConversation(targetId)
    if (!conv) return

    conv.messages = conv.messages.filter((m) => m.id !== 'streaming')
    conv.messages.push({
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      ...(interrupted ? { interrupted: true } : {}),
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
    cancelPendingFlush()
    streamingRef.current = null
    setIsStreaming(false)
    setStreamingContent('')
    abortRef.current = null
  }, [cancelPendingFlush])

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
    if (activeIdRef.current !== targetId || hideContentRef.current) return
    // CRIT-7 — schedule un flush RAF si pas déjà pending. Le flush lit
    // streamingRef.accumulated (toujours frais) au moment de la frame,
    // pas la valeur au moment du schedule → on coalesce plusieurs tokens
    // en un seul setState par frame.
    if (pendingFlushRef.current !== null) return
    pendingFlushRef.current = requestAnimationFrame(() => {
      pendingFlushRef.current = null
      const s = streamingRef.current
      if (s && activeIdRef.current === targetId && !hideContentRef.current) {
        setStreamingContent(s.accumulated)
      }
    })
  }, [])

  // Marque la fin du stream SANS finalize. Garde le placeholder `streaming`
  // en place, garde isStreaming=true pour que l'UI continue à montrer un
  // loader (TypingIndicator). Le caller fera le finalize après le fact-check.
  // Différent de onDone qui finalize immédiatement.
  const markStreamDone = useCallback((targetId: string): string => {
    const content = streamingRef.current?.accumulated || ''
    if (streamingRef.current?.saveInterval) {
      clearInterval(streamingRef.current.saveInterval)
      streamingRef.current.saveInterval = null
    }
    cancelPendingFlush()
    if (activeIdRef.current === targetId) {
      setStreamingContent('')
    }
    abortRef.current = null
    return content
  }, [cancelPendingFlush])

  // Cleanup final après publish manuel (finalize appelé par le caller).
  // Reset isStreaming et streamingRef. À appeler après markStreamDone +
  // finalize manuel pour libérer l'état de streaming.
  const completeStreaming = useCallback((targetId: string) => {
    if (activeIdRef.current === targetId) {
      setIsStreaming(false)
      setStreamingContent('')
    }
    streamingRef.current = null
    hideContentRef.current = false
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
    cancelPendingFlush()
    streamingRef.current = null
    abortRef.current = null
  }, [finalize, cancelPendingFlush])

  const onError = useCallback((err: Error, targetId: string) => {
    const content = streamingRef.current?.accumulated
    if (content) {
      finalize(targetId, content, true)
    }
    if (activeIdRef.current === targetId) {
      setIsStreaming(false)
      setStreamingContent('')
    }
    if (streamingRef.current?.saveInterval) {
      clearInterval(streamingRef.current.saveInterval)
    }
    cancelPendingFlush()
    streamingRef.current = null
    abortRef.current = null
    return err
  }, [finalize, cancelPendingFlush])

  const stopStreaming = useCallback(() => {
    const content = streamingRef.current?.accumulated
    const targetId = streamingRef.current?.targetId
    if (content && targetId) {
      finalize(targetId, content, true)
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
    setHideContent,
    markStreamDone,
    completeStreaming,
  }
}
