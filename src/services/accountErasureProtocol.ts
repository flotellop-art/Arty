/** Shared wire contract. No account, storage, OAuth or UI imports. */
export const ACCOUNT_ERASURE_PATH = '/api/account/erasure-v1'
export const ERASURE_OPERATION_HEADER = 'x-arty-erasure-operation'
export const ERASURE_CAPABILITY_HEADER = 'x-arty-erasure-capability'
export const ERASURE_SUBJECT_HEADER = 'x-arty-erasure-subject'
export type ErasureIdentityKind = 'google' | 'email-trial'
export interface RemoteErasureIntent {
  protocol: 1; kind: ErasureIdentityKind; capability: string; subjectHash: string
  state: 'not-sent' | 'uncertain'
}
export const erasureUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
export const erasureHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
export function parseRemoteErasure(v: unknown): RemoteErasureIntent | null {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype || Reflect.ownKeys(v).length !== 5) return null
  const r = v as Record<string, unknown>
  if (!['protocol', 'kind', 'capability', 'subjectHash', 'state'].every(k => {
    const d = Object.getOwnPropertyDescriptor(v, k); return d?.enumerable && 'value' in d
  }) || r.protocol !== 1 || (r.kind !== 'google' && r.kind !== 'email-trial') || !erasureHash(r.capability) ||
    !erasureHash(r.subjectHash) || (r.state !== 'not-sent' && r.state !== 'uncertain')) return null
  return { protocol: 1, kind: r.kind as ErasureIdentityKind, capability: r.capability, subjectHash: r.subjectHash, state: r.state as RemoteErasureIntent['state'] }
}
export async function erasureDigest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
}
export function erasureSubject(capability: string, kind: ErasureIdentityKind, email: string): Promise<string> {
  // The capability salts the identity: the stored digest cannot be used to
  // enumerate email addresses without possession of the client's secret.
  return erasureDigest(JSON.stringify(['arty-erasure-v1', capability, kind, email.trim().toLowerCase()]))
}
export async function createRemoteErasure(kind: ErasureIdentityKind, email: string): Promise<RemoteErasureIntent> {
  if (!email.trim()) throw new Error('Account identity unavailable')
  const capability = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  return { protocol: 1, kind, capability, subjectHash: await erasureSubject(capability, kind, email), state: 'not-sent' }
}
