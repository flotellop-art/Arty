import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { generateId } from '../utils/generateId'
import * as storage from '../services/storage'
import type { ModelUsedEvent } from '../services/modelLabels'
import type { ProjectTurn } from '../services/projects/chatPolicy'
import { getActiveUserId, getActiveSessionEpoch } from '../services/userSession'
import { EMPTY_GENERATED_IMAGES, isGeneratedImageId, MAX_GENERATED_IMAGES_PER_TURN } from '../services/generatedImages'
import { onLocalDataInvalidated } from '../services/localDataInvalidation'
import { PROJECT_ERASURE_FENCE_KEY } from '../services/userSession'

// Cap de streams concurrents — protège des coûts d'abus (8 convs ouvertes en
// même temps = 8 appels LLM en // sur le compte du proprio). 3 suffit largement
// pour l'usage "je lance un long brief pendant que je discute autre part".
export const MAX_CONCURRENT_STREAMS = 3

export interface ExternalStreamLifecycle {
  flush(): boolean
  cancel(reason: 'stop' | 'discard' | 'unmount'): void
}
export interface ExternalStreamLease {
  invocationId: string
  isCurrent(): boolean
  release(): void
}

type StreamState = {
  external?: ExternalStreamLifecycle
  generatedImages: string[]
  projectTurn?: ProjectTurn
  targetId: string
  invocationId: string
  accumulated: string
  saveInterval: ReturnType<typeof setInterval> | null
  abortController: AbortController | null
  assertCurrent?: () => void
  // CDC visibilité modèle (C-B) — model id de CE stream, capturé via l'event
  // 'arty-model-used' scopé conversationId (voir listener plus bas). Un event
  // `confirmed` (modèle servi ≠ demandé) écrase la valeur optimiste — c'est
  // la vérité serveur qui est persistée à finalize(). JAMAIS lu depuis le
  // cache global getLastModelUsed() : sous MAX_CONCURRENT_STREAMS=3, il peut
  // refléter le stream d'une AUTRE conversation.
  model?: string
  requestedModel?: string
  modelSource?: ModelUsedEvent['source']
  // Raison du routage (refonte routage, étape 4) — code machine porté par le
  // même event, persisté sur le Message à finalize() pour que le footer
  // affiche POURQUOI ce modèle, même sur l'historique.
  reasonCode?: string
  // Raison de la sous-décision Claude, distincte de la raison du provider.
  subModelReasonCode?: string
}

