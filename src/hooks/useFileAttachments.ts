import { useRef } from 'react'
import type { FileAttachment, Message } from '../types'
import { getFile } from '../services/secureFileStorage'

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

// Hydrate files: si f.data manque, le recharger depuis IndexedDB. Si null
// (blob purgé par OS / quota dépassé), retourner un placeholder qui produira
// un texte "[Image indisponible — recharge la conversation]" plutôt qu'un crash.
async function hydrateFiles(files: FileAttachment[]): Promise<FileAttachment[]> {
  return Promise.all(
    files.map(async (f) => {
      if (f.data) return f
      const loaded = await getFile(f.id)
      return loaded ?? f // f sans data → traité comme indisponible plus bas
    })
  )
}

function buildBlocksFromFiles(files: FileAttachment[]): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []
  for (const file of files) {
    const mime = detectMimeType(file.name, file.type)
    if (!file.data) {
      blocks.push({ type: 'text', text: `[Fichier '${file.name}' indisponible — recharge la conversation]` })
      continue
    }
    if (mime === 'application/pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: file.data },
      })
    } else if (mime.startsWith('image/')) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: file.data },
      })
    } else if (mime === 'text/plain' || mime.startsWith('text/')) {
      // BUG 36: use decodeURIComponent(escape(atob())) for correct UTF-8 (French chars)
      const decoded = decodeURIComponent(escape(atob(file.data)))
      blocks.push({ type: 'text', text: `[Contenu de ${file.name}]\n${decoded}` })
    } else if (mime === 'application/msword' || mime === 'application/vnd.ms-excel') {
      blocks.push({ type: 'text', text: `[Fichier joint: ${file.name} — format Office binaire, conversion serveur requise]` })
    } else {
      blocks.push({ type: 'text', text: `[Fichier joint: ${file.name} (${mime}) — format non lisible directement]` })
    }
  }
  return blocks
}

// Build API messages with file attachments as content blocks.
// Async because past messages need to hydrate their files from IndexedDB.
export async function buildApiMessages(
  messages: Message[]
): Promise<Array<{ role: string; content: string | Array<Record<string, unknown>> }>> {
  return Promise.all(
    messages.map(async (m) => {
      if (!m.files || m.files.length === 0) {
        return { role: m.role, content: m.content }
      }
      const hydrated = await hydrateFiles(m.files)
      const blocks = buildBlocksFromFiles(hydrated)
      // Un bloc text vide est rejeté par l'API Anthropic ("text content blocks
      // must contain non-whitespace text"). Pour un message image-only,
      // injecter un texte de relais pour que l'historique reste valide.
      const trailingText = m.content.trim() || 'Analyse ce fichier.'
      blocks.push({ type: 'text', text: trailingText })
      return { role: m.role, content: blocks }
    })
  )
}

// Variant for text-only providers (OpenAI, Gemini text-mode) :
// remplace les fichiers attachés par une mention textuelle plutôt que des
// content blocks binaires. Garde la trace dans l'historique sans envoyer
// les bytes (qui ne seraient pas traités).
export async function buildTextOnlyMessages(
  messages: Message[]
): Promise<Array<{ role: string; content: string }>> {
  return messages.map((m) => {
    if (!m.files || m.files.length === 0) {
      return { role: m.role, content: m.content }
    }
    const fileNotes = m.files.map((f) => `[Fichier joint: ${f.name}]`).join('\n')
    return { role: m.role, content: `${fileNotes}\n${m.content}`.trim() }
  })
}

// Variant pour Mistral (Medium 3.5 a une vision native, format OpenAI-like
// `image_url: {url: 'data:image/...;base64,...'}`). Les PDFs ne sont PAS
// supportés nativement par Mistral, on les convertit en mention textuelle.
// Permet aux conversations euOnly d'analyser des images sans passer par
// Claude/Gemini US.
export type MistralBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export async function buildMistralMessages(
  messages: Message[]
): Promise<Array<{ role: string; content: string | MistralBlock[] }>> {
  return Promise.all(
    messages.map(async (m) => {
      if (!m.files || m.files.length === 0) {
        return { role: m.role, content: m.content }
      }
      const hydrated = await hydrateFiles(m.files)
      const blocks = buildMistralBlocks(m.content, hydrated)
      return { role: m.role, content: blocks }
    })
  )
}

// Construit les content blocks Mistral pour le message courant à partir des
// fichiers en RAM. Permet de bypasser l'IndexedDB roundtrip pour un fichier
// qui vient d'être uploadé (cas où putFile a échoué silencieusement OU
// race au commit IndexedDB → getFile retourne null → image perdue côté
// Mistral). Symétrique de buildContentBlocks() pour Claude.
export function buildMistralBlocks(
  text: string,
  files: FileAttachment[]
): MistralBlock[] {
  const blocks: MistralBlock[] = []
  const textNotes: string[] = []
  for (const file of files) {
    const mime = detectMimeType(file.name, file.type)
    if (mime.startsWith('image/') && file.data) {
      blocks.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${file.data}` },
      })
    } else if (file.data && (mime === 'text/plain' || mime.startsWith('text/'))) {
      try {
        const decoded = decodeURIComponent(escape(atob(file.data)))
        textNotes.push(`[Contenu de ${file.name}]\n${decoded}`)
      } catch {
        textNotes.push(`[Fichier ${file.name} non décodable]`)
      }
    } else if (mime === 'application/pdf') {
      textNotes.push(`[PDF joint: ${file.name} — Mistral ne lit pas les PDFs nativement, conversion serveur recommandée]`)
    } else {
      textNotes.push(`[Fichier joint: ${file.name}]`)
    }
  }
  const fullText = [...textNotes, text].filter(Boolean).join('\n')
  blocks.push({ type: 'text', text: fullText || 'Analyse ce fichier.' })
  return blocks
}

// Build content blocks for the current outgoing message (files have data
// in RAM, no IndexedDB roundtrip needed).
export async function buildContentBlocks(
  text: string,
  files: FileAttachment[]
): Promise<Array<Record<string, unknown>>> {
  const hydrated = await hydrateFiles(files)
  const blocks = buildBlocksFromFiles(hydrated)
  blocks.push({ type: 'text', text: text || 'Analyse ce fichier.' })
  return blocks
}

export function useFileAttachments() {
  const pendingFilesRef = useRef<FileAttachment[] | null>(null)

  return {
    pendingFilesRef,
    setPendingFiles: (files: FileAttachment[] | null) => { pendingFilesRef.current = files },
  }
}
