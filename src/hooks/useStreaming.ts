import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { generateId } from '../utils/generateId'
import * as storage from '../services/storage'
import type { ModelUsedEvent } from '../services/modelLabels'

// Cap de streams concurrents — protège des coûts d'abus (8 convs ouvertes en
// même temps = 8 appels LLM en // sur le compte du proprio). 3 suffit largement
// pour l'usage "je lance un long brief pendant que je discute autre part".
export const MAX_CONCURRENT_STREAMS = 3

type StreamState = {
  targetId: string
  accumulated: string
  saveInterval: ReturnType<typeof setInterval> | null
  abortController: AbortController | null
  // Mode "publish-after-fact-check" : tokens accumulés mais cachés en live.
  // Le caller fera le finalize après le fact-check.
  hideContent: boolean
  // CDC visibilité modèle (C-B) — model id de CE stream, capturé via l'event
  // 'arty-model-used' scopé conversationId (voir listener plus bas). Un event
  // `confirmed` (modèle servi ≠ demandé) écrase la valeur optimiste — c'est
  // la vérité serveur qui est persistée à finalize(). JAMAIS lu depuis le
  // cache global getLastModelUsed() : sous MAX_CONCURRENT_STREAMS=3, il peut
  // refléter le stream d'une AUTRE conversation.
  model?: string
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

  // Set des convIds en cours de streaming — exposé pour la Sidebar (indicateur
  // "en cours de réflexion" sur chaque conv concernée).
  const [streamingConvIds, setStreamingConvIds] = useState<ReadonlySet<string>>(() => new Set())

  // Map de tous les streams en cours, indexée par convId. Stocke l'accumulé,
  // l'interval de savePartial, l'AbortController et le flag fact-check par conv.
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
    if (!s.accumulated) return
    const conv = storage.getConversation(s.targetId)
    if (!conv) return

    const lastMsg = conv.messages[conv.messages.length - 1]
    if (lastMsg?.role === 'assistant' && lastMsg.id === 'streaming') {
      lastMsg.content = s.accumulated
      // C-B — porte l'attribution sur le partiel : si l'app est tuée en plein
      // stream, le message restauré au boot garde son modèle (revue Opus).
      if (s.model) lastMsg.model = s.model
      if (s.reasonCode) lastMsg.reasonCode = s.reasonCode
      if (s.subModelReasonCode) lastMsg.subModelReasonCode = s.subModelReasonCode
    } else {
      conv.messages.push({
        id: 'streaming',
        role: 'assistant',
        content: s.accumulated,
        timestamp: Date.now(),
        ...(s.model ? { model: s.model } : {}),
        ...(s.reasonCode ? { reasonCode: s.reasonCode } : {}),
        ...(s.subModelReasonCode ? { subModelReasonCode: s.subModelReasonCode } : {}),
      })
    }
    conv.updatedAt = Date.now()
    storage.saveConversation(conv)
  }, [])

  // Backward-compat : savePartial sans args flush tous les streams actifs.
  const savePartialAll = useCallback(() => {
    for (const s of streamsRef.current.values()) {
      savePartialFor(s)
    }
  }, [savePartialFor])

  // Finalise une conv : remplace le placeholder `streaming` par le message final.
  const finalize = useCallback((targetId: string, content: string, interrupted?: boolean) => {
    const conv = storage.getConversation(targetId)
    if (!conv) return

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
      ...(interrupted ? { interrupted: true } : {}),
      ...(model ? { model } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      ...(subModelReasonCode ? { subModelReasonCode } : {}),
    })
    conv.updatedAt = Date.now()
    storage.saveConversation(conv)
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
    }
  }, [cancelPendingFlush, removeFromStreamingSet])

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
      if (s) {
        s.model = detail.model
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
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [savePartialAll])

  // Démarre un nouveau stream pour une conv. Retourne false si le cap de
  // concurrence est atteint — le caller doit alors annuler son envoi.
  const startStream = useCallback((targetId: string): boolean => {
    if (streamsRef.current.has(targetId)) {
      // Stream déjà en cours pour cette conv → impossible d'en démarrer un
      // second (l'UI bloque déjà via isStreaming, mais défense en profondeur).
      return false
    }
    if (streamsRef.current.size >= MAX_CONCURRENT_STREAMS) {
      return false
    }

    const s: StreamState = {
      targetId,
      accumulated: '',
      saveInterval: setInterval(() => {
        const cur = streamsRef.current.get(targetId)
        if (cur) savePartialFor(cur)
      }, 3000),
      abortController: null,
      hideContent: false,
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
    }
    return true
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
        setStreamingContent(s.hideContent ? '' : s.accumulated)
        return
      }
    }
    setIsStreaming(false)
    setStreamingContent('')
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
    if (s.hideContent) return
    if (activeIdRef.current !== targetId) return
    // Throttle RAF : on coalesce les tokens en 1 setState par frame, lu
    // depuis le ref (toujours frais) au moment du flush.
    if (pendingFlushRef.current !== null) return
    pendingFlushRef.current = requestAnimationFrame(() => {
      pendingFlushRef.current = null
      const cur = streamsRef.current.get(targetId)
      if (cur && activeIdRef.current === targetId && !cur.hideContent) {
        setStreamingContent(cur.accumulated)
      }
    })
  }, [])

  // Marque la fin du stream SANS finalize. Garde le placeholder `streaming`
  // en place, garde le stream dans streamsRef pour que isStreaming reste true.
  // Différent de onDone qui finalize immédiatement.
  const markStreamDone = useCallback((targetId: string): string => {
    const s = streamsRef.current.get(targetId)
    const content = s?.accumulated || ''
    if (s?.saveInterval) {
      clearInterval(s.saveInterval)
      s.saveInterval = null
    }
    if (s) s.abortController = null
    if (activeIdRef.current === targetId) {
      cancelPendingFlush()
      setStreamingContent('')
    }
    return content
  }, [cancelPendingFlush])

  // Cleanup final après publish manuel. À appeler après markStreamDone +
  // finalize manuel pour libérer l'état de streaming.
  const completeStreaming = useCallback((targetId: string) => {
    teardownStream(targetId)
  }, [teardownStream])

  const onDone = useCallback((targetId: string) => {
    const s = streamsRef.current.get(targetId)
    const content = s?.accumulated || ''
    finalize(targetId, content)
    teardownStream(targetId)
  }, [finalize, teardownStream])

  const onError = useCallback((err: Error, targetId: string) => {
    const s = streamsRef.current.get(targetId)
    const content = s?.accumulated
    if (content) finalize(targetId, content, true)
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
    if (s.accumulated) finalize(id, s.accumulated, true)
    if (s.abortController) {
      try { s.abortController.abort() } catch { /* déjà aborté */ }
    }
    teardownStream(id)
  }, [finalize, teardownStream])

  // Setters indexés par convId — exposés en remplacement des accès directs
  // aux refs depuis useConversation.

  const setHideContent = useCallback((hide: boolean, targetId: string) => {
    const s = streamsRef.current.get(targetId)
    if (s) s.hideContent = hide
    if (hide && activeIdRef.current === targetId) setStreamingContent('')
  }, [])

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

  // H2 (audit frontend) — retour mémoïsé. Toutes les fonctions ci-dessous ont
  // une identité stable (useCallback à deps stables) ; l'objet ne change donc
  // que quand l'état UI (isStreaming/streamingContent/streamingConvIds) change,
  // au lieu d'être un littéral neuf à chaque render.
  return useMemo(() => ({
    // État pour l'UI de la conv active
    isStreaming,
    streamingContent,
    // État multi-conv (Sidebar et autres)
    streamingConvIds,
    isStreamingFor,
    hasStream,
    canStart,
    // Lifecycle d'un stream
    startStream,
    onToken,
    onDone,
    onError,
    markStreamDone,
    completeStreaming,
    stopStreaming,
    // Sync avec la conv affichée
    setActiveStream,
    isActive,
    // Setters indexés (remplacent les accès directs aux refs)
    setHideContent,
    setProgressContent,
    setAbortController,
    resetAccumulated,
    // Utilitaires
    finalize,
    savePartialAll,
  }), [
    isStreaming, streamingContent, streamingConvIds, isStreamingFor, hasStream,
    canStart, startStream, onToken, onDone, onError, markStreamDone,
    completeStreaming, stopStreaming, setActiveStream, isActive, setHideContent,
    setProgressContent, setAbortController, resetAccumulated, finalize,
    savePartialAll,
  ])
}
