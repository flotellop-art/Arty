/** Internal candidate protocol. Nothing here activates sync or grants access.
 * This entire manifest, including IDs, parents and plaintext commitments, must
 * be encrypted BEFORE upload. These types are not a public server index. */
export const SYNC_LIMITS = {
  manifestBytes: 4 * 1024 * 1024,
  records: 2000,
  revisions: 10_000,
  revisionsPerRecord: 256,
  headsPerRecord: 16,
  objectBytes: 10 * 1024 * 1024,
} as const

export type SyncKind = 'conversation' | 'project' | 'file' | 'project-source' | 'project-text'
export type SyncValue = { state: 'deleted' } | {
  state: 'live'
  /** Stable opaque reference to an immutable payload, not a URL or local ID. */
  payloadId: string
  /** PRIVATE plaintext commitment; forbidden in the unencrypted server index. */
  sha256: string
  bytes: number
}
export interface SyncRevision {
  id: string
  intent: 'create' | 'edit' | 'delete' | 'restore' | 'resolve'
  /** All heads actually observed/consented to when this revision was created. */
  parents: string[]
  value: SyncValue
}
export interface SyncRecord {
  id: string
  kind: SyncKind
  /** Closed causal DAG, including dominated revisions and explicit tombstones.
   * No silent GC. Hitting a bound requires a future coordinated checkpoint. */
  revisions: SyncRevision[]
}
export interface SyncManifest {
  format: 'arty-sync-causal'
  version: 1
  vaultId: string
  /** Server-issued incarnation, not local ownerEpoch or a client timestamp. */
  epoch: string
  records: SyncRecord[]
}
export interface SyncChange {
  vaultId: string
  epoch: string
  recordId: string
  kind: SyncKind
  revision: SyncRevision
}
export class SyncProtocolError extends Error {
  constructor(public readonly code: 'format' | 'limit' | 'scope' | 'equivocation' | 'rebase' | 'changed') {
    super(`sync_${code}`); this.name = 'SyncProtocolError'
  }
}
