import { generateId } from '../../utils/generateId'
import { captureCryptoGuard, isCryptoReady } from '../crypto'
import { officeBudget, OfficeReadError } from '../documents/officeArchive'
import { extractOfficeText } from '../documents/officeText'
import { PROJECT_EXTRACTOR_VERSION, PROJECT_LIMITS, ProjectError, type PreparedProjectDocument, type ProjectFormat } from './types'
import type { ProjectOperation } from './store'

const preparations = new WeakMap<PreparedProjectDocument, ProjectOperation>()
export function assertPreparedForOperation(prepared: PreparedProjectDocument, operation: ProjectOperation): void {
  operation.assertCurrent()
  if (preparations.get(prepared) !== operation) throw new ProjectError('cancelled')
}
export function consumePreparedDocument(prepared: PreparedProjectDocument): void { preparations.delete(prepared) }

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** One file at a time. Caller must not Promise.all a multi-file selection.
 * No network, macros, formula evaluation, PDF/OCR or plaintext persistence.
 * Oversized text is rejected, never silently indexed partially.
 */
export async function prepareProjectDocument(
  operation: ProjectOperation,
  file: File,
): Promise<PreparedProjectDocument> {
  if (!isCryptoReady()) throw new ProjectError('unavailable')
  const cryptoCurrent = captureCryptoGuard()
  const assertCurrent = () => {
    operation.assertCurrent()
    if (!cryptoCurrent()) throw new ProjectError('cancelled')
  }
  assertCurrent()
  if (!file.name || file.name.length > 255 || /[\x00-\x1f\x7f]/.test(file.name)) throw new ProjectError('unsupported')
  const format = file.name.split('.').pop()?.toLowerCase() as ProjectFormat
  if (!['txt', 'md', 'csv', 'docx', 'xlsx'].includes(format)) throw new ProjectError('unsupported')
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > PROJECT_LIMITS.sourceBytes) throw new ProjectError('limit')
  const bytes = new Uint8Array(await file.arrayBuffer())
  assertCurrent()
  if (bytes.byteLength !== file.size || bytes.byteLength > PROJECT_LIMITS.sourceBytes) throw new ProjectError('limit')
  const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  assertCurrent()
  const original = base64(bytes)
  let text: string
  if (format === 'docx' || format === 'xlsx') {
    // Format is fixed from the original import name; aliases never affect it.
    try { text = await extractOfficeText({ id: generateId(), name: file.name, type: '', data: original }, officeBudget(assertCurrent)) }
    catch (error) { if (error instanceof OfficeReadError) throw new ProjectError(error.code); throw error }
  } else {
    // UTF-8 consumes at most four bytes per decoded code point. This early
    // bound avoids decoding an enormous plain file only to reject it later.
    if (bytes.length > PROJECT_LIMITS.documentTextChars * 4) throw new ProjectError('limit')
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ProjectError('unsupported') }
    if (text.includes('\0')) throw new ProjectError('unsupported')
    text = text.replace(/\r\n?/g, '\n')
  }
  assertCurrent()
  if (text.length > PROJECT_LIMITS.documentTextChars) throw new ProjectError('limit')
  if (!text.trim()) throw new ProjectError('unsupported')
  const prepared = Object.freeze({
    descriptor: Object.freeze({
      id: generateId(), name: file.name.slice(0, PROJECT_LIMITS.nameChars), originalName: file.name,
      format, revision: 1 as const, sourceHash, sourceBytes: bytes.byteLength, textChars: text.length,
      extractorVersion: PROJECT_EXTRACTOR_VERSION, createdAt: Date.now(),
    }),
    base64: original, text,
  })
  preparations.set(prepared, operation)
  return prepared
}
