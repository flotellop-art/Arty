import { memo, useRef, useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../types'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { TypingIndicator } from './TypingIndicator'
import { StreamingIndicator } from './StreamingIndicator'

interface MessageItemProps {
  msg: Message
  index: number
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
}

const MessageItem = memo(function MessageItem({ msg, index, onAction, onBranch, onTogglePin, onEdit, onRetry }: MessageItemProps) {
  const { t } = useTranslation()
  const handleBranch = useCallback(() => onBranch?.(index), [onBranch, index])
  const handleTogglePin = useCallback(() => onTogglePin?.(msg.id), [onTogglePin, msg.id])
  const handleEdit = useCallback((newContent: string) => onEdit?.(msg.id, newContent), [onEdit, msg.id])
  const handleRetry = useCallback(() => onRetry?.(msg.id), [onRetry, msg.id])

  return (
    <div className="group relative" data-msg-id={msg.id} data-msg-role={msg.role}>
      {msg.role === 'user' ? (
        <UserBubble
          content={msg.content}
          files={msg.files}
          pinned={msg.pinned}
          onTogglePin={onTogglePin ? handleTogglePin : undefined}
          // Roadmap UI #5 — édition autorisée sur TOUS les messages user, plus
          // seulement le dernier. `editAndResend` tronque déjà tout ce qui suit
          // le message édité, donc la logique gère correctement les messages
          // au milieu de la conversation. Avant : l'utilisateur devait
          // dupliquer sa question pour la corriger → pollue le fil.
          onEdit={onEdit ? handleEdit : undefined}
        />
      ) : (
        <AssistantBubble
          content={msg.content}
          onAction={onAction}
          pinned={msg.pinned}
          onTogglePin={onTogglePin ? handleTogglePin : undefined}
          interrupted={msg.interrupted}
          onRetry={onRetry ? handleRetry : undefined}
          factCheck={msg.factCheck}
        />
      )}
      {onBranch && index > 0 && (
        <button
          onClick={handleBranch}
          // Roadmap UI #4 — bouton branche visible sur mobile. `group-hover` ne
          // se déclenche jamais sur touch → invisible sur téléphone. Maintenant
          // 50 % opacity permanent sur mobile, 100 % au hover desktop.
          className="absolute top-2 right-2 opacity-50 md:opacity-0 md:group-hover:opacity-100 p-2 rounded-md bg-theme-surface/80 border border-theme-border text-theme-muted hover:text-theme-accent hover:border-theme-accent transition-all text-xs"
          title={t('chat.messageList.branch')}
          aria-label={t('chat.messageList.branch')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2V8M3 8C3 9.1 3.9 10 5 10H8M11 12V6M11 6C11 4.9 10.1 4 9 4H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="3" cy="2" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="11" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      )}
    </div>
  )
})

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
}

// Comportement type ChatGPT / Claude.ai : quand un nouveau message user
// est envoyé, on aligne SA bulle en HAUT du viewport. La réponse Arty se
// déroule en dessous SANS scroll automatique pendant le streaming.
// L'utilisateur peut relire ce qu'il a tapé en restant à sa position,
// ou scroller manuellement pour suivre la réponse en cours.
//
// Différent du comportement antérieur qui suivait le bas en permanence
// — ça forçait à descendre à chaque token et empêchait de naviguer.

export const MessageList = memo(function MessageList({ messages, isStreaming, streamingContent, onAction, onBranch, onTogglePin, onEdit, onRetry }: MessageListProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevMessagesCount = useRef(messages.length)
  // Tracks if there's still content scrollable below — drives the
  // visibility of the "↓ Descendre" button. Disparaît quand l'utilisateur
  // est en bas, réapparaît dès qu'il y a à nouveau quelque chose à voir
  // plus bas (pendant un stream qui grandit, ou s'il scroll manuellement
  // vers le haut).
  const [canScrollDown, setCanScrollDown] = useState(false)

  // H-Perf-3 (audit étape 6) — scroll throttling via RAF. Avant : setState
  // à chaque event scroll natif (continu sur iOS) → re-render de la liste
  // entière à chaque pixel. Maintenant : 1 setState max par frame.
  const scrollRafRef = useRef<number | null>(null)
  const updateCanScrollDown = useCallback(() => {
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const el = scrollRef.current
      if (!el) {
        setCanScrollDown(false)
        return
      }
      // Tolérance 8 px — sub-pixel rounding sur certains navigateurs mobile.
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      setCanScrollDown(remaining > 8)
    })
  }, [])

  // Re-évalue à chaque tick de streaming (le contenu grandit) et au
  // mount des nouveaux messages. Le scroll handler natif maintient
  // l'état à jour quand l'user scroll manuellement.
  useEffect(() => {
    updateCanScrollDown()
  }, [streamingContent, messages.length, updateCanScrollDown])

  // Quand un nouveau message arrive (typiquement le user envoie),
  // scroll de manière à ce que SA bulle soit alignée en HAUT du viewport.
  // Pendant que la réponse Arty stream en dessous, on ne touche plus à
  // la position — l'utilisateur reste sur sa question + voit la réponse
  // se construire dessous. S'il veut suivre les tokens en bas, il scroll
  // manuellement.
  useEffect(() => {
    const isNewMessage = messages.length > prevMessagesCount.current
    prevMessagesCount.current = messages.length
    if (!isNewMessage) return

    // Trouve la dernière bulle user (celle qu'on vient d'envoyer)
    let lastUserMsg: Message | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        lastUserMsg = messages[i]
        break
      }
    }
    if (!lastUserMsg) return

    // Aligne en haut du viewport — block: 'start'. Smooth pour un ressenti
    // soigné. Petit défer via requestAnimationFrame pour laisser React
    // rendre la nouvelle bulle avant de scroller.
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-msg-id="${lastUserMsg!.id}"]`)
      if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [messages.length, messages])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={updateCanScrollDown} className="absolute inset-0 overflow-y-auto px-4 py-4">
        {messages.map((msg, index) => (
          <MessageItem
            key={msg.id}
            msg={msg}
            index={index}
            onAction={onAction}
            onBranch={onBranch}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onRetry={onRetry}
          />
        ))}

        {isStreaming && streamingContent && (
          <>
            <AssistantBubble content={streamingContent} onAction={onAction} />
            <StreamingIndicator />
          </>
        )}

        {isStreaming && !streamingContent && (
          <TypingIndicator />
        )}
      </div>

      {/* Bouton "↓ Descendre" : visible UNIQUEMENT si on peut encore
          scroller vers le bas (= contenu hors viewport). Disparaît dès
          qu'on atteint le bas, réapparaît si du nouveau contenu arrive
          (stream qui grandit) ou si l'user remonte manuellement. */}
      {canScrollDown && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-theme-accent text-theme-bg text-xs font-sans uppercase tracking-kicker shadow-lg hover:opacity-90 transition-opacity flex items-center gap-1.5 z-10"
          aria-label={t('chat.messageList.scrollDown')}
        >
          <span>↓</span>
          <span>{t('chat.messageList.scrollDown')}</span>
        </button>
      )}
    </div>
  )
})
