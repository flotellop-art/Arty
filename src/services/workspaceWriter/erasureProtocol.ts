import { isolatedWorkspaceLayout } from './layout'
import { assertOpaqueOwner } from './localOwnership'
import { parseAccountErasureRecord, type AccountErasureRecord } from '../accountErasureJournal'

export interface ConfirmedLocalCleanup {
  owner: string; operationId: string; nonce: string; serverConfirmed: true; pending: string[]
}
export interface ErasureStoreProof { copy: 'legacy' | 'active' | 'journal'; store: 'files' | 'projects' | 'documents' | 'usage' | 'meta'; hash: string; count: number }
export interface ErasureProof { localHash: string; planHash: string; stores: ErasureStoreProof[] }
interface ErasureBase {
  format: 'arty-workspace-control'; layout: 'isolated-v1'; state: 'erasing'
  revision: number; generation: string; requiredOwners: (string | null)[]
}
interface ErasureIdentity { owner: string; operationId: string; nonce: string; proof: ErasureProof }
export interface ErasureFence { initialLocal: string | null; initialActive: string | null; target: string }
export type ErasureHeader = ErasureBase & ({ version: 4; erasure: ErasureIdentity & { phase: 'reserved' | 'local' | 'native' | 'verified' } } |
  { version: 5; erasure: ErasureIdentity & { phase: 'reserved' | 'fenced' | 'local' | 'native' | 'verified'; fence: ErasureFence; authority: AccountErasureRecord } })
export const validErasureFence = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128
function fields(v: unknown, keys: string[]): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length) return false
  return Object.getOwnPropertyNames(v).length === keys.length && keys.every(k => {
    const d = Object.getOwnPropertyDescriptor(v, k); return !!d?.enumerable && 'value' in d
  })
}
export const cleanupId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
function denseArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length <= 32 && Object.getPrototypeOf(v) === Array.prototype && !Object.getOwnPropertySymbols(v).length &&
    Object.getOwnPropertyNames(v).length === v.length + 1 && Array.from({ length: v.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(v, String(i)); return !!d?.enumerable && 'value' in d
    }).every(Boolean)
}
/** Historical true authorizes continuing local cleanup. It does NOT prove a
 * server response (legacy BYOK/demo set it without a POST). */
export function parseConfirmedCleanup(v: unknown): ConfirmedLocalCleanup | null {
  if (!fields(v, ['owner', 'operationId', 'nonce', 'serverConfirmed', 'pending'])) return null
  try { assertOpaqueOwner(v.owner) } catch { return null }
  if (!cleanupId(v.operationId) || !cleanupId(v.nonce) || v.serverConfirmed !== true || !denseArray(v.pending) ||
    v.pending.length > 32 || v.pending.some(p => !cleanupId(p)) || new Set(v.pending).size !== v.pending.length) return null
  return { owner: v.owner, operationId: v.operationId, nonce: v.nonce, serverConfirmed: true, pending: [...v.pending] as string[] }
}
export function parseErasureHeader(v: unknown): ErasureHeader | null {
  if (!fields(v, ['format', 'version', 'layout', 'state', 'revision', 'generation', 'requiredOwners', 'erasure']) ||
    v.format !== 'arty-workspace-control' || (v.version !== 4 && v.version !== 5) || v.layout !== 'isolated-v1' || v.state !== 'erasing' ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 1 || (v.revision as number) > Number.MAX_SAFE_INTEGER - 8) return null
  try { isolatedWorkspaceLayout(v.generation as string, v.requiredOwners as (string | null)[]) } catch { return null }
  const e = v.erasure
  if (!fields(e, ['owner', 'operationId', 'nonce', 'phase', 'proof', ...(v.version === 5 ? ['fence', 'authority'] : [])]) || !cleanupId(e.operationId) || !cleanupId(e.nonce) ||
    !['reserved', 'local', 'native', 'verified', ...(v.version === 5 ? ['fenced'] : [])].includes(e.phase as string)) return null
  try { assertOpaqueOwner(e.owner) } catch { return null }
  if (!(v.requiredOwners as unknown[]).includes(e.owner)) return null
  if (v.version === 5) {
    const f = e.fence, a = parseAccountErasureRecord(e.authority)
    if (!fields(f, ['initialLocal', 'initialActive', 'target']) || !cleanupId(f.target) ||
      (f.initialLocal !== null && !validErasureFence(f.initialLocal)) || (f.initialActive !== null && !validErasureFence(f.initialActive)) ||
      f.target === f.initialLocal || f.target === f.initialActive || !a || (!a.serverConfirmed && !a.localOnly) ||
      a.owner !== e.owner || a.operationId !== e.operationId || a.nonce !== e.nonce) return null
  }
  const proof = e.proof
  if (!fields(proof, ['localHash', 'planHash', 'stores']) || !hash(proof.localHash) || !hash(proof.planHash) || !denseArray(proof.stores) || proof.stores.length !== 15) return null
  const copies = ['legacy', 'active', 'journal'], stores = ['files', 'projects', 'documents', 'usage', 'meta']
  if (proof.stores.some((s, i) => !fields(s, ['copy', 'store', 'hash', 'count']) || s.copy !== copies[Math.floor(i / 5)] || s.store !== stores[i % 5] ||
    !hash(s.hash) || !Number.isSafeInteger(s.count) || (s.count as number) < 0)) return null
  // Deep clone/freeze: callers never retain mutable pointers to the durable proof.
  const result = structuredClone(v) as unknown as ErasureHeader
  Object.freeze(result.requiredOwners)
  if (result.version === 5) {
    Object.freeze(result.erasure.fence)
    Object.freeze(result.erasure.authority.pending)
    if (result.erasure.authority.remote) Object.freeze(result.erasure.authority.remote)
    Object.freeze(result.erasure.authority)
  }
  result.erasure.proof.stores.forEach(Object.freeze); Object.freeze(result.erasure.proof.stores)
  Object.freeze(result.erasure.proof); Object.freeze(result.erasure); return Object.freeze(result)
}
