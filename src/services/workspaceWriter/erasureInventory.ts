import { isolatedWorkspaceLayout, workspaceDataKey } from './layout'
import { parseOwnedLocalKey, parseLegacyWorkspaceKey, WORKSPACE_SLOTS } from './localOwnership'
import { rawEncoding, digestRaw, localPairs, validateSessions, localTargets, RAW_STORES, observeRawOwner, type MigrationPlan, type RawStore, type RawRow } from './migrationInventory'
import { parseConfirmedCleanup, validErasureFence, type ErasureHeader } from './erasureProtocol'

export const equalErasure = (a: unknown, b: unknown) => rawEncoding(a) === rawEncoding(b)
export const refuseErasure = (): never => { throw new Error('workspace_erasure_unverifiable') }
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => {
  rawEncoding(v)
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join()
}
export interface RedactedPlan { format: 'arty-workspace-redacted'; version: 2; owners: (string | null)[]; localSource: [string, string][] }
/** No old A-inclusive counts/hashes remain. This is deliberately NOT a v3
 * migrator input and cannot silently resume the original copy operation. */
export function projectErasurePlan(value: unknown, generation: string, owner: string): RedactedPlan {
  const original = exact(value, ['version', 'owners', 'localSource', 'localHash', 'versions', 'stores']) && value.version === 1
  if (!original && !(exact(value, ['format', 'version', 'owners', 'localSource']) && value.format === 'arty-workspace-redacted' && value.version === 2)) return refuseErasure()
  const p = value as unknown as MigrationPlan
  isolatedWorkspaceLayout(generation, p.owners)
  if (!Array.isArray(p.localSource) || p.localSource.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(s => typeof s !== 'string')) || new Set(p.localSource.map(p => p[0])).size !== p.localSource.length) return refuseErasure()
  for (const [key] of p.localSource) { const part = parseLegacyWorkspaceKey(key); if (!part || !p.owners.includes(part.owner)) return refuseErasure() }
  if (original) {
    if (typeof p.localHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.localHash) || !Array.isArray(p.versions) || p.versions.length !== 2 || p.versions.some(v => v !== 0 && v !== 1) ||
      !Array.isArray(p.stores) || p.stores.length !== 5 || p.stores.some((s, i) => !exact(s, ['store', 'count', 'hash']) || s.store !== RAW_STORES[i] || !Number.isSafeInteger(s.count) || s.count < 0 || !/^[a-f0-9]{64}$/.test(s.hash))) return refuseErasure()
    localTargets(p, generation)
  }
  return { format: 'arty-workspace-redacted', version: 2, owners: p.owners.filter(o => o !== owner),
    localSource: p.localSource.filter(([key]) => parseLegacyWorkspaceKey(key)!.owner !== owner) }
}

export function erasureRowOwner(store: RawStore, row: RawRow, erasure: ErasureHeader['erasure']): string | null {
  if (store === 'meta') {
    rawEncoding(row)
    if (row.key === 'erasure-fence' && typeof row.value === 'string' && row.value.length) return null
    const receipt = 'authority' in erasure ? (equalErasure(row.value, erasure.authority) ? erasure.authority : null) : parseConfirmedCleanup(row.value)
    if (!Array.isArray(row.key) || row.key.length !== 2 || row.key[0] !== 'erasing' || !receipt || row.key[1] !== receipt.owner ||
      receipt.owner !== erasure.owner || receipt.operationId !== erasure.operationId || receipt.nonce !== erasure.nonce) return refuseErasure()
    return receipt.owner
  }
  const owners = new Set<string | null>()
  observeRawOwner(store, row, owners, 'initial')
  if (owners.size !== 1) return refuseErasure()
  return [...owners][0]!
}

/** Logical B projection of shared session JSON; all B fields and list order
 * survive. Authenticated Email owner comes from its deterministic identifier,
 * never another Google account's display email. Values never enter control. */
export async function erasureLocalSnapshot(generation: string, owner: string, version: 4 | 5 | 6 = 4) {
  const pairs = localPairs(), layout = isolatedWorkspaceLayout(generation, [])
  validateSessions(pairs)
  const protectedPairs: [string, string][] = [], changes: [string, string | null][] = []
  for (const [key, value] of pairs) {
    if (version !== 4 && key === 'arty-project-erasure-fence') {
      if (!validErasureFence(value)) return refuseErasure()
      continue // v5 attests this exact location separately; v4 hash is unchanged.
    }
    if (key === 'arty-active-session') {
      if (JSON.parse(value).userId === owner) changes.push([key, null])
      else protectedPairs.push([key, value])
      continue
    }
    if (key === 'arty-known-sessions') {
      const sessions = JSON.parse(value) as { userId: string }[], kept = sessions.filter(s => s.userId !== owner)
      const canonical = JSON.stringify(kept)
      protectedPairs.push([key, canonical])
      if (kept.length !== sessions.length) changes.push([key, canonical])
      continue
    }
    let belongs = false
    if (key.startsWith('arty-email-hash-')) {
      const email = key.slice('arty-email-hash-'.length).toLowerCase().trim()
      if (!email) return refuseErasure()
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
      const id = `email-${Array.from(new Uint8Array(digest).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('')}`
      belongs = id === owner
    } else if (key.startsWith('arty-workspace:')) {
      const prefix = `arty-workspace:${generation}:`
      if (!key.startsWith(prefix)) return refuseErasure()
      let tuple: unknown
      try { tuple = JSON.parse(key.slice(prefix.length)) } catch { return refuseErasure() }
      if (!Array.isArray(tuple) || tuple.length !== 2 || (tuple[0] !== null && (typeof tuple[0] !== 'string' || !tuple[0].length || tuple[0].length > 128)) ||
        !WORKSPACE_SLOTS.includes(tuple[1]) || workspaceDataKey(layout, tuple[0], tuple[1]) !== key) return refuseErasure()
      belongs = tuple[0] === owner
    } else {
      const part = parseOwnedLocalKey(key)
      if (!part && key.startsWith(`arty-${owner}-`)) return refuseErasure()
      belongs = part?.owner === owner
    }
    if (belongs) changes.push([key, null]); else protectedPairs.push([key, value])
  }
  const hash = await digestRaw(version !== 4 ? ['arty-erasure-local-v5', protectedPairs] : protectedPairs)
  if (!equalErasure(pairs, localPairs())) return refuseErasure()
  return { pairs, changes, hash }
}
