/** Same-document coordination, never server/IDB authority. Restore's final
 * proof spans different databases, so a sync writer cannot enter its commit
 * window. The monotone stamp also detects writes that finished between checks. */
let writers = 0, revision = 0, publishing = false
const refuse = (): never => { throw new Error('workspace_sync_publication_busy') }
export function beginLocalSyncWrite() {
  if (publishing) return refuse()
  writers++; revision++
  let done = false
  return () => { if (!done) { done = true; writers-- } }
}
export function captureLocalSyncQuiescence() {
  const captured = revision
  const assertCurrent = () => { if (writers || captured !== revision) refuse() }
  return { assertCurrent, claimPublication() {
    assertCurrent(); if (publishing) return refuse()
    publishing = true
    let done = false
    return () => { if (!done) { done = true; publishing = false } }
  } }
}
