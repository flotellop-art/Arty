import type { Conversation, Message } from '../../types'
import { getActiveUserId, getActiveSessionEpoch } from '../userSession'
import { captureCryptoGuard } from '../crypto'
import { getConversation } from '../storage'
import { beginProjectOperation, assertProjectOperation } from '../projects/store'
import { downloadOrShareFile } from '../native/shareFile'
import { generatedImageIds } from '../generatedImages'
import { outputNoticeForMessage } from '../workflows/outputRestriction'
import { EXPORT_LIMITS as L, assertExportText, preflightMarkdown, exportError, type ExportSnapshot, type ExportMessage, type ExportDocument, type ExportChoices } from './types'

function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) exportError('Métadonnées de conversation invalides ou trop longues.')
  assertExportText(value)
  return value
}
function sourceLines(message: Message): string[] {
  if (!message.projectTurn) return []
  const turn = message.projectTurn
  if (!Array.isArray(turn.sources) || turn.sources.length > 20) exportError('Sources historiques invalides.')
  return turn.sources.map((s, i) => {
    if (![s.projectRevision, s.documentRevision, s.startLine, s.endLine].every(n => Number.isSafeInteger(n) && n >= 0)) exportError('Référence historique invalide.')
    return `[S${i + 1}] ${bounded(s.name, 255)} ; projet ${bounded(s.projectId, 128)} rév. ${s.projectRevision} ; document ${bounded(s.documentId, 128)} rév. ${s.documentRevision} ; lignes extraites ${s.startLine}–${s.endLine} ; SHA-256 ${bounded(s.sourceHash, 64)} ; extracteur ${bounded(s.extractorVersion, 80)}${s.partial ? ' ; extrait partiel' : ''}.`
  })
}
export function snapshotForExport(conv: Conversation, messageId?: string): ExportSnapshot {
  const selected = messageId ? conv.messages.filter(m => m.id === messageId) : conv.messages.filter(m => m.id !== 'streaming')
  if (!selected.length || selected.length > L.messages || (messageId && selected.length !== 1)) exportError('Export du fil limité à 50 messages conservés. Pour un fil plus long, exportez une réponse depuis sa bulle.')
  let chars = 0
  const messages: ExportMessage[] = selected.map(m => {
    if (m.id === 'streaming' || !['assistant', 'user'].includes(m.role) || (messageId && m.role !== 'assistant')) exportError('La réponse en cours ne peut pas être exportée.')
    const content = bounded(m.content, L.chars), sources = sourceLines(m), outputNotice = outputNoticeForMessage(conv, m)
    chars += content.length + sources.join('').length + outputNotice.length
    if (chars > L.chars) exportError('Export limité à 200 000 caractères, sources comprises.')
    preflightMarkdown(content)
    return { id: bounded(m.id, 128), role: m.role, content, sources, interrupted: !!m.interrupted,
      ...(outputNotice ? { outputNotice } : {}),
      model: m.model ? bounded(m.model, 200) : '', attachments: m.files?.length ?? 0,
      galleryImages: m.role === 'assistant' ? generatedImageIds(m.generatedImages).length : 0 }
  })
  return { title: bounded(conv.title, 255), messages, ...(conv.outputRestriction ? { outputRestriction: conv.outputRestriction } : {}) }
}

let active: symbol | null = null
export interface OfficeExportSession {
  document: ExportDocument
  deliver(choices: ExportChoices, onEngaged: () => void): Promise<void>
  dispose(): void
}
/** Captures the opening identity synchronously, before IDB/worker/import waits.
 * Library content/existence is never read: only the global erasure fence. */
