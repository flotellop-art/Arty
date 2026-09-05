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

/** Candidate contract only: the production cold reader still refuses it until
 * migration, durable recovery and multi-generation erasure are implemented. */
export function isolatedWorkspaceLayout(generation: string, requiredOwners: readonly (string | null)[]): IsolatedWorkspaceLayout {
  if (typeof generation !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation) ||
    !validRequiredOwners(requiredOwners)) throw new Error('workspace_layout_invalid')
  return Object.freeze({ kind: 'isolated-v1', generation, requiredOwners: Object.freeze([...requiredOwners]),
    files: Object.freeze({ name: `arty-workspace-${generation}-files`, version: 1 }),
    projects: Object.freeze({ name: `arty-workspace-${generation}-projects`, version: 1 }) })
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
