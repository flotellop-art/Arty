import { memo, useRef, useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../types'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { TypingIndicator } from './TypingIndicator'
import { StreamingIndicator } from './StreamingIndicator'
import { GmailSearchCard } from '../gmail/GmailSearchCard'

interface MessageItemProps {
  msg: Message
  index: number
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
  onReport?: (messageId: string) => void
  onUpdateGmailSearch?: (messageId: string, query: string) => void
  isLast?: boolean
}

const MessageItem = memo(function MessageItem({ msg, index, onAction, onBranch, onTogglePin, onEdit, onRetry, onReport, onUpdateGmailSearch, isLast }: MessageItemProps) {
  const handleBranch = useCallback(() => onBranch?.(index), [onBranch, index])
  const handleTogglePin = useCallback(() => onTogglePin?.(msg.id), [onTogglePin, msg.id])
  const handleEdit = useCallback((newContent: string) => onEdit?.(msg.id, newContent), [onEdit, msg.id])
  const handleRetry = useCallback(() => onRetry?.(msg.id), [onRetry, msg.id])
  const handleReport = useCallback(() => onReport?.(msg.id), [onReport, msg.id])

  // Branche : pas sur le tout premier message (une branche vide n'a pas de sens).
  // Le bouton vit DANS la barre d'actions des bulles — l'ancien bouton flottant
  // `absolute top-2 right-2` chevauchait le header des blocs de code (PR #263).
  const branchHandler = onBranch && index > 0 ? handleBranch : undefined

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
          onBranch={branchHandler}
        />
      ) : msg.gmailSearch ? (
        <GmailSearchCard
          content={msg.content}
          payload={msg.gmailSearch}
          onQueryChange={onUpdateGmailSearch
            ? (query) => onUpdateGmailSearch(msg.id, query)
            : undefined}
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
          isLast={isLast}
          onBranch={branchHandler}
          // Le placeholder de stream ('streaming') n'est pas signalable :
          // contenu partiel, non persisté tel quel.
          onReport={onReport && msg.id !== 'streaming' ? handleReport : undefined}
          model={msg.model}
          reasonCode={msg.reasonCode}
          subModelReasonCode={msg.subModelReasonCode}
        />
      )}
    </div>
  )
})

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  /** Id de la conversation affichée — relayé à StreamingIndicator pour
      filtrer les events modèle des streams concurrents (F-4). */
  conversationId?: string
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
  onReport?: (messageId: string) => void
  onUpdateGmailSearch?: (messageId: string, query: string) => void
}

// Comportement type ChatGPT / Claude.ai : quand un nouveau message user
// est envoyé, on aligne SA bulle en HAUT du viewport. La réponse Arty se
// déroule en dessous SANS scroll automatique pendant le streaming.
// L'utilisateur peut relire ce qu'il a tapé en restant à sa position,
// ou scroller manuellement pour suivre la réponse en cours.
//
// Différent du comportement antérieur qui suivait le bas en permanence
// — ça forçait à descendre à chaque token et empêchait de naviguer.

export const MessageList = memo(function MessageList({ messages, isStreaming, streamingContent, conversationId, onAction, onBranch, onTogglePin, onEdit, onRetry, onReport, onUpdateGmailSearch }: MessageListProps) {
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

  // Index de la dernière réponse assistant — la seule à porter « Régénérer »
  // (le placeholder `id: 'streaming'` est exclu : c'est un filet anti-perte,
  // pas une vraie réponse).
  let lastAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'assistant' && m.id !== 'streaming') {
      lastAssistantIdx = i
      break
    }
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={updateCanScrollDown} className="absolute inset-0 overflow-y-auto px-4 py-4">
        {messages.map((msg, index) => {
          // H3 (audit frontend) — pendant un stream, savePartialFor écrit
          // toutes les 3 s un placeholder `id: 'streaming'` dans la conv
          // (filet anti-perte au kill de l'app). Le rendre ICI en plus de la
          // bulle live ci-dessous afficherait le contenu partiel en double.
          // Hors streaming (recovery après crash), on le rend normalement.
          // On garde la map entière (pas de filter) pour que `index` reste
          // aligné sur conv.messages — onBranch en dépend.
          if (isStreaming && msg.id === 'streaming') return null
          return (
            <MessageItem
              key={msg.id}
              msg={msg}
              index={index}
              onAction={onAction}
              onBranch={onBranch}
              onTogglePin={onTogglePin}
              onEdit={onEdit}
              onRetry={onRetry}
              onReport={onReport}
              onUpdateGmailSearch={onUpdateGmailSearch}
              // « Régénérer » uniquement sur la dernière réponse assistant,
              // et jamais pendant qu'un stream est en cours (P0.4).
              isLast={!isStreaming && index === lastAssistantIdx}
            />
          )
        })}

        {isStreaming && streamingContent && (
          <>
            <AssistantBubble content={streamingContent} onAction={onAction} isStreaming />
            <StreamingIndicator conversationId={conversationId} />
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
