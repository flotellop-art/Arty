import type { Message } from '../types'

/** Only the user's leading instruction or structured action controls this.
 * A phrase inside supplied text, a video transcript or a quote is not an instruction.
 * This preserves generated text; it does not claim that the quoted facts are true. */
export function requiresFaithfulText(message: Pick<Message, 'content' | 'quickAction'>): boolean {
  if (message.quickAction?.id === 'translate' || message.quickAction?.id === 'translateToEn') return true
  const instruction = message.content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'").trimStart().toLowerCase()
    .replace(/^(?:s'il te plait[, ]*|s'il vous plait[, ]*|please[, ]*)/, '')
    .replace(/^(?:peux-tu|peux tu|pourrais-tu|pourrais tu|pouvez-vous|can you|could you)\s+/, '')
  return /^(?:recopie|recopier|reproduis|reproduire|retranscris|retranscrire|copie|copier)\b[^:\n.!?]{0,160}\b(?:exactement|a l'identique|mot pour mot|sans (?:rien )?modifier|sans correction)\b/.test(instruction)
    || /^(?:copy|repeat|reproduce|transcribe)\b[^:\n.!?]{0,160}\b(?:exactly|verbatim|word for word|without (?:any )?(?:changes|corrections))\b/.test(instruction)
    || /^(?:traduis|traduire|traduisez|translate)\b/.test(instruction)
}
