import { envelopeFail as fail } from './envelopeFormat'
import { SYNC_LIMITS, type SyncKind } from './types'

const magic = new TextEncoder().encode('ARTYSOBJ1')
/** Canonical JSON is only built from detached data. Own data descriptors are
 * checked before reading, including nested values: no getters or toJSON. */
export function canonicalSyncJSON(input: unknown, limits = { nodes: 100_000, chars: SYNC_LIMITS.objectBytes as number }): string {
  const ancestors = new Set<object>(); let nodes = 0, chars = 0
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > limits.nodes || depth > 64) return fail('limit')
    if (v === null || typeof v === 'boolean') return v
    if (typeof v === 'string') { chars += v.length; if (chars > limits.chars) return fail('limit'); return v }
    if (typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)) return v
    if (!v || typeof v !== 'object' || ancestors.has(v) || Object.getOwnPropertySymbols(v).length) return fail('format')
    const array = Array.isArray(v)
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) return fail('format')
    const names = Object.getOwnPropertyNames(v).filter(k => !array || k !== 'length')
    if (array && (names.length !== v.length || names.some((k, i) => k !== String(i)))) return fail('format')
    ancestors.add(v)
    const entries = names.sort().flatMap(k => {
      const d = Object.getOwnPropertyDescriptor(v, k)!
      if (!d.enumerable || !('value' in d)) return fail('format')
      if (d.value === undefined && !array) return []
      return [[k, visit(d.value, depth + 1)]] as [string, unknown][]
    })
    ancestors.delete(v)
    const values = new Map(entries)
    return array ? Array.from({ length: v.length }, (_, i) => values.get(String(i))) : Object.fromEntries(entries)
  }
  const encoded = JSON.stringify(visit(input, 0))
  if (encoded.length > limits.chars) return fail('limit')
  return encoded
}

/** Header + canonical private metadata + RAW bytes, not base64-in-JSON. Bounds
 * include framing overhead. A present empty extracted string is never absence. */
export function encodeSyncContent(kind: SyncKind, data: unknown, binary = new Uint8Array()): Blob {
  const json = new TextEncoder().encode(canonicalSyncJSON({ kind, version: 1, data }))
  const length = magic.length + 4 + json.length + binary.byteLength
  if (length > SYNC_LIMITS.objectBytes) return fail('limit')
  const header = new Uint8Array(magic.length + 4)
  header.set(magic); new DataView(header.buffer).setUint32(magic.length, json.length)
  return new Blob([header, json, binary])
}

export function decodeSyncSourceBase64(input: string, allowEmpty = false): Uint8Array {
  if (typeof input !== 'string' || input.length > 4 * Math.ceil(SYNC_LIMITS.objectBytes / 3) + 1024) return fail('limit')
  const value = input.startsWith('data:') ? input.replace(/^data:[^,]{0,256};base64,/, '') : input
  if (!value.length && allowEmpty) return new Uint8Array()
  if (!value.length || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return fail('format')
  let binary: string
  try { binary = atob(value) } catch { return fail('format') }
  if (btoa(binary) !== value || binary.length > SYNC_LIMITS.objectBytes) return fail('format')
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}
