import { SyncProtocolError, type SyncManifest, type SyncRecord, type SyncRevision } from './types'
import { byId, parseSyncChange, parseSyncManifest, recordHeads } from './schema'

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const fail = (code: SyncProtocolError['code']): never => { throw new SyncProtocolError(code) }

function scope(a: SyncManifest, b: SyncManifest): void {
  if (a.vaultId !== b.vaultId || a.epoch !== b.epoch) fail('scope')
}

/** An ACK checkpoint is an exact retained ancestry, never just a timestamp or
 * a plaintext fingerprint. An absent record is NOT a deletion. Pruned bases
 * require explicit rebase; the caller must not reinterpret this as empty. */
function retains(base: SyncManifest, next: SyncManifest): void {
  scope(base, next)
  const records = new Map(next.records.map(item => [item.id, item]))
  for (const before of base.records) {
    const after = records.get(before.id)
    if (!after) return fail('rebase')
    if (before.kind !== after.kind) fail('equivocation')
    const revisions = new Map(after.revisions.map(item => [item.id, item]))
    for (const rev of before.revisions) {
      const candidate = revisions.get(rev.id)
      if (!candidate) fail('rebase')
      if (!same(rev, candidate)) fail('equivocation')
    }
  }
}

/** Pure, deterministic join, after checking BOTH copies retain the same ACK
 * checkpoint. All concurrent heads survive, even equal-content edits and
 * update/delete conflicts. No clock, transport, storage or LWW winner. */
export function reconcileSyncManifests(baseInput: unknown, localInput: unknown, remoteInput: unknown): SyncManifest {
  const base = parseSyncManifest(baseInput), local = parseSyncManifest(localInput), remote = parseSyncManifest(remoteInput)
  retains(base, local); retains(base, remote)
  const records = new Map(local.records.map(item => [item.id, item]))
  for (const incoming of remote.records) {
    const current = records.get(incoming.id)
    if (!current) { records.set(incoming.id, incoming); continue }
    if (current.kind !== incoming.kind) fail('equivocation')
    const revisions = new Map(current.revisions.map(item => [item.id, item]))
    for (const rev of incoming.revisions) {
      const existing = revisions.get(rev.id)
      if (existing && !same(existing, rev)) fail('equivocation')
      revisions.set(rev.id, rev)
    }
    records.set(current.id, { ...current, revisions: [...revisions.values()].sort(byId) })
  }
  // The UNION may exceed a bound or equivocate across separate objects even
  // when each input was individually valid. Never trim to make it fit.
  return parseSyncManifest({ ...local, records: [...records.values()] })
}

/** Stage one explicit local intention. The caller supplies and DURABLY retains
 * the revision UUID, parents and immutable payload before a network attempt.
 * This function does not itself implement an outbox or an acknowledgement. */
export function stageSyncChange(manifestInput: unknown, changeInput: unknown): SyncManifest {
  const manifest = parseSyncManifest(manifestInput), change = parseSyncChange(changeInput)
  if (change.vaultId !== manifest.vaultId || change.epoch !== manifest.epoch) fail('scope')
  const current = manifest.records.find(item => item.id === change.recordId)
  if (current && current.kind !== change.kind) fail('equivocation')
  for (const entry of manifest.records) {
    const existing = entry.revisions.find(item => item.id === change.revision.id)
    if (existing) {
      if (entry.id !== change.recordId || !same(existing, change.revision)) fail('equivocation')
      return manifest // Exact retry remains a no-op even after descendants.
    }
  }
  const expected = current ? recordHeads(current).map(item => item.id).sort() : []
  if (!same(expected, change.revision.parents)) fail('changed')
  // For a conflict this requires ALL displayed heads, never just a selected
  // winner. Consent and user intent must still be established by the future UI.
  const updated: SyncRecord = { id: change.recordId, kind: change.kind, revisions: [...(current?.revisions ?? []), change.revision] }
  return parseSyncManifest({ ...manifest, records: [...manifest.records.filter(item => item.id !== change.recordId), updated] })
}

/** Readonly projection of maximal variants. A deleted head paired with a live
 * head is a CONFLICT, not authorization to erase the local object. */
export function syncVariants(manifestInput: unknown): { recordId: string; kind: SyncRecord['kind']; heads: SyncRevision[]; conflict: boolean }[] {
  return parseSyncManifest(manifestInput).records.map(entry => {
    const heads = recordHeads(entry)
    return { recordId: entry.id, kind: entry.kind, heads, conflict: heads.length > 1 }
  })
}
