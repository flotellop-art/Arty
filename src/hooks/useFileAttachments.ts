import { useCallback, useMemo, useRef } from 'react'
import type { FileAttachment, Message } from '../types'
import { getFile } from '../services/secureFileStorage'
import { getMessageTextForModel } from '../services/quickActions'
import {
  IMAGE_NORMALIZATION_VERSION,
  MAX_IMAGE_DIMENSION,
  MAX_NORMALIZED_IMAGE_BYTES,
} from '../services/imageNormalization'
import i18n from '../i18n'

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
// (blob purgé par OS / quota dépassé), retourner la référence sans data. Les
// builders historiques produisent alors un placeholder ; le builder OpenAI
// vision échoue explicitement pour empêcher une relance sans pixels.
// Queue globale aux builders : plusieurs messages/conversations peuvent être
// hydratés via Promise.all, mais deux gros assets canoniques ne doivent jamais
// être déchiffrés en parallèle sur une WebView mobile.
let canonicalHydrationChain: Promise<void> = Promise.resolve()

async function hydrateFiles(files: FileAttachment[]): Promise<FileAttachment[]> {
  return Promise.all(
    files.map((f) => {
      if (f.data) return f
      const load = async () => {
        const loaded = await getFile(f.id)
        return loaded ?? f // f sans data → traité comme indisponible plus bas
      }
      if (f.normalizationVersion === undefined) return load()
      const task = canonicalHydrationChain.then(load)
      canonicalHydrationChain = task.then(() => undefined, () => undefined)
      return task
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
      // M1 (audit frontend) — atob/decodeURIComponent throwent sur base64
      // corrompu. Non catché, ça remontait dans sendMessage et laissait un
      // stream fantôme (le variant Mistral plus bas catchait déjà, lui).
      try {
        const decoded = decodeURIComponent(escape(atob(file.data)))
        blocks.push({ type: 'text', text: `[Contenu de ${file.name}]\n${decoded}` })
      } catch {
        blocks.push({ type: 'text', text: `[Fichier '${file.name}' illisible — contenu corrompu]` })
      }
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
      const modelText = getMessageTextForModel(m)
      if (!m.files || m.files.length === 0) {
        return { role: m.role, content: modelText }
      }
      const hydrated = await hydrateFiles(m.files)
      const blocks = buildBlocksFromFiles(hydrated)
      // Un bloc text vide est rejeté par l'API Anthropic ("text content blocks
      // must contain non-whitespace text"). Pour un message image-only,
      // injecter un texte de relais pour que l'historique reste valide.
      const trailingText = modelText.trim() || 'Analyse ce fichier.'
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
    const modelText = getMessageTextForModel(m)
    if (!m.files || m.files.length === 0) {
      return { role: m.role, content: modelText }
    }
    const fileNotes = m.files.map((f) => `[Fichier joint: ${f.name}]`).join('\n')
    return { role: m.role, content: `${fileNotes}\n${modelText}`.trim() }
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

export type OpenAIVisionBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'original' } }

export async function buildMistralMessages(
  messages: Message[]
): Promise<Array<{ role: string; content: string | MistralBlock[] }>> {
  return Promise.all(
    messages.map(async (m) => {
      const modelText = getMessageTextForModel(m)
      if (!m.files || m.files.length === 0) {
        return { role: m.role, content: modelText }
      }
      const blocks = await buildMistralContentBlocks(modelText, m.files)
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

// Rejouer ou éditer un ancien message ne dispose plus forcément des bytes en
// RAM. Hydrater les références avant de reconstruire le dernier message évite
// de perdre silencieusement une image lors d'une relance Mistral.
export async function buildMistralContentBlocks(
  text: string,
  files: FileAttachment[]
): Promise<MistralBlock[]> {
  const hydrated = await hydrateFiles(files)
  return buildMistralBlocks(text, hydrated)
}

/**
 * Builder one-shot OpenAI : uniquement les images du tour courant, puis le
 * texte. L'historique est construit séparément en text-only afin de ne jamais
 * renvoyer silencieusement les mêmes pixels aux tours suivants.
 */
export async function buildOpenAIVisionContentBlocks(
  text: string,
  files: FileAttachment[],
): Promise<OpenAIVisionBlock[]> {
  const hydrated = await hydrateFiles(files)
  const blocks: OpenAIVisionBlock[] = []

  for (const file of hydrated) {
    const mime = detectMimeType(file.name, file.type)
    if (!mime.startsWith('image/')) throw new Error('openai_vision_requires_images_only')
    // Retry/edit doit rester fail-closed : sans les pixels, ne jamais dégrader
    // silencieusement la demande en texte (ce qui réactiverait le fallback).
    if (!file.data) throw new Error('openai_vision_asset_unavailable')
    if (
      (mime !== 'image/jpeg' && mime !== 'image/png') ||
      file.normalizationVersion !== IMAGE_NORMALIZATION_VERSION ||
      !Number.isInteger(file.width) ||
      !Number.isInteger(file.height) ||
      (file.width ?? 0) <= 0 ||
      (file.height ?? 0) <= 0 ||
      (file.width ?? 0) > MAX_IMAGE_DIMENSION ||
      (file.height ?? 0) > MAX_IMAGE_DIMENSION ||
      !Number.isInteger(file.size) ||
      (file.size ?? 0) <= 0 ||
      (file.size ?? 0) > MAX_NORMALIZED_IMAGE_BYTES
    ) {
      throw new Error('openai_vision_asset_not_canonical')
    }
    blocks.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${file.data}`, detail: 'original' },
    })
  }

  blocks.push({ type: 'text', text: text.trim() || i18n.t('chat.input.analyzePhotoRelay') })
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

  // H2 (audit frontend, relecture) — identités STABLES obligatoires :
  // setPendingFiles est dans les deps de sendMessage (useConversation). Une
  // arrow recréée à chaque render recréait sendMessage → editAndResend /
  // retryMessage → onEdit/onRetry de MessageItem à chaque frame de streaming
  // → memo court-circuité, exactement ce que H2 corrige.
  const setPendingFiles = useCallback((files: FileAttachment[] | null) => {
    pendingFilesRef.current = files
  }, [])

  return useMemo(() => ({ pendingFilesRef, setPendingFiles }), [setPendingFiles])
}
