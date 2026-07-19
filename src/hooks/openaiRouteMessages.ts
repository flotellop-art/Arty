import type { FileAttachment, Message } from '../types'
import type { OpenAIMessage } from '../services/openaiClient'
import type { RouteDecision } from '../services/router/types'
import {
  buildOpenAIVisionContentBlocks,
  buildTextOnlyMessages,
} from './useFileAttachments'

interface BuildOpenAIRouteMessagesInput {
  history: Message[]
  routeDecision: Pick<RouteDecision, 'usesOpenAIVision'>
  currentFiles?: FileAttachment[] | null
  outgoingText: string
  modelText: string
}

interface BuildOpenAIRouteMessagesResult {
  messages: OpenAIMessage[]
  consumedCurrentFiles: boolean
}

/**
 * Jonction unique entre la décision du routeur et le builder multimodal.
 * Aucun appelant ne doit redéduire la vision depuis le provider ou les flags.
 */
export async function buildOpenAIRouteMessages({
  history,
  routeDecision,
  currentFiles,
  outgoingText,
  modelText,
}: BuildOpenAIRouteMessagesInput): Promise<BuildOpenAIRouteMessagesResult> {
  const textOnly = await buildTextOnlyMessages(history)
  const messages: OpenAIMessage[] = textOnly.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
  }))

  if (routeDecision.usesOpenAIVision && currentFiles && messages.length > 0) {
    messages[messages.length - 1] = {
      role: 'user',
      content: await buildOpenAIVisionContentBlocks(outgoingText, currentFiles),
    }
    return { messages, consumedCurrentFiles: true }
  }

  if (outgoingText !== modelText && messages.length > 0) {
    messages[messages.length - 1] = { role: 'user', content: outgoingText }
  }
  return { messages, consumedCurrentFiles: false }
}
