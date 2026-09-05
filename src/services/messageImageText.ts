import i18n from '../i18n'
import { generatedImageIds } from './generatedImages'

/** A text-only output cannot carry the private gallery; never expose its IDs. */
export function messageImageText(message: { role: string; content: string; generatedImages?: unknown }): string {
  const count = message.role === 'assistant' ? generatedImageIds(message.generatedImages).length : 0
  return count ? `${message.content}\n\n[${i18n.t('image.galleryOmitted', { count })}]` : message.content
}
