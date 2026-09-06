import { SYNC_LIMITS as L, SyncProtocolError, type SyncManifest, type SyncRecord, type SyncRevision, type SyncValue, type SyncKind, type SyncChange } from './types'

const fail = (code: SyncProtocolError['code'] = 'format'): never => { throw new SyncProtocolError(code) }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const kinds: readonly SyncKind[] = ['conversation', 'project', 'file', 'project-source', 'project-text']

/** Read only own, enumerable DATA descriptors. Never invoke a data getter or
 * toJSON. This is not a sandbox against executable JavaScript Proxy traps. */
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype || Object.getOwnPropertySymbols(input).length) return fail()
  const names = Object.getOwnPropertyNames(input)
  if (names.length !== keys.length || names.some(key => !keys.includes(key))) return fail()
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail()
    result[key] = descriptor.value
  }
  return result
}
function items(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return fail()
  if (input.length > maximum) return fail('limit')
  if (Object.getOwnPropertyNames(input).length !== input.length + 1 || Object.getOwnPropertySymbols(input).length) return fail()
  const result: unknown[] = []
  for (let i = 0; i < input.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i))
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail()
    result.push(descriptor.value)
  }
  return result
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) return fail()
  return value
}
function kind(value: unknown): SyncKind {
  if (typeof value !== 'string' || !kinds.includes(value as SyncKind)) return fail()
  return value as SyncKind
}
function value(input: unknown): SyncValue {
  // Inspect the discriminator without invoking an accessor, including before
  // deciding which exact closed shape is allowed.
  if (!input || typeof input !== 'object') return fail()
  const state = Object.getOwnPropertyDescriptor(input, 'state')
  if (!state || !('value' in state)) return fail()
  if (state.value === 'deleted') { fields(input, ['state']); return { state: 'deleted' } }
  const entry = fields(input, ['state', 'payloadId', 'sha256', 'bytes'])
  if (entry.state !== 'live' || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) ||
    typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) return fail()
  if (entry.bytes > L.objectBytes) return fail('limit')
  return { state: 'live', payloadId: uuid(entry.payloadId), sha256: entry.sha256, bytes: entry.bytes }
}
function revision(input: unknown): SyncRevision {
  const entry = fields(input, ['id', 'intent', 'parents', 'value'])
  const id = uuid(entry.id), parents = items(entry.parents, L.headsPerRecord).map(uuid).sort()
  if (parents.includes(id) || new Set(parents).size !== parents.length) return fail()
  const content = value(entry.value)
  const intent = entry.intent as SyncRevision['intent']
  if (!['create', 'edit', 'delete', 'restore', 'resolve'].includes(intent)) return fail()
  if (intent === 'create' ? parents.length !== 0 || content.state !== 'live' : !parents.length) return fail()
  if (intent === 'resolve' ? parents.length < 2 : parents.length > 1) return fail()
  if (intent === 'delete' ? content.state !== 'deleted' : intent !== 'resolve' && content.state !== 'live') return fail()
  return { id, intent, parents, value: content }
}

/** A cycle-free, parent-closed DAG is required before deriving heads. Because
 * every edge is retained, removing all direct parents yields precisely the
 * maximal revisions; transitively dominated ancestors cannot become heads. */
