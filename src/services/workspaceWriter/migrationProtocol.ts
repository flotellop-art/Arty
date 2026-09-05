import { isolatedWorkspaceLayout } from './layout'

export const MIGRATION_PHASES = ['reserved', 'inventoried', 'barrier', 'copied', 'verified'] as const
export type MigrationPhase = typeof MIGRATION_PHASES[number]
export interface MigrationHeader {
  format: 'arty-workspace-control'; version: 3; layout: 'legacy-v1'; state: 'migration'
  revision: number; generation: string; phase: MigrationPhase
}
export function parseMigrationHeader(value: unknown): Readonly<MigrationHeader> | null {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return null
  const fields = ['format', 'version', 'layout', 'state', 'revision', 'generation', 'phase']
  if (Object.getOwnPropertyNames(value).length !== fields.length || fields.some(k => {
    const d = Object.getOwnPropertyDescriptor(value, k); return !d?.enumerable || !('value' in d)
  })) return null
  const h = value as MigrationHeader
  if (h.format !== 'arty-workspace-control' || h.version !== 3 || h.layout !== 'legacy-v1' || h.state !== 'migration' ||
    !Number.isSafeInteger(h.revision) || h.revision < 1 || h.revision >= Number.MAX_SAFE_INTEGER || !MIGRATION_PHASES.includes(h.phase)) return null
  try { isolatedWorkspaceLayout(h.generation, []) } catch { return null }
  return Object.freeze({ ...h })
}
/** Same UUID as the committed descriptor: copies remain discoverable for purge. */
export function migrationDatabaseName(generation: string) {
  isolatedWorkspaceLayout(generation, [])
  return `arty-workspace-${generation}-migration`
}
