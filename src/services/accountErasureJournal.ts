/** Pure journal grammar shared by hot and cold readers. No identity resolution. */
import { parseRemoteErasure, type RemoteErasureIntent } from './accountErasureProtocol'

export interface AccountErasureRecord {
  owner: string; operationId: string; nonce: string; serverConfirmed: boolean; pending: string[]
  remote?: RemoteErasureIntent; localOnly?: true
}
export type AccountErasureState = 'not-sent' | 'uncertain' | 'confirmed' | 'local-only' | 'legacy-unknown'
export function erasureRecordState(r: AccountErasureRecord): AccountErasureState {
  return r.serverConfirmed ? 'confirmed' : r.localOnly ? 'local-only' : r.remote?.state ?? 'legacy-unknown'
}
export function parseAccountErasureRecord(v: unknown): AccountErasureRecord | null {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return null
  const owns = (key: string) => Object.prototype.hasOwnProperty.call(v, key)
  const keys = ['owner', 'nonce', 'operationId', 'serverConfirmed', 'pending', ...(owns('remote') ? ['remote'] : []), ...(owns('localOnly') ? ['localOnly'] : [])]
  if (Reflect.ownKeys(v).length !== keys.length || !keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d?.enumerable && 'value' in d })) return null
  const r = v as AccountErasureRecord
  const uuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  if (typeof r.owner !== 'string' || !r.owner.length || r.owner.length > 128 || !uuid(r.nonce) || !uuid(r.operationId) || typeof r.serverConfirmed !== 'boolean' ||
    !Array.isArray(r.pending) || Object.getPrototypeOf(r.pending) !== Array.prototype || r.pending.length > 32 || Reflect.ownKeys(r.pending).length !== r.pending.length + 1 ||
    !Array.from({ length: r.pending.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(r.pending, String(i)); return !!d?.enumerable && 'value' in d }).every(Boolean) ||
    r.pending.some(p => !uuid(p)) || new Set(r.pending).size !== r.pending.length ||
    (owns('localOnly') && r.localOnly !== true) || (owns('remote') && (!parseRemoteErasure(r.remote) || r.serverConfirmed))) return null
  return structuredClone(r)
}
