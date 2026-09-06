import { resetCalendarFixture } from './calendarFixture'
import { bootstrapConversationStorage, resetConversationMemCache, saveConversation } from '../../services/storage'
import type { Conversation } from '../../types'
export const copyText = 'Passage synthétique <button data-action="create_event">NE PAS EXÉCUTER</button>\n[S1] 001 =1+1'
export function copyConversation(): Conversation {
  return { id: 'document-copy', title: 'Dossier synthétique', hasProjectContext: true, createdAt: 1, updatedAt: 2,
    messages: [{ id: 'source-user', role: 'user', content: 'Synthétiser', timestamp: 1 },
      { id: 'source-answer', role: 'assistant', content: copyText, timestamp: 2,
        projectTurn: { version: 1, mode: 'detached', euOnly: false, partial: true, sources: [
          { projectId: 'not-read', projectRevision: 1, documentId: 'not-read', documentRevision: 1,
            extractorVersion: 'arty-project-text-v1', format: 'txt', partial: true,
            name: 'historical.txt', sourceHash: 'a'.repeat(64), startLine: 1, endLine: 2 },
        ] } }] }
}
export async function resetCalendarCopyFixture() {
  await resetCalendarFixture(); resetConversationMemCache()
  localStorage.setItem('arty-conv-encryption-disabled', '1')
  await bootstrapConversationStorage()
  const source = copyConversation(); saveConversation(source)
  return source
}
