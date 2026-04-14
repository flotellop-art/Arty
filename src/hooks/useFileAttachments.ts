import { useRef } from 'react'
import type { FileAttachment, Message } from '../types'

// Detect MIME type from filename if browser didn't set it
function detectMimeType(name: string, type: string): string {
  if (type && type !== 'application/octet-stream') return type
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf': return 'application/pdf'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'txt': case 'csv': case 'md': case 'json': case 'xml': case 'html': case 'htm': case 'js': case 'ts': case 'css': return 'text/plain'
    case 'doc': case 'docx': return 'application/msword'
    case 'xls': case 'xlsx': return 'application/vnd.ms-excel'
    default: return type || 'application/octet-stream'
  }
}

// Build API messages with file attachments as content blocks
export function buildApiMessages(messages: Message[]): Array<{ role: string; content: string | Array<Record<string, unknown>> }> {
  return messages.map((m) => {
    if (!m.files || m.files.length === 0) {
      return { role: m.role, content: m.content }
    }

    const contentBlocks: Array<Record<string, unknown>> = []

    for (const file of m.files) {
      const mime = detectMimeType(file.name, file.type)
      if (mime === 'application/pdf') {
        contentBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: file.data },
        })
      } else if (mime.startsWith('image/')) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mime, data: file.data },
        })
      } else if (mime === 'text/plain' || mime.startsWith('text/')) {
        // BUG 36: use decodeURIComponent(escape(atob())) for correct UTF-8 (French chars)
        const decoded = decodeURIComponent(escape(atob(file.data)))
        contentBlocks.push({ type: 'text', text: `[Contenu de ${file.name}]\n${decoded}` })
      } else if (mime === 'application/msword' || mime === 'application/vnd.ms-excel') {
        // .doc/.docx/.xls/.xlsx: binary, cannot decode client-side — inform Claude
        contentBlocks.push({ type: 'text', text: `[Fichier joint: ${file.name} — format Office binaire, conversion serveur requise]` })
      } else {
        contentBlocks.push({ type: 'text', text: `[Fichier joint: ${file.name} (${mime}) — format non lisible directement]` })
      }
    }

    contentBlocks.push({ type: 'text', text: m.content })
    return { role: m.role, content: contentBlocks }
  })
}

export function buildContentBlocks(text: string, files: FileAttachment[]): Array<Record<string, unknown>> {
  const contentBlocks: Array<Record<string, unknown>> = []
  for (const file of files) {
    const mime = detectMimeType(file.name, file.type)
    if (mime === 'application/pdf') {
      contentBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: file.data },
      })
    } else if (mime.startsWith('image/')) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: file.data },
      })
    } else if (mime === 'text/plain' || mime.startsWith('text/')) {
      // BUG 36: use decodeURIComponent(escape(atob())) for correct UTF-8 (French chars)
      const decoded = decodeURIComponent(escape(atob(file.data)))
      contentBlocks.push({ type: 'text', text: `[Contenu de ${file.name}]\n${decoded}` })
    } else if (mime === 'application/msword' || mime === 'application/vnd.ms-excel') {
      // .doc/.docx/.xls/.xlsx: binary, cannot decode client-side — inform Claude
      contentBlocks.push({ type: 'text', text: `[Fichier joint: ${file.name} — format Office binaire, conversion serveur requise]` })
    }
  }
  contentBlocks.push({ type: 'text', text: text || 'Analyse ce fichier.' })
  return contentBlocks
}

export function useFileAttachments() {
  const pendingFilesRef = useRef<FileAttachment[] | null>(null)

  return {
    pendingFilesRef,
    setPendingFiles: (files: FileAttachment[] | null) => { pendingFilesRef.current = files },
  }
}
