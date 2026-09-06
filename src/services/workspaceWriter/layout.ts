/** Physical format known by this bundle. An isolated generation must never be
 * coerced to this layout; compatible readers ship before its activation. */
export const LEGACY_WORKSPACE_LAYOUT = Object.freeze({
  kind: 'legacy-v1' as const,
  files: Object.freeze({ name: 'arty-files', version: 1 }),
  projects: Object.freeze({ name: 'arty-projects', version: 1 }),
})
export const HISTORY_SLOTS = Object.freeze(['conversations', 'conversations-enc', 'conversations-enc-locked', 'conversations-enc-locked-2'] as const)
export type HistorySlot = typeof HISTORY_SLOTS[number]
export type CryptoSlot = 'crypto-salt' | 'crypto-check' | 'crypto-version'
export interface IsolatedWorkspaceLayout {
  readonly kind: 'isolated-v1'
  readonly generation: string
  /** Source inventory, not current known-session membership. */
  readonly requiredOwners: readonly (string | null)[]
  readonly files: Readonly<{ name: string; version: number }>
  readonly projects: Readonly<{ name: string; version: number }>
}
export type WorkspaceStorageLayout = typeof LEGACY_WORKSPACE_LAYOUT | IsolatedWorkspaceLayout

/** Physical capability, distinct from semantic restore/reset protocol versions.
 * Missing means historical projects v1. Explicit 1/undefined/unknown versions
 * are not aliases. Old closed control readers reject the additional field. */
export interface WorkspacePhysicalVersion { projectsVersion?: 2 }
export const projectVersionKeys = (value: unknown): string[] => value && typeof value === 'object' &&
  Object.prototype.hasOwnProperty.call(value, 'projectsVersion') ? ['projectsVersion'] : []
export function controlProjectsVersion(value: unknown): 1 | 2 {
  if (!value || typeof value !== 'object') throw new Error('workspace_layout_invalid')
  const descriptor = Object.getOwnPropertyDescriptor(value, 'projectsVersion')
  if (!descriptor) return 1
  if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value !== 2) throw new Error('workspace_layout_invalid')
  return 2
}
export function projectVersionFields(version: number): WorkspacePhysicalVersion {
  if (version !== 1 && version !== 2) throw new Error('workspace_layout_invalid')
  return version === 2 ? { projectsVersion: 2 } : {}
}

function validRequiredOwners(value: unknown): value is readonly (string | null)[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 10_000 ||
    Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== value.length + 1) return false
  const seen = new Set<string | null>()
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
    if (!descriptor?.enumerable || !('value' in descriptor)) return false
    const owner: unknown = descriptor.value
    if (owner !== null && (typeof owner !== 'string' || !owner.length || owner.length > 128)) return false
    if (seen.has(owner as string | null)) return false
    seen.add(owner as string | null)
  }
  return true
}

/** Immutable isolated addresses. Physical projects v2 adds a monotone reader
 * barrier without renaming files, histories, accounts or their generation. */
export function isolatedWorkspaceLayout(generation: string, requiredOwners: readonly (string | null)[], projectsVersion: 1 | 2 = 1): IsolatedWorkspaceLayout {
  if (typeof generation !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation) ||
    !validRequiredOwners(requiredOwners) || (projectsVersion !== 1 && projectsVersion !== 2)) throw new Error('workspace_layout_invalid')
  return Object.freeze({ kind: 'isolated-v1', generation, requiredOwners: Object.freeze([...requiredOwners]),
    files: Object.freeze({ name: `arty-workspace-${generation}-files`, version: 1 }),
    projects: Object.freeze({ name: `arty-workspace-${generation}-projects`, version: projectsVersion }) })
}

/** Pure address construction; callers must hold the document admission. */
export function legacyStorageKey(owner: string | null, key: string): string {
  return owner ? `arty-${owner}-${key}` : `arty-${key}`
}

/** JSON tuple prevents ambiguous owner delimiters; null is not an ID "anon".
 * Auth/settings deliberately do not call this resolver. */
export function workspaceDataKey(layout: WorkspaceStorageLayout, owner: string | null, key: HistorySlot | CryptoSlot): string {
  return layout.kind === 'legacy-v1' ? legacyStorageKey(owner, key) : `arty-workspace:${layout.generation}:${JSON.stringify([owner, key])}`
}