export async function prepareOfficeExport(conv: Conversation, messageId: string | undefined, signal: AbortSignal, onInvalid?: () => void): Promise<OfficeExportSession> {
  if (active) exportError('Un autre export est déjà ouvert. Fermez-le avant de continuer.')
  const ticket = Symbol('export'), owner = getActiveUserId(), epoch = getActiveSessionEpoch(), cryptoCurrent = captureCryptoGuard()
  const snapshot = snapshotForExport(conv, messageId), key = JSON.stringify(snapshot), convId = conv.id
  let closed = false, worker: Worker | null = null, timer: ReturnType<typeof setInterval> | undefined
  let pending: { reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null
  let operation: Awaited<ReturnType<typeof beginProjectOperation>> | null = null
  const assertCurrent = () => {
    try {
    if (closed || signal.aborted || !owner || owner !== getActiveUserId() || epoch !== getActiveSessionEpoch() || !cryptoCurrent()) exportError('Export annulé : session modifiée ou fenêtre fermée.')
    operation?.assertCurrent()
    const current = getConversation(convId)
    if (!current || JSON.stringify(snapshotForExport(current, messageId)) !== key) exportError('Le contenu a changé. Rouvrez un aperçu avant export.')
    } catch (error) { dispose(); onInvalid?.(); throw error }
  }
  const dispose = () => {
    if (closed) return
    closed = true
    worker?.terminate(); worker = null
    clearInterval(timer)
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Export annulé.')); pending = null }
    signal.removeEventListener('abort', dispose)
    if (active === ticket) active = null
  }
  active = ticket
  signal.addEventListener('abort', dispose, { once: true })
  const request = (body: object, timeout: number): Promise<{ document?: ExportDocument; buffer?: ArrayBuffer }> => {
    assertCurrent()
    if (pending || !worker) exportError('Export déjà en cours ou fermé.')
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      pending = { reject, timer: setTimeout(() => { reject(new Error('Export trop long. Simplifiez le contenu puis réessayez.')); dispose() }, timeout) }
      worker!.onmessage = (event: MessageEvent<{ id: string; error?: string; document?: ExportDocument; buffer?: ArrayBuffer }>) => {
        if (event.data.id !== id || !pending) return
        clearTimeout(pending.timer); pending = null
        try { assertCurrent(); if (event.data.error) throw new Error(event.data.error); resolve(event.data) } catch (error) { reject(error) }
      }
      worker!.onerror = () => { if (pending) { clearTimeout(pending.timer); pending = null }; reject(new Error('Le moteur d’export est indisponible.')); dispose() }
      worker!.postMessage({ ...body, id })
    })
  }
  try {
    assertCurrent()
    operation = await beginProjectOperation(); assertCurrent()
    worker = new Worker(new URL('../../workers/officeExport.worker.ts', import.meta.url), { type: 'module' })
    timer = setInterval(() => { try { assertCurrent() } catch { dispose() } }, 250)
    const result = await request({ kind: 'parse', snapshot }, 10_000)
    assertCurrent()
    if (!result.document) exportError('Aperçu indisponible.')
    let delivering = false
    return { document: result.document, dispose, async deliver(choices, onEngaged) {
      if (delivering) exportError('Export déjà en cours.')
      if (!['docx', 'xlsx'].includes(choices.format)) exportError('Format d’export non pris en charge.')
      assertCurrent(); delivering = true
      try {
        const packed = await request({ kind: 'pack', choices: { format: choices.format, tableIds: [...choices.tableIds] } }, 30_000)
        assertCurrent()
        if (!(packed.buffer instanceof ArrayBuffer) || packed.buffer.byteLength > L.outputBytes) exportError('Fichier généré invalide.')
        const validate = async () => { assertCurrent(); await assertProjectOperation(operation!); assertCurrent() }
        await validate()
        const mime = choices.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        const stem = snapshot.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || 'Arty'
        await downloadOrShareFile(new Blob([packed.buffer], { type: mime }), `${stem}.${choices.format}`, { title: snapshot.title, assertCurrent, validate, onEngaged })
        assertCurrent()
      } finally { delivering = false }
    } }
  } catch (error) { dispose(); throw error }
}
