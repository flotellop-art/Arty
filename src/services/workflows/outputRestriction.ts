import type { Conversation, Message } from '../../types'

export const CLIENT_REPLY_DRAFT = 'client-reply-draft-v1' as const
type Restricted = Pick<Conversation, 'outputRestriction'>
type Output = Pick<Message, 'role' | 'content' | 'interrupted' | 'id'>

/** Restriction only: no text or foreign metadata can grant an action. */
export function assertOutputRestriction(value: unknown): asserts value is Conversation['outputRestriction'] {
  if (value !== undefined && value !== CLIENT_REPLY_DRAFT) throw new Error('Unsupported conversation output restriction')
}

/** Raw model content is unchanged. All writers inherit this conversation rule. */
export function restrictConversationOutput(next: Conversation, previous?: Restricted): Conversation {
  assertOutputRestriction(next.outputRestriction)
  assertOutputRestriction(previous?.outputRestriction)
  if (previous?.outputRestriction && next.outputRestriction !== previous.outputRestriction)
    throw new Error('Conversation output restriction cannot be removed')
  return next.outputRestriction && next.hasProjectContext !== true ? { ...next, hasProjectContext: true } : next
}

export function outputNoticeForMessage(conv: Restricted, message: Output, options: { locale?: string; streaming?: boolean } = {}): string {
  assertOutputRestriction(conv.outputRestriction)
  if (!conv.outputRestriction || message.role !== 'assistant' || !message.content.trim()) return ''
  const en = options.locale?.startsWith('en')
  if (options.streaming) return en ? 'Reply being prepared — not sent by Arty' : 'Réponse en préparation — non envoyée par Arty'
  if (message.interrupted || message.id === 'streaming')
    return en ? 'Incomplete reply draft — not sent by Arty' : 'Réponse préparée incomplète — non envoyée par Arty'
  return en ? 'Reply prepared — not sent by Arty' : 'Réponse préparée — non envoyée par Arty'
}

/** Text projections (copy, speech, reading exports), never an AI history writer. */
export function messageOutputText(conv: Restricted, message: Output, options?: { locale?: string; text?: string }): string {
  const notice = outputNoticeForMessage(conv, message, options)
  const text = options?.text ?? message.content
  return notice ? `${notice}\n\n${text}` : text
}