function record(input: unknown): SyncRecord {
  const entry = fields(input, ['id', 'kind', 'revisions'])
  const revisions = items(entry.revisions, L.revisionsPerRecord).map(revision).sort(byId)
  if (!revisions.length) return fail()
  const byRevision = new Map(revisions.map(item => [item.id, item]))
  if (byRevision.size !== revisions.length) return fail('equivocation')
  const children = new Map<string, string[]>(), pending = new Map<string, number>()
  for (const item of revisions) {
    pending.set(item.id, item.parents.length)
    for (const parent of item.parents) {
      if (!byRevision.has(parent)) return fail()
      const next = children.get(parent) ?? []
      next.push(item.id); children.set(parent, next)
    }
  }
  const queue = revisions.filter(item => !item.parents.length).map(item => item.id)
  let visited = 0
  for (let i = 0; i < queue.length; i++) {
    visited++
    for (const child of children.get(queue[i]!) ?? []) {
      const count = pending.get(child)! - 1
      pending.set(child, count)
      if (!count) queue.push(child)
    }
  }
  if (visited !== revisions.length) return fail()
  for (const item of revisions) {
    if (item.intent === 'restore' && byRevision.get(item.parents[0]!)!.value.state !== 'deleted') return fail()
    if ((item.intent === 'edit' || item.intent === 'delete') && byRevision.get(item.parents[0]!)!.value.state !== 'live') return fail()
  }
  // Parents must be an antichain: an already dominated revision cannot also
  // have been a head of the same observation. Iterative and record-bounded.
  for (const item of revisions) {
    const expected = new Set(item.parents), seen = new Set<string>()
    const stack = item.parents.flatMap(parent => byRevision.get(parent)!.parents)
    while (stack.length) {
      const parent = stack.pop()!
      if (seen.has(parent)) continue
      if (expected.has(parent)) return fail()
      seen.add(parent); stack.push(...byRevision.get(parent)!.parents)
    }
  }
  const result = { id: uuid(entry.id), kind: kind(entry.kind), revisions }
  if (recordHeads(result).length > L.headsPerRecord) return fail('limit')
  return result
}
export const byId = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Only for an already parsed, closed DAG. No caller-supplied head list. */
export function recordHeads(entry: SyncRecord): SyncRevision[] {
  const parents = new Set(entry.revisions.flatMap(item => item.parents))
  return entry.revisions.filter(item => !parents.has(item.id))
}

/** Detached canonical copy. The protocol has no authority to decrypt payloads,
 * materialize files, authenticate a user or publish a server/local head. */
export function parseSyncManifest(input: unknown): SyncManifest {
  const root = fields(input, ['format', 'version', 'vaultId', 'epoch', 'records'])
  if (root.format !== 'arty-sync-causal' || root.version !== 1) return fail()
  let count = 0
  // Check cheap aggregate bounds BEFORE traversing any causal graphs.
  const rawRecords = items(root.records, L.records)
  for (const item of rawRecords) {
    const raw = fields(item, ['id', 'kind', 'revisions'])
    count += items(raw.revisions, L.revisionsPerRecord).length
    if (count > L.revisions) return fail('limit')
  }
  const records = rawRecords.map(record).sort(byId)
  const recordIds = new Set<string>(), revisionIds = new Set<string>()
  const payloads = new Map<string, string>()
  for (const item of records) {
    if (recordIds.has(item.id)) return fail('equivocation')
    recordIds.add(item.id)
    for (const rev of item.revisions) {
      // A revision ID is globally unique within this vault incarnation.
      if (revisionIds.has(rev.id)) return fail('equivocation')
      revisionIds.add(rev.id)
      if (rev.value.state === 'live') {
        const signature = JSON.stringify([item.id, item.kind, rev.value.sha256, rev.value.bytes])
        const old = payloads.get(rev.value.payloadId)
        if (old !== undefined && old !== signature) return fail('equivocation')
        payloads.set(rev.value.payloadId, signature)
      }
    }
  }
  const parsed: SyncManifest = { format: 'arty-sync-causal', version: 1, vaultId: uuid(root.vaultId), epoch: uuid(root.epoch), records }
  // All accepted fields are ASCII; length equals encoded UTF-8 bytes.
  if (JSON.stringify(parsed).length > L.manifestBytes) return fail('limit')
  return parsed
}

export function parseSyncChange(input: unknown): SyncChange {
  const change = fields(input, ['vaultId', 'epoch', 'recordId', 'kind', 'revision'])
  return { vaultId: uuid(change.vaultId), epoch: uuid(change.epoch), recordId: uuid(change.recordId), kind: kind(change.kind), revision: revision(change.revision) }
}

export function decodeSyncManifest(json: string): SyncManifest {
  if (typeof json !== 'string') return fail()
  if (json.length > L.manifestBytes || new TextEncoder().encode(json).length > L.manifestBytes) return fail('limit')
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return fail() }
  const manifest = parseSyncManifest(parsed)
  // One wire representation, produced by encodeSyncManifest. Also rejects
  // duplicate JSON members, alternate number spellings and hidden escapes.
  if (JSON.stringify(manifest) !== json) return fail()
  return manifest
}

export const encodeSyncManifest = (input: unknown): string => JSON.stringify(parseSyncManifest(input))
