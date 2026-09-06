import { isolatedWorkspaceLayout } from './layout'
import { exactResetFields as fields, parseResetReadyControl, resetUuid, type ResetReadyControl } from './resetProtocol'
import { assertOpaqueOwner } from './localOwnership'

// Cold, closed control protocol. No authentication, application crypto or UI.
export const RESTORE_PAYLOAD_BYTES = 128 * 1024 * 1024
export type RestoreReady = Omit<ResetReadyControl, 'version' | 'resets'> & { version: 2 } | ResetReadyControl
export interface RestoreHeader {
  format: 'arty-workspace-control'; version: 8; layout: 'isolated-v1'; state: 'restoring'
  revision: number; generation: string; requiredOwners: (string | null)[]
  base: RestoreReady
  restore: { id: string; owner: string; phase: 'copies' | 'publishing' | 'aborting'; bytes: number; hash: string }
}
export const restoreJobKey = (id: string) => {
  if (!resetUuid(id)) throw new Error('workspace_restore_invalid')
  return `restore:${id}`
}
export const restoreHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
export function parseRestoreReady(v: unknown): RestoreReady | null {
  const reset = parseResetReadyControl(v)
  if (reset) return reset
  if (!fields(v, ['format', 'version', 'layout', 'state', 'revision', 'generation', 'requiredOwners']) ||
    v.format !== 'arty-workspace-control' || v.version !== 2 || v.layout !== 'isolated-v1' || v.state !== 'ready' ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 1) return null
  try { isolatedWorkspaceLayout(v.generation as string, v.requiredOwners as (string | null)[]) } catch { return null }
  return structuredClone(v) as unknown as RestoreReady
}
export function parseRestoreHeader(v: unknown): RestoreHeader | null {
  if (!fields(v, ['format', 'version', 'layout', 'state', 'revision', 'generation', 'requiredOwners', 'base', 'restore']) ||
    v.format !== 'arty-workspace-control' || v.version !== 8 || v.layout !== 'isolated-v1' || v.state !== 'restoring' ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 2) return null
  const base = parseRestoreReady(v.base), r = v.restore
  try { isolatedWorkspaceLayout(v.generation as string, v.requiredOwners as (string | null)[]) } catch { return null }
  if (!base || base.revision >= Number.MAX_SAFE_INTEGER - 2 || v.revision !== base.revision + 1 ||
    v.generation !== base.generation || JSON.stringify(v.requiredOwners) !== JSON.stringify(base.requiredOwners) ||
    !fields(r, ['id', 'owner', 'phase', 'bytes', 'hash']) || !resetUuid(r.id) ||
    !['copies', 'publishing', 'aborting'].includes(r.phase as string) || !restoreHash(r.hash) ||
    !Number.isSafeInteger(r.bytes) || (r.bytes as number) < 1 || (r.bytes as number) > RESTORE_PAYLOAD_BYTES) return null
  try { assertOpaqueOwner(r.owner) } catch { return null }
  if (r.owner === 'anon') return null // legacy file owner encoding is ambiguous
  if (base.version === 7 && base.resets.some(record => record.owner === r.owner && record.phase !== 'consumed')) return null
  return structuredClone(v) as unknown as RestoreHeader
}
export function restoreCompletedBase(header: RestoreHeader): RestoreReady {
  return { ...structuredClone(header.base), revision: header.revision + 1 }
}
