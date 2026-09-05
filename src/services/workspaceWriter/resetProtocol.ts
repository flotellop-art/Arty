import { isolatedWorkspaceLayout } from './layout'
import { assertOpaqueOwner } from './localOwnership'

// Kept pure: cold admission/erasure must never import crypto or authentication.
export const resetUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
const historicalOperationId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
export function exactResetFields(v: unknown, keys: string[]): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length) return false
  return Object.getOwnPropertyNames(v).length === keys.length && keys.every(k => {
    const d = Object.getOwnPropertyDescriptor(v, k); return !!d?.enumerable && 'value' in d
  })
}
function dense(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length <= 10_000 && Object.getPrototypeOf(v) === Array.prototype && !Object.getOwnPropertySymbols(v).length &&
    Object.getOwnPropertyNames(v).length === v.length + 1 && Array.from({ length: v.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(v, String(i)); return !!d?.enumerable && 'value' in d
    }).every(Boolean)
}
export interface ResetBundle { salt: string; check: string; version: 'v1' | 'v2' }
interface ResetIdentity { owner: string; operationId: string; resetId: string }
export type ResetRecord = ResetIdentity & ({ phase: 'available' | 'consumed' } | { phase: 'provisioning'; bundle: ResetBundle })
export interface ResetReadyControl {
  format: 'arty-workspace-control'; version: 7; layout: 'isolated-v1'; state: 'ready'
  revision: number; generation: string; requiredOwners: (string | null)[]; resets: ResetRecord[]
}
export function validResetBundle(v: unknown): v is ResetBundle {
  if (!exactResetFields(v, ['salt', 'check', 'version']) || (v.version !== 'v1' && v.version !== 'v2') ||
    typeof v.salt !== 'string' || v.salt.length > 65 || typeof v.check !== 'string' ||
    !new RegExp(`^${v.version}:[A-Za-z0-9+/]{47}=$`).test(v.check)) return false
  // AES-GCM('arty-ok'): 12 byte IV + 7 byte plaintext + 16 byte tag = 35 bytes.
  try {
    const a: unknown = JSON.parse(v.salt)
    return dense(a) && a.length === 16 && a.every(b => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 255) && JSON.stringify(a) === v.salt
  } catch { return false }
}
export function validResetRecords(v: unknown, owners: readonly (string | null)[]): v is ResetRecord[] {
  if (!dense(v)) return false
  const seen = new Set<string>(), ids = new Set<string>()
  for (const r of v) {
    if (!r || typeof r !== 'object' || !exactResetFields(r, ['owner', 'operationId', 'resetId', 'phase', ...(Object.getOwnPropertyDescriptor(r, 'phase')?.value === 'provisioning' ? ['bundle'] : [])])) return false
    try { assertOpaqueOwner(r.owner) } catch { return false }
    if (!owners.includes(r.owner) || seen.has(r.owner) || !historicalOperationId(r.operationId) || !resetUuid(r.resetId) || ids.has(r.resetId) ||
      !['available', 'provisioning', 'consumed'].includes(r.phase as string) || (r.phase === 'provisioning' && !validResetBundle(r.bundle))) return false
    seen.add(r.owner); ids.add(r.resetId)
  }
  return true
}
export function parseResetReadyControl(v: unknown): ResetReadyControl | null {
  if (!exactResetFields(v, ['format', 'version', 'layout', 'state', 'revision', 'generation', 'requiredOwners', 'resets']) ||
    v.format !== 'arty-workspace-control' || v.version !== 7 || v.layout !== 'isolated-v1' || v.state !== 'ready' ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 1) return null
  try { isolatedWorkspaceLayout(v.generation as string, v.requiredOwners as (string | null)[]) } catch { return null }
  if (!validResetRecords(v.resets, v.requiredOwners as (string | null)[])) return null
  return structuredClone(v) as unknown as ResetReadyControl
}
