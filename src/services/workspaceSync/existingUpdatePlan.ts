import { canonicalSyncJSON } from './captureContent'
import { decodeSyncContent, type SyncContent } from './content'
import { assertEnvelopeScope, envelopeFail as fail } from './envelopeFormat'
import { createSyncReceiveMapping } from './receiveMapping'
import { createSyncReadMapping } from './captureMapping'
import { parseSyncManifest, recordHeads } from './schema'
import type { SyncManifest, SyncRecord } from './types'
import type { SyncLocalBinding } from './privateState'
import type { ReceivedSyncChain } from './reception'
import type { ReviewedSyncContent } from './receivedContent'

export type SyncUpdateReason = 'unchanged' | 'new-record' | 'conflict' | 'deleted' | 'causal-gap' | 'dependency-change' | 'unsupported-change' | 'local-change'
const equal = (a: unknown, b: unknown) => canonicalSyncJSON(a) === canonicalSyncJSON(b)
function descendant(before: SyncRecord, after: SyncRecord): boolean {
  const revisions = new Map(after.revisions.map(r => [r.id, r]))
  if (before.kind !== after.kind || before.revisions.some(r => !revisions.has(r.id) || !equal(r, revisions.get(r.id)))) return false
  const target = recordHeads(before)[0]!.id, queue = [...recordHeads(after)[0]!.parents], seen = new Set<string>()
  while (queue.length) {
    const id = queue.pop()!
    if (id === target) return true
    if (!seen.has(id)) { seen.add(id); queue.push(...revisions.get(id)!.parents) }
  }
  return false
}
function allowed(before: SyncContent, after: SyncContent): boolean {
  if (before.kind === 'project' && after.kind === 'project') {
    const { name: _a, instructions: _b, updatedAt: _c, ...rest } = before.data
    const { name: _d, instructions: _e, updatedAt: _f, ...next } = after.data
    return equal(rest, next)
  }
  if (before.kind !== 'conversation' || after.kind !== 'conversation') return false
  const a = before.data.conversation, b = after.data.conversation
  if (a.createdAt !== b.createdAt || a.euOnly !== b.euOnly || a.projectId !== b.projectId || a.outputRestriction && a.outputRestriction !== b.outputRestriction ||
    ['hasGoogleData', 'hasProjectContext', 'hasTrailContext'].some(k => a[k as keyof typeof a] === true && b[k as keyof typeof b] !== true) ||
    !equal(a.comparison ?? null, b.comparison ?? null) || !equal(before.data.galleryAliases, after.data.galleryAliases)) return false
  const old = new Map(a.messages.map(m => [m.id, m])), next = new Map(b.messages.map(m => [m.id, m]))
  // Message deletion and attachment replacement have separate later consent.
  if (a.messages.some(m => !next.has(m.id))) return false
  for (const m of b.messages) {
    const previous = old.get(m.id)
    if (!previous) { if (m.files?.length || m.generatedImages?.length) return false; continue }
    if (previous.role !== m.role || !equal(previous.files ?? null, m.files ?? null) ||
      !equal(previous.generatedImages ?? null, m.generatedImages ?? null) || !equal(previous.projectTurn ?? null, m.projectTurn ?? null) ||
      previous.restoredArchive === true && m.restoredArchive !== true) return false
  }
  return true
}
const dependencies = (c: SyncContent): string[] => c.kind === 'project' ? c.data.documents.flatMap(d => [d.sourceId, d.textId]) :
  c.kind === 'conversation' ? [...new Set(c.data.conversation.messages.flatMap(m => [...(m.files ?? []).map(f => f.id), ...(m.generatedImages ?? [])]))] : []

/** Private plan BEFORE projection/allocation. Whole-receipt identity review
 * remains mandatory; unrelated remote conflicts are retained, never winners.
 * This plan alone is NOT proof that B==M nor permission to write. */
