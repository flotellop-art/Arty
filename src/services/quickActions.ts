import i18n, { getLocale } from '../i18n'
import type {
  GmailSearchPayload,
  Message,
  QuickActionId,
  QuickActionSelection,
} from '../types'

interface QuickActionDefinition {
  icon: string
  labelKey: string
  promptKey: string
}

/** Source unique des actions autorisées. Le composer utilise le label et
 * l'icône ; seule la frontière modèle lit promptKey. */
export const QUICK_ACTIONS: Record<QuickActionId, QuickActionDefinition> = {
  brief: {
    icon: '☀️',
    labelKey: 'chat.input.chips.brief.label',
    promptKey: 'chat.input.chips.brief.prompt',
  },
  writeEmail: {
    icon: '✍️',
    labelKey: 'chat.input.chips.writeEmail.label',
    promptKey: 'chat.input.chips.writeEmail.prompt',
  },
  summarizeText: {
    icon: '📝',
    labelKey: 'chat.input.chips.summarizeText.label',
    promptKey: 'chat.input.chips.summarizeText.prompt',
  },
  translateToEn: {
    icon: '🌍',
    labelKey: 'chat.input.chips.translateToEn.label',
    promptKey: 'chat.input.chips.translateToEn.prompt',
  },
  summarize: {
    icon: '📝',
    labelKey: 'chat.input.chips.summarize.label',
    promptKey: 'chat.input.chips.summarize.prompt',
  },
  write: {
    icon: '✍️',
    labelKey: 'chat.input.chips.write.label',
    promptKey: 'chat.input.chips.write.prompt',
  },
  translate: {
    icon: '🌍',
    labelKey: 'chat.input.chips.translate.label',
    promptKey: 'chat.input.chips.translate.prompt',
  },
  explain: {
    icon: '💡',
    labelKey: 'chat.input.chips.explain.label',
    promptKey: 'chat.input.chips.explain.prompt',
  },
}

export function isQuickActionId(value: unknown): value is QuickActionId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUICK_ACTIONS, value)
}

export function isQuickActionSelection(value: unknown): value is QuickActionSelection {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<QuickActionSelection>
  return isQuickActionId(candidate.id)
    && (candidate.locale === 'fr' || candidate.locale === 'en')
}

export function createQuickActionSelection(id: QuickActionId): QuickActionSelection {
  return { id, locale: getLocale() }
}

/** Le handoff Gmail sans CASA sait enchaîner uniquement les deux actions
 * disponibles dans le panneau après ouverture d'un message. */
export function getGmailAfterOpenAction(
  selection?: QuickActionSelection,
): GmailSearchPayload['afterOpen'] {
  if (!isQuickActionSelection(selection)) return undefined
  if (selection.id === 'summarize' || selection.id === 'summarizeText') return 'summarize'
  if (selection.id === 'write' || selection.id === 'writeEmail') return 'reply'
  return undefined
}

/** Compose le contenu réellement envoyé au modèle. Le texte visible reste
 * inchangé dans Message.content ; l'instruction garde un rôle user normal. */
export function composeQuickActionText(text: string, selection?: QuickActionSelection): string {
  if (!isQuickActionSelection(selection)) return text
  const prompt = String(
    i18n.getFixedT(selection.locale)(QUICK_ACTIONS[selection.id].promptKey),
  ).trim()
  if (!prompt) return text
  return text.trim() ? `${prompt}\n\n${text}` : prompt
}

export function getMessageTextForModel(
  message: Pick<Message, 'role' | 'content' | 'quickAction'>,
): string {
  return message.role === 'user'
    ? composeQuickActionText(message.content, message.quickAction)
    : message.content
}
