import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatModelName, getLastModelUsed, shouldAcceptModelEvent, type ModelUsedEvent } from '../../services/modelLabels'

// Petit badge "Arty écrit..." affiché EN DESSOUS de la bulle streaming
// (tant que le streaming dure). Différent de TypingIndicator qui ne sert
// qu'au tout début, avant le premier token. Ici l'utilisateur voit que la
// génération continue même s'il a scrollé en arrière pour relire.
//
// Quand l'appel en cours a la réflexion étendue active (effort Claude /
// budget profond Gemini), un suffixe « 🧠 réflexion approfondie » s'ajoute :
// sans ce signal, les niveaux de réflexion étaient 100 % imperceptibles à
// l'écran (audit fonctionnel 12 juin — le thinking n'est jamais streamé).
// Init sur le cache module (l'event 'arty-model-used' peut partir juste
// avant le mount), puis suit les events.
interface StreamingIndicatorProps {
  /** Conversation affichée — filtre les events des streams CONCURRENTS d'une
      autre conversation (MAX_CONCURRENT_STREAMS = 3) en plus des appels de
      fond. Optionnel : sans id, seul le filtre background s'applique. */
  conversationId?: string
}

export const StreamingIndicator = memo(function StreamingIndicator({ conversationId }: StreamingIndicatorProps) {
  const { t } = useTranslation()
  // Init sur le cache module (l'event peut partir avant le mount), FILTRÉ :
  // le cache peut refléter un stream d'une autre conversation.
  const initEvent = getLastModelUsed()
  const initAccepted = shouldAcceptModelEvent(initEvent, conversationId)
  const [reflecting, setReflecting] = useState(() => initAccepted && !!initEvent?.reflecting)
  // C-C — nom du modèle résolu affiché PENDANT le stream (« Arty écrit ·
  // Claude Sonnet 5 »). Suit les events scopés, y compris le correctif
  // `confirmed` (substitution serveur visible en live).
  const [model, setModel] = useState<string | null>(() => (initAccepted && initEvent?.model) || null)

  useEffect(() => {
    const onModelUsed = (e: Event) => {
      const detail = (e as CustomEvent<ModelUsedEvent>).detail
      // F-4 — les appels d'arrière-plan (brief, résumé, comparateur) et les
      // streams d'une autre conversation ne doivent pas piloter l'indicateur
      // de la conversation affichée.
      if (!shouldAcceptModelEvent(detail, conversationId)) return
      setReflecting(!!detail.reflecting)
      setModel(detail.model)
    }
    window.addEventListener('arty-model-used', onModelUsed)
    return () => window.removeEventListener('arty-model-used', onModelUsed)
  }, [conversationId])

  return (
    <div
      // H-UX-1 (audit étape 10) — aria-live='polite' pour que les lecteurs
      // d'écran annoncent qu'une réponse est en cours de génération. Sans ça,
      // un user non-voyant ne sait pas qu'Arty est en train de répondre.
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 ml-9 mt-1 mb-4 text-xs text-theme-muted"
    >
      <span className="flex gap-1" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-theme-accent typing-dot-1" />
        <span className="w-1.5 h-1.5 rounded-full bg-theme-accent typing-dot-2" />
        <span className="w-1.5 h-1.5 rounded-full bg-theme-accent typing-dot-3" />
      </span>
      <span className="font-sans uppercase tracking-kicker">
        {t('chat.streaming.writing')}
        {model && <span> · {formatModelName(model)}</span>}
        {reflecting && (
          <span className="text-theme-accent"> · 🧠 {t('chat.streaming.reflecting')}</span>
        )}
      </span>
    </div>
  )
})
