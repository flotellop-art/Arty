import { BackupError } from './types'

export const utf8 = new TextEncoder()
export function decodeUTF8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new BackupError('format') }
}
export const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
export function unhex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new BackupError('format')
  return Uint8Array.from(value.match(/../g)!, pair => parseInt(pair, 16))
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}
export function createRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  try { return `ARTY1-${hex(bytes).toUpperCase().match(/.{8}/g)!.join('-')}` }
  finally { bytes.fill(0) }
}
/** Only an encoded 256-bit recovery key, never a human password/KDF setting. */
export function readRecoveryCode(code: string): Uint8Array {
  if (typeof code !== 'string' || code.length > 128) throw new BackupError('secret')
  const trimmed = code.trim().toUpperCase()
  if (!/^ARTY1-(?:[0-9A-F]{8}-){7}[0-9A-F]{8}$/.test(trimmed)) throw new BackupError('secret')
  return unhex(trimmed.slice(6).replace(/-/g, ''))
}