export async function planExistingSyncUpdate(args: { materialized: SyncManifest; bindings: SyncLocalBinding[]; receipt: ReceivedSyncChain; reviewed: ReviewedSyncContent }) {
  const materialized = parseSyncManifest(args.materialized), remote = args.receipt.manifest
  assertEnvelopeScope(materialized, remote); createSyncReadMapping(materialized, args.bindings)
  if (materialized.records.some(r => recordHeads(r).length !== 1)) return fail('base')
  const baseline = new Map(materialized.records.map(r => [r.id, r])), variants = args.reviewed.variants
  const records = new Map(remote.records.map(r => [r.id, r]))
  const retained: { recordId: string; reason: SyncUpdateReason }[] = [], candidates: { record: SyncRecord; content: SyncContent; dependencies: string[] }[] = []
  const assertCurrent = () => { args.receipt.assertCurrent(); args.reviewed.assertCurrent() }
  for (const record of remote.records) {
    assertCurrent()
    const before = baseline.get(record.id), heads = recordHeads(record), oldHeads = before && recordHeads(before)
    let reason: SyncUpdateReason | undefined
    if (!before) reason = 'new-record'
    else if (heads.length !== 1) reason = 'conflict'
    else if (heads[0]!.value.state !== 'live' || oldHeads![0]!.value.state !== 'live') reason = 'deleted'
    else if (heads[0]!.id === oldHeads![0]!.id && equal(record, before)) reason = 'unchanged'
    else if (!descendant(before, record)) reason = 'causal-gap'
    else if (record.kind !== 'conversation' && record.kind !== 'project') reason = 'unsupported-change'
    if (reason) { retained.push({ recordId: record.id, reason }); continue }
    const content = variants.find(v => v.recordId === record.id && v.revisionId === heads[0]!.id)?.content ?? fail('missing')
    const deps = dependencies(content)
    if (args.reviewed.report.dependencyIssues.some(issue => issue.recordId === record.id) || deps.some(id => {
      const m = baseline.get(id), r = records.get(id)
      if (!m || !r || m.kind !== r.kind || recordHeads(r).length !== 1) return true
      const a = recordHeads(m)[0]!.value, b = recordHeads(r)[0]!.value
      return a.state !== 'live' || b.state !== 'live' || a.sha256 !== b.sha256 || a.bytes !== b.bytes
    })) { retained.push({ recordId: record.id, reason: 'dependency-change' }); continue }
    const oldValue = oldHeads![0]!.value
    if (oldValue.state !== 'live') return fail('base')
    const oldContent = await decodeSyncContent(args.receipt.payload(oldValue.payloadId), before!, assertCurrent); assertCurrent()
    if (!allowed(oldContent, content)) { retained.push({ recordId: record.id, reason: 'unsupported-change' }); continue }
    candidates.push({ record, content, dependencies: deps })
  }
  const targets = [...new Set(candidates.flatMap(c => [c.record.id, ...c.dependencies]))]
  return Object.freeze({ targets: Object.freeze(targets), assertCurrent,
    /** The warm owner holds the real coverage until journal adoption. No
     * allocation takes place for rejected/unmaterialized remote records. */
    project(isEqual: (id: string) => boolean, reserve: () => string) {
      assertCurrent()
      const reasons = structuredClone(retained)
      const selected = candidates.filter(c => {
        if ([c.record.id, ...c.dependencies].every(isEqual)) return true
        reasons.push({ recordId: c.record.id, reason: 'local-change' }); return false
      })
      const mapping = createSyncReceiveMapping(materialized, args.bindings, () => { assertCurrent(); return reserve() })
      for (const c of selected) if (c.content.kind === 'project') for (const d of c.content.data.documents) mapping.documentPair(c.record.id, d.sourceId, d.textId)
      const projected = selected.map(c => ({ recordId: c.record.id, content: mapping.projectContent(c.record.id, c.content) }))
      const bindings = mapping.bindings, prior = new Map(args.bindings.map(b => [b.logicalId, b]))
      if (bindings.some(b => b.presence === 'record' && (!prior.has(b.logicalId) || prior.get(b.logicalId)!.presence !== 'record'))) return fail('base')
      const updates = new Map(selected.map(c => [c.record.id, c.record]))
      const after = parseSyncManifest({ ...materialized, records: materialized.records.map(r => updates.get(r.id) ?? r) })
      assertCurrent()
      return { projected, bindings, materialized: after, retained: reasons }
    },
  })
}
