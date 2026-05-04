import { registerPlugin } from '@capacitor/core'
import type { FileAttachment } from '../types'
import { generateId } from '../utils/generateId'

interface ShareFile {
  name: string
  mimeType: string
  base64: string
  sizeBytes: number
}

export interface SharePayload {
  text: string | null
  file: ShareFile | null
  error: 'file_too_large' | null
}

interface ShareTargetPlugin {
  getPendingShare(): Promise<SharePayload>
  addListener(
    eventName: 'shareReceived',
    listener: (payload: SharePayload) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

const plugin = registerPlugin<ShareTargetPlugin>('ShareTarget')

function isEmpty(payload: SharePayload | null | undefined): boolean {
  if (!payload) return true
  return !payload.text && !payload.file && !payload.error
}

export async function getPendingShare(): Promise<SharePayload | null> {
  try {
    const payload = await plugin.getPendingShare()
    return isEmpty(payload) ? null : payload
  } catch {
    return null
  }
}

export async function addShareListener(
  handler: (payload: SharePayload) => void,
): Promise<() => void> {
  try {
    const sub = await plugin.addListener('shareReceived', (payload) => {
      if (!isEmpty(payload)) handler(payload)
    })
    return () => {
      void sub.remove()
    }
  } catch {
    return () => {}
  }
}

// Reconstructs a File-shaped attachment from the base64 payload exposed by the
// native plugin, so the existing send pipeline (FileAttachment → AI clients)
// can consume it without changes.
export function shareFileToAttachment(file: ShareFile): FileAttachment {
  return {
    id: generateId(),
    name: file.name,
    type: file.mimeType,
    data: file.base64,
  }
}

// Module-level draft handed off from the share handler to the conversation
// screen. Kept in memory (not localStorage) because file payloads can exceed
// the 5MB localStorage cap (BUG 11).
export interface PendingDraft {
  text: string
  files: FileAttachment[]
}

let pendingDraft: PendingDraft | null = null

export function setPendingDraft(draft: PendingDraft): void {
  pendingDraft = draft
}

// Single-shot read: clears the draft so a later mount doesn't replay it.
export function consumePendingDraft(): PendingDraft | null {
  const draft = pendingDraft
  pendingDraft = null
  return draft
}

// Builds the suggested prompt + attachment for a share payload. Pure helper —
// kept side-effect free so it's easy to unit test and reuse.
export function buildDraftFromShare(payload: SharePayload): PendingDraft | null {
  if (payload.error === 'file_too_large') return null

  const file = payload.file
  if (file) {
    const attachment = shareFileToAttachment(file)
    const isImage = file.mimeType.startsWith('image/')
    const isPdf = file.mimeType === 'application/pdf'
    let text = payload.text?.trim() || ''
    if (!text) {
      if (isImage) text = 'Analyse cette image.'
      else if (isPdf) text = 'Résume ce PDF en points clés.'
      else text = 'Voici un fichier que je viens de partager.'
    }
    return { text, files: [attachment] }
  }

  const sharedText = payload.text?.trim() || ''
  if (!sharedText) return null
  return {
    text: `Voici un texte que je viens de partager :\n\n${sharedText}`,
    files: [],
  }
}
