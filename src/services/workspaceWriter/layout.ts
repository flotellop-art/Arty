/** Physical format known by this bundle. An isolated generation must never be
 * coerced to this layout; compatible readers ship before its activation. */
export const LEGACY_WORKSPACE_LAYOUT = Object.freeze({
  kind: 'legacy-v1' as const,
  files: Object.freeze({ name: 'arty-files', version: 1 }),
  projects: Object.freeze({ name: 'arty-projects', version: 1 }),
})
export type WorkspaceStorageLayout = typeof LEGACY_WORKSPACE_LAYOUT

/** Pure address construction; callers must hold the document admission. */
export function legacyStorageKey(owner: string | null, key: string): string {
  return owner ? `arty-${owner}-${key}` : `arty-${key}`
}
