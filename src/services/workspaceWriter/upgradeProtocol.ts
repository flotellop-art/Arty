import { controlProjectsVersion, isolatedWorkspaceLayout } from './layout'
import { exactResetFields as fields, resetUuid } from './resetProtocol'
import { parseRestoreReady, type RestoreReady } from './restoreProtocol'
import { validErasureFence } from './erasureProtocol'

/** Cold physical-version transition. The base is complete (including v7 reset
 * tombstones), not a reconstruction from an account's current session. */
export interface WorkspaceUpgradeHeader {
  format: 'arty-workspace-control'; version: 9; layout: 'isolated-v1'; state: 'upgrading'
  revision: number; generation: string; requiredOwners: (string | null)[]
  base: RestoreReady
  upgrade: { id: string; from: 1; to: 2; localFence: string | null; activeFence: string | null }
}
export function parseWorkspaceUpgrade(v: unknown): WorkspaceUpgradeHeader | null {
  if (!fields(v, ['format', 'version', 'layout', 'state', 'revision', 'generation', 'requiredOwners', 'base', 'upgrade']) ||
    v.format !== 'arty-workspace-control' || v.version !== 9 || v.layout !== 'isolated-v1' || v.state !== 'upgrading') return null
  const base = parseRestoreReady(v.base), u = v.upgrade
  if (!base || controlProjectsVersion(base) !== 1 || base.revision > Number.MAX_SAFE_INTEGER - 2 ||
    v.revision !== base.revision + 1 || v.generation !== base.generation ||
    !fields(u, ['id', 'from', 'to', 'localFence', 'activeFence']) || !resetUuid(u.id) || u.from !== 1 || u.to !== 2 ||
    (u.localFence !== null && !validErasureFence(u.localFence)) || (u.activeFence !== null && !validErasureFence(u.activeFence)) ||
    (u.localFence ?? 'initial') !== (u.activeFence ?? 'initial')) return null
  try { isolatedWorkspaceLayout(v.generation as string, v.requiredOwners as (string | null)[]) } catch { return null }
  if (JSON.stringify(v.requiredOwners) !== JSON.stringify(base.requiredOwners)) return null
  return structuredClone(v) as unknown as WorkspaceUpgradeHeader
}
export function completedWorkspaceUpgrade(header: WorkspaceUpgradeHeader): RestoreReady {
  const parsed = parseWorkspaceUpgrade(header)
  if (!parsed) throw new Error('workspace_upgrade_invalid')
  return { ...parsed.base, projectsVersion: 2, revision: parsed.revision + 1 }
}
