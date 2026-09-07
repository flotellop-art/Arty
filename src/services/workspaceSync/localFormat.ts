import { isolatedWorkspaceLayout, type WorkspaceStorageLayout } from '../workspaceWriter/layout'
import { assertOpaqueOwner } from '../workspaceWriter/localOwnership'
import { envelopeFields as fields, envelopeUUID as uuid, envelopeFail as fail, parseSyncEnvelopeReference,
  SYNC_ENVELOPE_LIMITS, type SyncEnvelopeReference, type SyncVaultScope } from './envelopeFormat'

export const SYNC_STATE_BYTES = 8 * 1024 * 1024
export const SYNC_STATE_OVERHEAD = 8 + 32 + 12 + 16
const CONTEXT = ['owner', 'generation', 'enrollmentId', 'vaultId', 'epoch', 'revision'] as const
export interface SyncStorageContext { readonly generation: string }
export interface SyncLocalIdentity extends SyncVaultScope { owner: string; generation: string; enrollmentId: string; revision: number }
export interface SyncStateBinding extends SyncLocalIdentity { pending: Readonly<SyncEnvelopeReference> | null }
/** v2 is a durable reader barrier for local sync history provenance. Old
 * closed readers reject it before App; ordinary writers must never downgrade. */
export interface SyncStateRow extends SyncStateBinding { format: 'arty-sync-local-state'; version: 1 | 2; ciphertext: string }
export interface SyncOperationRow extends SyncLocalIdentity { format: 'arty-sync-local-operation'; version: 1; reference: Readonly<SyncEnvelopeReference>; ciphertext: string }
export type SyncStorageKey = { kind: 'sync-state'; owner: string } | { kind: 'sync-operation'; owner: string; operationId: string }

/** A legacy witness also has version 2. Require the exact admitted ACTIVE name,
 * generation and descriptor, never infer permission from db.version alone. */
export function syncStorageContext(layout: WorkspaceStorageLayout, db: { name: string; version: number }): SyncStorageContext | undefined {
  return layout.kind === 'isolated-v1' && layout.projects.version === 2 && db.version === 2 && db.name === layout.projects.name
    ? Object.freeze({ generation: layout.generation }) : undefined
}
export function parseSyncStorageKey(key: unknown): SyncStorageKey | null {
  if (!Array.isArray(key)) return null
  const tag = Object.getOwnPropertyDescriptor(key, '0')
  if (!tag || !('value' in tag)) return fail('format')
  if (tag.value !== 'sync-state' && tag.value !== 'sync-operation') return null
  const length = tag.value === 'sync-state' ? 2 : 3
  if (Object.getPrototypeOf(key) !== Array.prototype || key.length !== length || Object.getOwnPropertySymbols(key).length ||
    Object.getOwnPropertyNames(key).length !== length + 1) return fail('format')
  const values = Array.from({ length }, (_, i) => {
    const p = Object.getOwnPropertyDescriptor(key, String(i)); if (!p?.enumerable || !('value' in p)) return fail('format'); return p.value
  })
  assertOpaqueOwner(values[1])
  return length === 2 ? { kind: 'sync-state', owner: values[1] } : { kind: 'sync-operation', owner: values[1], operationId: uuid(values[2]) }
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** Canonical base64 checked without decoding/duplicating the ciphertext. */
export function syncBase64Size(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4) return fail('limit')
  if (!value.length || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) return fail('format')
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0, body = value.length - padding
  if (value.indexOf('=') !== (padding ? body : -1) || (padding && alphabet.indexOf(value[body - 1]!) % (padding === 2 ? 16 : 4))) return fail('format')
  const bytes = value.length / 4 * 3 - padding
  if (bytes < minimum || bytes > maximum) return fail('limit')
  return bytes
}
export function syncBytesToBase64(bytes: Uint8Array, minimum: number, maximum: number): string {
  if (bytes.length < minimum || bytes.length > maximum) return fail('limit')
  const pieces: string[] = []
  for (let i = 0; i < bytes.length; i += 32_768) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 32_768)))
  return btoa(pieces.join(''))
}
export function syncBase64ToBytes(value: string, minimum: number, maximum: number): Uint8Array {
  syncBase64Size(value, minimum, maximum)
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}
function identity(v: Record<string, unknown>): SyncLocalIdentity {
  assertOpaqueOwner(v.owner)
  isolatedWorkspaceLayout(v.generation as string, [])
  if (!Number.isSafeInteger(v.revision) || (v.revision as number) < 1) return fail('format')
  return { owner: v.owner, generation: v.generation as string, enrollmentId: uuid(v.enrollmentId),
    vaultId: uuid(v.vaultId), epoch: uuid(v.epoch), revision: v.revision as number }
}
function boundReference(input: unknown, bound: SyncLocalIdentity) {
  const reference = parseSyncEnvelopeReference(input)
  if (reference.vaultId !== bound.vaultId || reference.epoch !== bound.epoch) return fail('scope')
  return reference
}
export function parseSyncStateBinding(input: unknown): SyncStateBinding {
  const v = fields(input, [...CONTEXT, 'pending']), bound = identity(v)
  return { ...bound, pending: v.pending === null ? null : boundReference(v.pending, bound) }
}
export function syncStateBinding(row: SyncStateBinding): SyncStateBinding {
  return parseSyncStateBinding({ owner: row.owner, generation: row.generation, enrollmentId: row.enrollmentId, vaultId: row.vaultId,
    epoch: row.epoch, revision: row.revision, pending: row.pending })
}
/** Individual ownership is meaningful even if its companion was lost. This
 * parser deliberately does NOT grant pair validity or permission to replay. */
export function parseSyncStorageRow(keyInput: unknown, input: unknown, context?: SyncStorageContext): SyncStateRow | SyncOperationRow {
  const key = parseSyncStorageKey(keyInput)
  if (!key || !context) return fail('format')
  const state = key.kind === 'sync-state'
  const v = fields(input, ['format', 'version', ...CONTEXT, state ? 'pending' : 'reference', 'ciphertext']), bound = identity(v)
  if (v.format !== (state ? 'arty-sync-local-state' : 'arty-sync-local-operation') || (state ? v.version !== 1 && v.version !== 2 : v.version !== 1) ||
    bound.owner !== key.owner || bound.generation !== context.generation) return fail('scope')
  if (state) {
    syncBase64Size(v.ciphertext, SYNC_STATE_OVERHEAD + 1, SYNC_STATE_BYTES + SYNC_STATE_OVERHEAD)
    const pending = v.pending === null ? null : boundReference(v.pending, bound)
    return { format: 'arty-sync-local-state', version: v.version as 1 | 2, ...bound, pending, ciphertext: v.ciphertext as string }
  }
  const reference = boundReference(v.reference, bound)
  if (reference.operationId !== (key as Extract<SyncStorageKey, { kind: 'sync-operation' }>).operationId ||
    syncBase64Size(v.ciphertext, 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes) !== reference.bytes) return fail('integrity')
  return { format: 'arty-sync-local-operation', version: 1, ...bound, reference, ciphertext: v.ciphertext as string }
}
export function assertSyncPair(state: Omit<SyncStateRow, 'ciphertext'> | null, operation: Omit<SyncOperationRow, 'ciphertext'> | null): void {
  if (!state) { if (operation) fail('missing'); return }
  if (!state.pending) { if (operation) fail('format'); return }
  if (!operation) return fail('missing')
  if (CONTEXT.some(k => state[k] !== operation[k]) || JSON.stringify(state.pending) !== JSON.stringify(operation.reference)) fail('integrity')
}
