import { controlProjectsVersion, isolatedWorkspaceLayout } from './layout'
import { exactResetFields as fields, resetUuid } from './resetProtocol'
import { parseRestoreReady, restoreHash, type RestoreReady } from './restoreProtocol'
import { assertOpaqueOwner } from './localOwnership'
import { SYNC_APPLY_BYTES } from './syncApplyProtocol'

export interface SyncUpdateHeader {
  format: 'arty-workspace-control'; version: 11; layout: 'isolated-v1'; state: 'applying'; projectsVersion: 2
  revision: number; generation: string; requiredOwners: (string | null)[]; base: RestoreReady
  apply: { id: string; owner: string; phase: 'prepared' | 'publishing'; bytes: number; hash: string }
}
export function syncUpdateJobKey(id: string) {
  if (!resetUuid(id)) throw new Error('workspace_sync_update_invalid')
  return `sync-update:${id}`
}
/** Closed v11 root. It never widens the additive v10 parser or reads a job. */
export function parseSyncUpdateHeader(v: unknown): SyncUpdateHeader | null {
  if (!fields(v, ['format', 'version', 'layout', 'state', 'projectsVersion', 'revision', 'generation', 'requiredOwners', 'base', 'apply']) ||
    v.format !== 'arty-workspace-control' || v.version !== 11 || v.layout !== 'isolated-v1' || v.state !== 'applying' || v.projectsVersion !== 2 ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 2) return null
  const base = parseRestoreReady(v.base), a = v.apply
  try { isolatedWorkspaceLayout(v.generation as string, v.requiredOwners as (string | null)[], 2) } catch { return null }
  if (!base || controlProjectsVersion(base) !== 2 || base.revision >= Number.MAX_SAFE_INTEGER - 24 || v.revision !== base.revision + 1 ||
    v.generation !== base.generation || JSON.stringify(v.requiredOwners) !== JSON.stringify(base.requiredOwners) ||
    !fields(a, ['id', 'owner', 'phase', 'bytes', 'hash']) || !resetUuid(a.id) || !restoreHash(a.hash) ||
    !['prepared', 'publishing'].includes(a.phase as string) || !Number.isSafeInteger(a.bytes) ||
    (a.bytes as number) < 1 || (a.bytes as number) > SYNC_APPLY_BYTES) return null
  try { assertOpaqueOwner(a.owner) } catch { return null }
  if (a.owner === 'anon' || base.version === 7 && base.resets.some(r => r.owner === a.owner && r.phase !== 'consumed')) return null
  return structuredClone(v) as unknown as SyncUpdateHeader
}
export const syncUpdateCompletedBase = (h: SyncUpdateHeader): RestoreReady => ({ ...structuredClone(h.base), revision: h.revision + 1 })
