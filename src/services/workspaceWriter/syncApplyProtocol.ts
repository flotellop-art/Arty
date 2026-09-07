import { controlProjectsVersion, isolatedWorkspaceLayout } from './layout'
import { exactResetFields as fields, resetUuid } from './resetProtocol'
import { parseRestoreReady, restoreHash, type RestoreReady } from './restoreProtocol'
import { assertOpaqueOwner } from './localOwnership'

export const SYNC_APPLY_BYTES = 128 * 1024 * 1024
export interface SyncApplyHeader {
  format: 'arty-workspace-control'; version: 10; layout: 'isolated-v1'; state: 'applying'; projectsVersion: 2
  revision: number; generation: string; requiredOwners: (string | null)[]; base: RestoreReady
  apply: { id: string; owner: string; phase: 'prepared' | 'copies' | 'publishing' | 'aborting'; bytes: number; hash: string }
}
export function syncApplyJobKey(id: string) {
  if (!resetUuid(id)) throw new Error('workspace_sync_apply_invalid')
  return `sync-apply:${id}`
}
/** Distinct from additive archives. Only the small root is read at admission;
 * an unknown phase/field never falls back to ready or opens the large job. */
export function parseSyncApplyHeader(v: unknown): SyncApplyHeader | null {
  if (!fields(v, ['format', 'version', 'layout', 'state', 'projectsVersion', 'revision', 'generation', 'requiredOwners', 'base', 'apply']) ||
    v.format !== 'arty-workspace-control' || v.version !== 10 || v.layout !== 'isolated-v1' || v.state !== 'applying' || v.projectsVersion !== 2 ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 2) return null
  const base = parseRestoreReady(v.base), a = v.apply
  try { isolatedWorkspaceLayout(v.generation as string, v.requiredOwners as (string | null)[], 2) } catch { return null }
  if (!base || controlProjectsVersion(base) !== 2 || base.revision >= Number.MAX_SAFE_INTEGER - 24 || v.revision !== base.revision + 1 ||
    v.generation !== base.generation || JSON.stringify(v.requiredOwners) !== JSON.stringify(base.requiredOwners) ||
    !fields(a, ['id', 'owner', 'phase', 'bytes', 'hash']) || !resetUuid(a.id) || !restoreHash(a.hash) ||
    !['prepared', 'copies', 'publishing', 'aborting'].includes(a.phase as string) ||
    !Number.isSafeInteger(a.bytes) || (a.bytes as number) < 1 || (a.bytes as number) > SYNC_APPLY_BYTES) return null
  try { assertOpaqueOwner(a.owner) } catch { return null }
  if (a.owner === 'anon' || base.version === 7 && base.resets.some(r => r.owner === a.owner && r.phase !== 'consumed')) return null
  return structuredClone(v) as unknown as SyncApplyHeader
}
export const syncApplyCompletedBase = (h: SyncApplyHeader): RestoreReady => ({ ...structuredClone(h.base), revision: h.revision + 1 })