export function useStreaming(deps: {
  refreshConversations: () => void
}) {
  // H2 (audit frontend) — `deps` est un objet littéral recréé à chaque render
  // par l'appelant. S'il entrait dans les deps de `finalize`, toute la chaîne
  // de callbacks (onDone, onError, stopStreaming…) changerait d'identité à
  // chaque frame de streaming → les memo de MessageItem/Sidebar seraient
  // court-circuités. On le lit via une ref toujours fraîche à la place.
  const depsRef = useRef(deps)
  depsRef.current = deps
  // L'UI ne montre QUE la conversation active. isStreaming et streamingContent
  // reflètent l'état de la conv actuellement affichée (via activeIdRef). Les
  // autres streams en cours continuent en arrière-plan dans streamsRef.
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingImages, setStreamingImages] = useState<readonly string[]>(EMPTY_GENERATED_IMAGES)

  // Set des convIds en cours de streaming — exposé pour la Sidebar (indicateur
  // "en cours de réflexion" sur chaque conv concernée).
  const [streamingConvIds, setStreamingConvIds] = useState<ReadonlySet<string>>(() => new Set())

  // Map de tous les streams en cours, indexée par convId. Stocke l'accumulé,
  // l'interval de savePartial et l'AbortController par conv.
  // Hors React state pour éviter un re-render de toute l'app à chaque token.
  const streamsRef = useRef<Map<string, StreamState>>(new Map())

  // Conv actuellement affichée. Synchronisée par setActiveStream depuis
  // selectConversation/clearActive. Indique quel stream rendre dans l'UI live.
  const activeIdRef = useRef<string | null>(null)

  // CRIT-7 (audit) — throttle des setState par token via RAF. Un seul RAF
  // pending pour la conv active. Les streams non-affichés n'allouent pas de
  // RAF (leur accumulé continue d'arriver dans le ref, sans re-render).
  const pendingFlushRef = useRef<number | null>(null)

  const cancelPendingFlush = useCallback(() => {
    if (pendingFlushRef.current !== null) {
      cancelAnimationFrame(pendingFlushRef.current)
      pendingFlushRef.current = null
    }
  }, [])

  // Sauvegarde partielle d'un stream précis (appelé périodiquement par
  // saveInterval, et au beforeunload pour tous les streams ouverts).
  const savePartialFor = useCallback((s: StreamState) => {
    try { s.assertCurrent?.() } catch {
      try { s.external?.cancel('discard') } catch { /* Other streams still need cleanup. */ }
      try { s.abortController?.abort() } catch { /* already aborted */ }
      return false
    }
    if (s.external) {
      try { return s.external.flush() } catch {
        try { s.external.cancel('stop') } catch { /* Caller tears down this exact state. */ }
        return false
      }
    }
    if (!s.accumulated && !s.generatedImages.length) return true
    const stored = storage.getConversation(s.targetId)
    if (!stored || !storage.isCacheReady()) return false
    // Copy-on-write: a quota failure must not publish a phantom receipt in RAM.
    const conv = { ...stored, messages: stored.messages.map(m => ({ ...m })) }

    const lastMsg = conv.messages[conv.messages.length - 1]
    if (lastMsg?.role === 'assistant' && lastMsg.id === 'streaming') {
      lastMsg.content = s.accumulated
      if (s.generatedImages.length) lastMsg.generatedImages = [...s.generatedImages]
      // C-B — porte l'attribution sur le partiel : si l'app est tuée en plein
      // stream, le message restauré au boot garde son modèle (revue Opus).
      if (s.model) lastMsg.model = s.model
      if (s.requestedModel) lastMsg.requestedModel = s.requestedModel
      if (s.modelSource) lastMsg.modelSource = s.modelSource
      if (s.reasonCode) lastMsg.reasonCode = s.reasonCode
      if (s.subModelReasonCode) lastMsg.subModelReasonCode = s.subModelReasonCode
      if (s.projectTurn) lastMsg.projectTurn = structuredClone(s.projectTurn)
    } else {
      conv.messages.push({
        id: 'streaming',
        role: 'assistant',
        content: s.accumulated,
        timestamp: Date.now(),
        ...(s.generatedImages.length ? { generatedImages: [...s.generatedImages] } : {}),
        ...(s.model ? { model: s.model } : {}),
        ...(s.requestedModel ? { requestedModel: s.requestedModel } : {}),
        ...(s.modelSource ? { modelSource: s.modelSource } : {}),
        ...(s.reasonCode ? { reasonCode: s.reasonCode } : {}),
        ...(s.subModelReasonCode ? { subModelReasonCode: s.subModelReasonCode } : {}),
        ...(s.projectTurn ? { projectTurn: structuredClone(s.projectTurn) } : {}),
      })
    }
    conv.updatedAt = Date.now()
    try { storage.saveConversation(conv); return true } catch { return false }
  }, [])

  // Finalise une conv : remplace le placeholder `streaming` par le message final.
  const finalize = useCallback((targetId: string, content: string, interrupted?: boolean) => {
    try { streamsRef.current.get(targetId)?.assertCurrent?.() } catch { return }
    const stored = storage.getConversation(targetId)
    if (!stored || !storage.isCacheReady()) return
    const conv = { ...stored, messages: [...stored.messages] }

    // C-B — attribution du modèle : lue dans le StreamState de CE targetId
    // (encore présent : tous les appelants font finalize AVANT teardown).
    const s = streamsRef.current.get(targetId)
    const model = s?.model
    const reasonCode = s?.reasonCode
    const subModelReasonCode = s?.subModelReasonCode

    conv.messages = conv.messages.filter((m) => m.id !== 'streaming')
    conv.messages.push({
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      ...(s?.generatedImages.length ? { generatedImages: [...s.generatedImages] } : {}),
      ...(interrupted ? { interrupted: true } : {}),
      ...(model ? { model } : {}),
      ...(s?.requestedModel ? { requestedModel: s.requestedModel } : {}),
      ...(s?.modelSource ? { modelSource: s.modelSource } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      ...(subModelReasonCode ? { subModelReasonCode } : {}),
      ...(s?.projectTurn ? { projectTurn: structuredClone(s.projectTurn) } : {}),
    })
    conv.updatedAt = Date.now()
    try { storage.saveConversation(conv) } catch { return }
    depsRef.current.refreshConversations()
  }, [])

  // Retire un convId du Set des streams actifs (déclenche re-render Sidebar).
  const removeFromStreamingSet = useCallback((targetId: string) => {
    setStreamingConvIds((prev) => {
      if (!prev.has(targetId)) return prev
      const next = new Set(prev)
      next.delete(targetId)
      return next
    })
  }, [])

  // Nettoyage d'un stream : clearInterval, suppression du ref, et reset UI
  // si la conv concernée était celle affichée.
  const teardownStream = useCallback((targetId: string) => {
    const s = streamsRef.current.get(targetId)
    if (s?.saveInterval) {
      clearInterval(s.saveInterval)
      s.saveInterval = null
    }
    streamsRef.current.delete(targetId)
    removeFromStreamingSet(targetId)
    if (activeIdRef.current === targetId) {
      cancelPendingFlush()
      setIsStreaming(false)
      setStreamingContent('')
      setStreamingImages(EMPTY_GENERATED_IMAGES)
    }
  }, [cancelPendingFlush, removeFromStreamingSet])

  // Backward-compat : flush all streams, discarding invalid sessions without
  // leaving a ghost stream/interval after its controller has been aborted.
  const savePartialAll = useCallback(() => {
    for (const s of streamsRef.current.values()) {
      if (savePartialFor(s) === false) {
        s.abortController?.abort()
        if (streamsRef.current.get(s.targetId) === s) teardownStream(s.targetId)
      }
    }
  }, [savePartialFor, teardownStream])

  // CDC visibilité modèle (C-B) — capture le model id de chaque stream depuis
  // l'event 'arty-model-used' scopé conversationId (posé par les clients IA
  // depuis la PR C-A). Écriture SYNCHRONE dans le StreamState pendant le
  // stream → finalize() reste synchrone (BUG 16). Les events background
  // (brief, résumé, comparateur) et ceux sans conversationId sont ignorés :
  // sans conversationId on ne peut pas attribuer au bon stream concurrent.
  useEffect(() => {
    const onModelUsed = (e: Event) => {
      const detail = (e as CustomEvent<ModelUsedEvent>).detail
      if (!detail?.model || detail.background || !detail.conversationId) return
      const s = streamsRef.current.get(detail.conversationId)
      if (s && detail.invocationId === s.invocationId) {
        try { s.assertCurrent?.() } catch { return }
        s.model = detail.model
        if (detail.requestedModel) s.requestedModel = detail.requestedModel
        if (detail.source) s.modelSource = detail.source
        // Seulement si présent : un event `confirmed` sans reason (swap
        // serveur) ne doit pas effacer la raison du dispatch optimiste.
        if (detail.reason?.code) s.reasonCode = detail.reason.code
        if (detail.subModelReason?.code) s.subModelReasonCode = detail.subModelReason.code
      }
    }
    window.addEventListener('arty-model-used', onModelUsed)
    return () => window.removeEventListener('arty-model-used', onModelUsed)
  }, [])

  // Save partial on app close / page hide — flush TOUS les streams ouverts,
  // pas juste la conv active. Sans ça, fermer l'onglet pendant qu'un stream
  // tournait en arrière-plan perdrait son contenu accumulé.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') savePartialAll()
    }
    const handleBeforeUnload = () => savePartialAll()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handleBeforeUnload)
    }
  }, [savePartialAll])

  // Démarre un nouveau stream pour une conv. Retourne false si le cap de
  // concurrence est atteint — le caller doit alors annuler son envoi.
  const startStream = useCallback((targetId: string, assertCurrent?: () => void, external?: ExternalStreamLifecycle): boolean => {
    if (streamsRef.current.has(targetId)) {
      // Stream déjà en cours pour cette conv → impossible d'en démarrer un
      // second (l'UI bloque déjà via isStreaming, mais défense en profondeur).
      return false
    }
    if (streamsRef.current.size >= MAX_CONCURRENT_STREAMS) {
      return false
    }

    const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
    const s: StreamState = {
      external,
      targetId,
      invocationId: generateId(),
      accumulated: '',
      generatedImages: [],
      saveInterval: setInterval(() => {
        const cur = streamsRef.current.get(targetId)
        if (cur && savePartialFor(cur) === false) {
          cur.abortController?.abort()
          if (streamsRef.current.get(targetId) === cur) teardownStream(targetId)
        }
      }, 3000),
      abortController: null,
      assertCurrent: () => {
        if (owner !== getActiveUserId() || epoch !== getActiveSessionEpoch()) throw new DOMException('Account changed', 'AbortError')
        assertCurrent?.()
      },
    }
    streamsRef.current.set(targetId, s)
    setStreamingConvIds((prev) => {
      const next = new Set(prev)
      next.add(targetId)
      return next
    })
    if (activeIdRef.current === targetId) {
      setIsStreaming(true)
      setStreamingContent('')
      setStreamingImages(EMPTY_GENERATED_IMAGES)
    }
    return true
  }, [savePartialFor, teardownStream])

  /** Same cap/Stop/page lifecycle as chat. Handles are tied to the actual
   * StreamState, so a late release never touches a replacement invocation. */
  const reserveExternalStreams = useCallback((entries: Array<{
    id: string; assertCurrent(): void; lifecycle: ExternalStreamLifecycle
  }>): ExternalStreamLease[] | null => {
    if (!entries.length || new Set(entries.map(e => e.id)).size !== entries.length ||
        entries.some(e => streamsRef.current.has(e.id)) || streamsRef.current.size + entries.length > MAX_CONCURRENT_STREAMS) return null
    entries.forEach(e => e.assertCurrent())
    // A guard must not be able to make the earlier capacity check stale.
    if (entries.some(e => streamsRef.current.has(e.id)) || streamsRef.current.size + entries.length > MAX_CONCURRENT_STREAMS) return null
    return entries.map(entry => {
      startStream(entry.id, entry.assertCurrent, entry.lifecycle)
      const state = streamsRef.current.get(entry.id)!
      return { invocationId: state.invocationId, isCurrent: () => streamsRef.current.get(entry.id) === state,
        release: () => { if (streamsRef.current.get(entry.id) === state) teardownStream(entry.id) } }
    })
  }, [startStream, teardownStream])

  const setProjectTurn = useCallback((targetId: string, turn: ProjectTurn) => {
    const state = streamsRef.current.get(targetId)
    if (state) { state.assertCurrent?.(); state.projectTurn = structuredClone(turn) }
  }, [])

  /** Commit the local receipt to the synchronous crash-safety net before continuation. */
  const adoptGeneratedImage = useCallback((targetId: string, invocationId: string, fileId: string, assertCurrent: () => void) => {
    const state = streamsRef.current.get(targetId)
    if (!state || state.invocationId !== invocationId || !isGeneratedImageId(fileId)) throw new DOMException('Image receipt cancelled', 'AbortError')
    state.assertCurrent?.(); assertCurrent()
    if (state.generatedImages.includes(fileId)) return
    if (state.generatedImages.length >= MAX_GENERATED_IMAGES_PER_TURN || !storage.isCacheReady() || !storage.getConversation(targetId)) throw new Error('Image receipt unavailable')
    const previousGuard = state.assertCurrent
    const next = { ...state, generatedImages: [...state.generatedImages, fileId],
      assertCurrent: () => { previousGuard?.(); assertCurrent() } }
    if (savePartialFor(next) === false) throw new Error('Image receipt could not be saved')
    state.generatedImages = next.generatedImages
    state.assertCurrent = next.assertCurrent
    if (activeIdRef.current === targetId) setStreamingImages([...state.generatedImages])
    depsRef.current.refreshConversations()
  }, [savePartialFor])

  // Synchronise la conv affichée avec son stream en cours (ou avec l'absence
  // de stream). Appelé depuis selectConversation/clearActive.
  const setActiveStream = useCallback((id: string | null) => {
    activeIdRef.current = id
    cancelPendingFlush()
    if (id) {
      const s = streamsRef.current.get(id)
      if (s) {
        setIsStreaming(true)
        setStreamingContent(s.accumulated)
        setStreamingImages([...s.generatedImages])
        return
      }
    }
    setIsStreaming(false)
    setStreamingContent('')
    setStreamingImages(EMPTY_GENERATED_IMAGES)
  }, [cancelPendingFlush])

  const isActive = useCallback((targetId: string) => {
    return activeIdRef.current === targetId
  }, [])

  const isStreamingFor = useCallback((id: string | null) => {
    return id ? streamingConvIds.has(id) : false
  }, [streamingConvIds])

  const onToken = useCallback((token: string, targetId: string) => {
    const s = streamsRef.current.get(targetId)
    if (!s) return
    s.accumulated += token
    if (activeIdRef.current !== targetId) return
    // Throttle RAF : on coalesce les tokens en 1 setState par frame, lu
    // depuis le ref (toujours frais) au moment du flush.
    if (pendingFlushRef.current !== null) return
    pendingFlushRef.current = requestAnimationFrame(() => {
      pendingFlushRef.current = null
      const cur = streamsRef.current.get(targetId)
      if (cur && activeIdRef.current === targetId) {
        setStreamingContent(cur.accumulated)
      }
    })
  }, [])

  const onDone = useCallback((targetId: string) => {
    const s = streamsRef.current.get(targetId)
    if (!s) return
    const content = s?.accumulated || ''
    finalize(targetId, content)
    teardownStream(targetId)
  }, [finalize, teardownStream])

  const onError = useCallback((err: Error, targetId: string) => {
    const s = streamsRef.current.get(targetId)
    const content = s?.accumulated
    if (content || s?.generatedImages.length) finalize(targetId, content ?? '', true)
    teardownStream(targetId)
    return err
  }, [finalize, teardownStream])

  // Stoppe un stream précis (par convId) ou la conv active si non précisé.
  // Le bouton Stop dans InputBar concerne toujours la conv affichée.
  const stopStreaming = useCallback((targetId?: string) => {
    const id = targetId ?? activeIdRef.current
    if (!id) return
    const s = streamsRef.current.get(id)
    if (!s) return
    if (s.external) {
      try { s.external.cancel('stop') } finally { if (streamsRef.current.get(id) === s) teardownStream(id) }
      return
    }
    if (s.accumulated || s.generatedImages.length) finalize(id, s.accumulated, true)
    if (s.abortController) {
      try { s.abortController.abort() } catch { /* déjà aborté */ }
    }
    teardownStream(id)
  }, [finalize, teardownStream])

  // Session invalidated: never persist partial content into another account.
  const discardStream = useCallback((targetId: string) => {
    const state = streamsRef.current.get(targetId)
    try { state?.external?.cancel('discard') } catch { /* Isolate lifecycle observers. */ }
    try { state?.abortController?.abort() } catch { /* Continue removal. */ }
    if (streamsRef.current.get(targetId) !== state) return
    teardownStream(targetId)
  }, [teardownStream])

  useEffect(() => {
    const invalidate = () => {
      for (const state of streamsRef.current.values()) {
        if (state.generatedImages.length || state.external) discardStream(state.targetId)
      }
    }
    const unsubscribe = onLocalDataInvalidated(invalidate)
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PROJECT_ERASURE_FENCE_KEY || event.key === 'arty-known-sessions' || event.key === 'arty-active-session') invalidate()
    }
    window.addEventListener('storage', onStorage)
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage) }
  }, [discardStream])

  // Setters indexés par convId — exposés en remplacement des accès directs
  // aux refs depuis useConversation.

  // Affiche un message de progression dans la bulle live (ex: "📄 Lecture du
  // PDF..."). Ne touche PAS à `accumulated` — c'est ephémère, juste pour l'UI.
  const setProgressContent = useCallback((content: string, targetId: string) => {
    if (activeIdRef.current === targetId) setStreamingContent(content)
  }, [])

  const setAbortController = useCallback((targetId: string, controller: AbortController) => {
    const s = streamsRef.current.get(targetId)
    if (s) s.abortController = controller
  }, [])

  // Reset l'accumulé d'une conv (utilisé après avoir affiché un marker
  // temporaire type "Recherche Gemini..." avant de démarrer le vrai stream).
  const resetAccumulated = useCallback((targetId: string) => {
    const s = streamsRef.current.get(targetId)
    if (s) s.accumulated = ''
  }, [])

  // Indique si une conv a un stream en cours (lecture brute du ref, hors
  // React state). Utilisé par les flows hybrid Gemini pour détecter un Stop
  // utilisateur pendant la phase de recherche.
  const hasStream = useCallback((targetId: string) => {
    return streamsRef.current.has(targetId)
  }, [])

  // Peut-on démarrer un stream pour cette conv ? Faux si déjà en cours ou si
  // on a atteint le cap. Utilisé par useConversation pour rejeter un envoi
  // AVANT d'ajouter le user message à la conv.
  const canStart = useCallback((targetId: string) => {
    if (streamsRef.current.has(targetId)) return false
    return streamsRef.current.size < MAX_CONCURRENT_STREAMS
  }, [])

  useEffect(() => () => {
    for (const stream of streamsRef.current.values()) {
      if (stream.saveInterval) clearInterval(stream.saveInterval)
      try { stream.external?.cancel('unmount') } catch { /* Keep cleaning up siblings. */ }
      try { stream.abortController?.abort() } catch { /* Keep cleaning up siblings. */ }
    }
    streamsRef.current.clear()
    cancelPendingFlush()
  }, [cancelPendingFlush])

  const getInvocationId = useCallback((id: string) => streamsRef.current.get(id)?.invocationId, [])

  // H2 (audit frontend) — retour mémoïsé. Toutes les fonctions ci-dessous ont
  // une identité stable (useCallback à deps stables) ; l'objet ne change donc
  // que quand l'état UI (isStreaming/streamingContent/streamingConvIds) change,
  // au lieu d'être un littéral neuf à chaque render.
  return useMemo(() => ({
    // État pour l'UI de la conv active
    isStreaming,
    streamingContent,
    streamingImages,
    // État multi-conv (Sidebar et autres)
    streamingConvIds,
    isStreamingFor,
    hasStream,
    canStart,
    // Lifecycle d'un stream
    startStream,
    reserveExternalStreams,
    setProjectTurn,
    adoptGeneratedImage,
    getInvocationId,
    onToken,
    onDone,
    onError,
    stopStreaming,
    discardStream,
    // Sync avec la conv affichée
    setActiveStream,
    isActive,
    // Setters indexés (remplacent les accès directs aux refs)
    setProgressContent,
    setAbortController,
    resetAccumulated,
    // Utilitaires
    finalize,
    savePartialAll,
  }), [
    isStreaming, streamingContent, streamingImages, streamingConvIds, isStreamingFor, hasStream,
    canStart, startStream, reserveExternalStreams, setProjectTurn, adoptGeneratedImage, getInvocationId, onToken, onDone, onError,
    stopStreaming, discardStream, setActiveStream, isActive,
    setProgressContent, setAbortController, resetAccumulated, finalize,
    savePartialAll,
  ])
}
