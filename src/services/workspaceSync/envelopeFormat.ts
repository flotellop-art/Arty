import { SYNC_LIMITS } from './types'

/** Pure public metadata grammar. Cold inventory must never import key/session
 * capabilities just to establish ownership, dimensions or ciphertext shape. */
export const SYNC_ENVELOPE_LIMITS = {
  metadataBytes: SYNC_LIMITS.manifestBytes + 1024,
  plaintextBytes: 16 * 1024 * 1024,
  ciphertextBytes: 17 * 1024 * 1024,
  payloads: 256,
  frames: 512,
  chunkBytes: 256 * 1024,
} as const
export class SyncEnvelopeError extends Error {
  constructor(public readonly code: 'format' | 'limit' | 'secret' | 'locked' | 'cancelled' | 'scope' | 'integrity' | 'base' | 'missing') {
    super(`sync_envelope_${code}`); this.name = 'SyncEnvelopeError'
  }
}
export const envelopeFail = (code: SyncEnvelopeError['code']): never => { throw new SyncEnvelopeError(code) }
export interface SyncVaultScope { vaultId: string; epoch: string }
/** Public transport reference. Parsing does NOT authenticate a server ACK. */
export interface SyncEnvelopeReference extends SyncVaultScope {
  format: 'arty-sync-envelope-ref'; version: 1; operationId: string; bytes: number; sha256: string
}
export function envelopeFields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype || Object.getOwnPropertySymbols(input).length) return envelopeFail('format')
  const names = Object.getOwnPropertyNames(input), result: Record<string, unknown> = {}
  if (names.length !== keys.length || names.some(name => !keys.includes(name))) return envelopeFail('format')
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    if (!property?.enumerable || !('value' in property)) return envelopeFail('format')
    result[key] = property.value
  }
  return result
}
export function envelopeUUID(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) return envelopeFail('format')
  return value
}
export function envelopeScope(input: unknown): SyncVaultScope {
  const value = envelopeFields(input, ['vaultId', 'epoch'])
  return { vaultId: envelopeUUID(value.vaultId), epoch: envelopeUUID(value.epoch) }
}
export function assertEnvelopeScope(a: SyncVaultScope, b: SyncVaultScope): void {
  if (a.vaultId !== b.vaultId || a.epoch !== b.epoch) envelopeFail('scope')
}
export function envelopeHash(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/.test(value)) return envelopeFail('format')
  return value
}
export function parseSyncEnvelopeReference(input: unknown): Readonly<SyncEnvelopeReference> {
  const value = envelopeFields(input, ['format', 'version', 'vaultId', 'epoch', 'operationId', 'bytes', 'sha256'])
  if (value.format !== 'arty-sync-envelope-ref' || value.version !== 1 || typeof value.bytes !== 'number' ||
    !Number.isSafeInteger(value.bytes) || value.bytes <= 104 + 9 + 16) return envelopeFail('format')
  if (value.bytes > SYNC_ENVELOPE_LIMITS.ciphertextBytes) return envelopeFail('limit')
  return Object.freeze({ format: 'arty-sync-envelope-ref', version: 1, vaultId: envelopeUUID(value.vaultId), epoch: envelopeUUID(value.epoch),
    operationId: envelopeUUID(value.operationId), bytes: value.bytes, sha256: envelopeHash(value.sha256) })
}
