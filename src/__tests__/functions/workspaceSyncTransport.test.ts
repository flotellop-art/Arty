/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeWorkspaceSyncHarness } from './workspaceSyncHarness'
import { parseSyncEnrollment, parseSyncPublication } from '../../services/workspaceSync/transportFormat'
import { createRemoteErasure, ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, ERASURE_SUBJECT_HEADER } from '../../services/accountErasureProtocol'
let h: Awaited<ReturnType<typeof makeWorkspaceSyncHarness>>
afterEach(async () => { if (h) await h.dispose() })
const auth = { Origin: 'https://tryarty.com', 'x-google-token': 'a' }
let packetClient = 0
async function enrollment(token = 'a') {
  const response = await h.request('challenge', { enrollmentId: crypto.randomUUID() }, token)
  expect(response.status).toBe(200)
  const challenge = parseSyncEnrollment(await response.json())
  const enrolled = await h.request('enroll', { enrollmentId: challenge.enrollmentId, generation: challenge.generation, consent: true }, token)
  expect(enrolled.status).toBe(200)
  expect(await enrolled.json()).toEqual(challenge)
  return challenge
}
async function packet(scope: { vaultId: string; epoch: string }, previous: string | null = null) {
  // Server treats these bytes as opaque; codec authenticity is tested separately.
  const bytes = new Uint8Array(200).fill(65), sha256 = await crypto.subtle.digest('SHA-256', bytes)
  const reference = { format: 'arty-sync-envelope-ref', version: 1, vaultId: scope.vaultId, epoch: scope.epoch,
    operationId: crypto.randomUUID(), bytes: bytes.length, sha256: Array.from(new Uint8Array(sha256), b => b.toString(16).padStart(2, '0')).join('') }
  const reserved = await h.request('reserve', { reference, expectedHead: previous }); expect(reserved.status).toBe(200)
  const url = (action: string) => `https://tryarty.com/api/workspace-sync/v1?${new URLSearchParams({ action, vaultId: scope.vaultId, epoch: scope.epoch, operationId: reference.operationId })}`
  // Distinct synthetic callers keep the chain-size test independent of the
  // real per-IP middleware throttle. No limiter/auth bypass in the handler.
  const headers = { ...auth, 'cf-connecting-ip': `198.51.100.${++packetClient % 200 + 1}` }
  const upload = (body = bytes) => h.mf.dispatchFetch(url('upload'), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body })
  const commit = () => h.mf.dispatchFetch(url('commit'), { method: 'POST', headers })
  return { reference, bytes, upload, commit, url }
}
async function erase() {
  const intent = await createRemoteErasure('google', 'a@example.test'), operationId = crypto.randomUUID()
  const headers = { Origin: auth.Origin, [ERASURE_OPERATION_HEADER]: operationId, [ERASURE_CAPABILITY_HEADER]: intent.capability }
  const post = () => h.mf.dispatchFetch('https://tryarty.com/api/account/erasure-v1', { method: 'POST', headers: { ...headers, 'x-google-token': 'a', [ERASURE_SUBJECT_HEADER]: intent.subjectHash } })
  const get = () => h.mf.dispatchFetch('https://tryarty.com/api/account/erasure-v1', { headers })
  const cleanup = () => h.mf.dispatchFetch('https://tryarty.com/api/account/erasure-cleanup-v1', { method: 'POST', headers })
  return { intent, operationId, headers, post, get, cleanup }
}
describe('real handlers and middleware on local D1/R2/workerd', () => {
  it('refuses OFF before auth/schema writes; only external Google HTTP is simulated', async () => {
    h = await makeWorkspaceSyncHarness('false')
    expect((await h.request('challenge', { enrollmentId: crypto.randomUUID() })).status).toBe(404)
    expect(h.authCalls).toEqual([])
    expect((await h.db.prepare('SELECT * FROM workspace_sync_subjects_v1').all()).results).toEqual([])
  })
  it('refuses missing/malformed sub, foreign audience and foreign Origin without writes', async () => {
    h = await makeWorkspaceSyncHarness()
    for (const token of ['missing-sub', 'bad-sub', 'wrong-audience']) expect((await h.request('challenge', { enrollmentId: crypto.randomUUID() }, token)).status).toBe(401)
    expect((await h.request('challenge', { enrollmentId: crypto.randomUUID() }, 'a', { Origin: 'https://evil.test' })).status).toBe(403)
    expect((await h.db.prepare('SELECT * FROM workspace_sync_subjects_v1').all()).results).toEqual([])
  })
  it('enrolls idempotently, uploads once, publishes once and retrieves exact bytes', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope)
    expect(await (await h.request('enroll', { enrollmentId: scope.enrollmentId, generation: scope.generation, consent: true })).json()).toEqual(scope)
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM workspace_sync_vaults_v1').first()).toEqual({ n: 1 })
    const reserved = await h.request('reserve', { reference: p.reference, expectedHead: null }); expect(reserved.status).toBe(200)
    expect((await h.request('reserve', { reference: { ...p.reference, sha256: '0'.repeat(64) }, expectedHead: null })).status).toBe(409)
    expect((await p.upload()).status).toBe(200); expect((await p.upload()).status).toBe(200)
    const a = parseSyncPublication(await (await p.commit()).json()), b = parseSyncPublication(await (await p.commit()).json())
    expect(a).toEqual(b); expect(a.reference).toEqual(p.reference)
    const raw = await h.mf.dispatchFetch(p.url('object'), { headers: auth })
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(p.bytes)
    expect(raw.headers.get('cache-control')).toBe('no-store')
    expect(await h.db.prepare('SELECT bytes,operations,sequence FROM workspace_sync_vaults_v1').first()).toEqual({ bytes: 200, operations: 1, sequence: 1 })
    expect((await h.mf.dispatchFetch(p.url('status'), { headers: { ...auth, 'x-google-token': 'b' } })).status).toBe(404)
  })
  it('gives one winner to concurrent CAS, keeps a definitive losing operation and a complete chain', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), a = await packet(scope), b = await packet(scope)
    await a.upload(); await b.upload()
    const results = await Promise.all([a.commit(), b.commit()]); const bodies = await Promise.all(results.map(r => r.json()))
    expect(bodies.map(b => (b as { status: string }).status).sort()).toEqual(['conflict', 'published'])
    const winner = parseSyncPublication(bodies.find(b => (b as { status: string }).status === 'published'))
    const c = await packet(scope, winner.head); await c.upload(); await c.commit()
    const params = new URLSearchParams({ action: 'chain', vaultId: scope.vaultId, epoch: scope.epoch, head: c.reference.operationId, after: '0' })
    const chain = await (await h.mf.dispatchFetch(`https://tryarty.com/api/workspace-sync/v1?${params}`, { headers: auth })).json() as { entries: unknown[] }
    expect(chain.entries.map(parseSyncPublication).map(p => p.sequence)).toEqual([1, 2])
    expect((await h.mf.dispatchFetch((winner.head === a.reference.operationId ? a : b).url('object'), { headers: auth })).status).toBe(200)
  })
  it('rejects legacy erasure without mutation, then cleans only the captured incarnation and defeats old replays', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope)
    await p.upload(); await p.commit()
    await h.db.prepare("INSERT INTO memory(user_id,category,data) VALUES('a@example.test','profile','synthetic')").run()
    expect((await h.mf.dispatchFetch('https://tryarty.com/api/account/delete', { method: 'POST', headers: auth })).status).toBe(409)
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM memory').first()).toEqual({ n: 1 })
    const deletion = await erase(); expect((await deletion.post()).status).toBe(409)
    expect((await h.mf.dispatchFetch(p.url('object'), { headers: auth })).status).toBe(410)
    expect((await deletion.get()).status).toBe(200)
    const clean = await deletion.cleanup(); expect(clean.status).toBe(200)
    expect(await clean.json()).toMatchObject({ status: 'confirmed' })
    expect(await (await h.mf.getR2Bucket('WORKSPACE_SYNC_BUCKET')).get(`workspace-sync-v1/${scope.vaultId}/${scope.epoch}/${p.reference.operationId}`)).toBeNull()
    const recreated = await enrollment(); expect(recreated.epoch).not.toBe(scope.epoch)
    expect(await (await deletion.post()).json()).toMatchObject({ status: 'confirmed' })
    expect(await (await deletion.cleanup()).json()).toMatchObject({ status: 'confirmed' })
    expect(await h.db.prepare('SELECT revoked FROM workspace_sync_vaults_v1 WHERE vault_id=?').bind(recreated.vaultId).first()).toEqual({ revoked: 0 })
    expect((await h.request('enroll', { enrollmentId: scope.enrollmentId, generation: scope.generation, consent: true })).status).toBe(409)
  })
  it('legacy erasure before consent rotates the generation and invalidates that old challenge', async () => {
    h = await makeWorkspaceSyncHarness()
    const c = parseSyncEnrollment(await (await h.request('challenge', { enrollmentId: crypto.randomUUID() })).json())
    expect((await h.mf.dispatchFetch('https://tryarty.com/api/account/delete', { method: 'POST', headers: auth })).status).toBe(200)
    expect((await h.request('enroll', { enrollmentId: c.enrollmentId, generation: c.generation, consent: true })).status).toBe(409)
    const replay = await h.request('challenge', { enrollmentId: c.enrollmentId }); expect(await replay.json()).toEqual(c)
    await enrollment()
  })
  it('blocks new starts without R2, but OFF does not block admitted upload, commit or cleanup', async () => {
    h = await makeWorkspaceSyncHarness('true', false)
    expect((await h.request('challenge', { enrollmentId: crypto.randomUUID() })).status).toBe(503)
    expect(h.authCalls).toEqual([])
    await h.configure('true'); const scope = await enrollment(), p = await packet(scope)
    await h.configure('false')
    expect((await h.request('reserve', { reference: p.reference, expectedHead: null })).status).toBe(404)
    expect((await p.upload()).status).toBe(200); expect((await p.commit()).status).toBe(200)
    const e = await erase(); await e.post()
    await h.configure('false', false)
    expect(await (await e.cleanup()).json()).toMatchObject({ status: 'cleanup-pending' })
    expect(await h.db.prepare('SELECT completed FROM account_erasure_receipts_v1').first()).toEqual({ completed: 0 })
    await h.configure('false')
    expect(await (await e.cleanup()).json()).toMatchObject({ status: 'confirmed' })
  })
  it('accounts for older revoked but unpurged vaults in a second erasure; GET and concurrent cleanup never invent settlement', async () => {
    h = await makeWorkspaceSyncHarness(); const v1 = await enrollment(), p = await packet(v1)
    await p.upload(); await p.commit()
    // Synthetic unknown writer models a crashed isolate, not a completed call.
    const attempt = crypto.randomUUID()
    await h.db.prepare('INSERT INTO workspace_sync_uploads_v1(attempt_id,vault_id,operation_id) VALUES(?,?,?)').bind(attempt, v1.vaultId, p.reference.operationId).run()
    const e1 = await erase(); await e1.post()
    const v2 = await enrollment(), foreign = await enrollment('b'), e2 = await erase(); await e2.post()
    const bucket = await h.mf.getR2Bucket('WORKSPACE_SYNC_BUCKET'), key = `workspace-sync-v1/${v1.vaultId}/${v1.epoch}/${p.reference.operationId}`
    const before = await bucket.head(key)
    const gets = await Promise.all([e1.get(), e2.get()]); expect(gets.every(r => r.status === 200)).toBe(true)
    const cleanups = await Promise.all([e1.cleanup(), e2.cleanup(), e2.cleanup()])
    for (const r of cleanups) expect(await r.json()).toMatchObject({ status: 'cleanup-pending' })
    expect((await bucket.head(key))?.etag).toBe(before?.etag)
    expect(new Uint8Array(await (await bucket.get(key))!.arrayBuffer())).toEqual(p.bytes)
    expect((await h.db.prepare('SELECT vault_id FROM workspace_sync_erasure_targets_v1 WHERE operation_id=?').bind(e2.operationId).all()).results.map(r => r.vault_id).sort()).toEqual([v1.vaultId, v2.vaultId].sort())
    expect(await h.db.prepare('SELECT revoked FROM workspace_sync_vaults_v1 WHERE vault_id=?').bind(foreign.vaultId).first()).toEqual({ revoked: 0 })
    // Explicit test fixture settlement is not a timeout-based production path.
    await h.db.prepare('UPDATE workspace_sync_uploads_v1 SET settled=1 WHERE attempt_id=?').bind(attempt).run()
    expect(await (await e2.cleanup()).json()).toMatchObject({ status: 'confirmed' })
    expect(await bucket.get(key)).toBeNull()
    expect(await (await e1.cleanup()).json()).toMatchObject({ status: 'confirmed' })
  })
  it('fails closed on a partial sync schema before either account deletion mutates data', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope); await p.upload(); await p.commit()
    await h.db.prepare("INSERT INTO memory(user_id,category,data) VALUES('a@example.test','profile','synthetic')").run()
    await h.db.prepare('DROP TABLE workspace_sync_subjects_v1').run()
    const e = await erase()
    expect((await e.post()).status).toBe(503)
    expect((await h.mf.dispatchFetch('https://tryarty.com/api/account/delete', { method: 'POST', headers: auth })).status).toBe(500)
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM memory').first()).toEqual({ n: 1 })
    expect(await h.db.prepare('SELECT revoked FROM workspace_sync_vaults_v1').first()).toEqual({ revoked: 0 })
    expect((await h.mf.dispatchFetch(p.url('object'), { headers: auth })).status).toBe(200)
    expect(await (await e.get()).json()).toMatchObject({ status: 'unknown' })
  })
  it('refuses actual nonempty commit/cleanup bodies, keeps reserved distinct from published and checks all cross-account routes', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope)
    expect((await h.request('enroll', { enrollmentId: scope.enrollmentId, generation: scope.generation, consent: true }, 'b')).status).toBe(409)
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM workspace_sync_vaults_v1').first()).toEqual({ n: 1 })
    expect(await (await p.commit()).json()).toMatchObject({ status: 'reserved' })
    expect((await h.mf.dispatchFetch(p.url('commit'), { method: 'POST', headers: auth, body: 'x' })).status).toBe(413)
    const foreign = { ...auth, 'x-google-token': 'b' }
    for (const action of ['upload', 'commit', 'status', 'object']) {
      const response = await h.mf.dispatchFetch(p.url(action), { method: action === 'upload' ? 'PUT' : action === 'commit' ? 'POST' : 'GET', headers: foreign })
      expect(response.status, action).toBe(404)
    }
    for (const action of ['head', 'chain']) {
      const params = new URLSearchParams({ action, vaultId: scope.vaultId, epoch: scope.epoch, ...(action === 'chain' ? { head: '', after: '0' } : {}) })
      expect((await h.mf.dispatchFetch(`https://tryarty.com/api/workspace-sync/v1?${params}`, { headers: foreign })).status).toBe(404)
    }
    expect((await h.request('reserve', { reference: p.reference, expectedHead: null }, 'b')).status).toBe(404)
    await p.upload(); await p.commit()
    const e = await erase(); await e.post()
    expect((await h.mf.dispatchFetch('https://tryarty.com/api/account/erasure-cleanup-v1', { method: 'POST', headers: e.headers, body: 'x' })).status).toBe(413)
    expect(await h.db.prepare('SELECT purged FROM workspace_sync_vaults_v1').first()).toEqual({ purged: 0 })
    const wrong = await h.mf.dispatchFetch('https://tryarty.com/api/account/erasure-cleanup-v1', { method: 'POST', headers: { ...e.headers, [ERASURE_CAPABILITY_HEADER]: '0'.repeat(64) } })
    expect(await wrong.json()).toMatchObject({ status: 'unknown' })
    expect(await h.db.prepare('SELECT purged FROM workspace_sync_vaults_v1').first()).toEqual({ purged: 0 })
  })
  it('does not let eight positively settled attempts deny a healthy retry', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope)
    for (let i = 0; i < 8; i++) await h.db.prepare('INSERT INTO workspace_sync_uploads_v1(attempt_id,vault_id,operation_id,settled) VALUES(?,?,?,1)')
      .bind(crypto.randomUUID(), scope.vaultId, p.reference.operationId).run()
    expect((await p.upload()).status).toBe(200)
    expect(parseSyncPublication(await (await p.commit()).json()).reference).toEqual(p.reference)
  })
  it('reserves capacity transactionally under concurrency without double charging retries', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope)
    const cap = 128 * 1024 * 1024
    // Synthetic near-capacity fixture avoids uploading 128 MiB in a unit test.
    await h.db.prepare('UPDATE workspace_sync_vaults_v1 SET bytes=?,operations=511 WHERE vault_id=?').bind(cap - 200, scope.vaultId).run()
    const refs = [0, 1].map(() => ({ ...p.reference, operationId: crypto.randomUUID() }))
    const reserves = await Promise.all(refs.map(reference => h.request('reserve', { reference, expectedHead: null })))
    expect(reserves.map(r => r.status).sort()).toEqual([200, 409])
    const winner = refs[reserves.findIndex(r => r.status === 200)]!
    expect((await h.request('reserve', { reference: winner, expectedHead: null })).status).toBe(200)
    expect(await h.db.prepare('SELECT bytes,operations FROM workspace_sync_vaults_v1').first()).toEqual({ bytes: cap, operations: 512 })
  })
  it('paginates an immutable anchor across a newer publication and refuses gaps or broken links', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment()
    const packets: Awaited<ReturnType<typeof packet>>[] = []
    for (let i = 0; i < 34; i++) {
      const p = await packet(scope, packets.at(-1)?.reference.operationId ?? null)
      expect((await p.upload()).status).toBe(200)
      expect(parseSyncPublication(await (await p.commit()).json()).sequence).toBe(i + 1)
      packets.push(p)
    }
    const anchor = packets.at(-1)!.reference.operationId
    const page = (after: number) => h.mf.dispatchFetch(`https://tryarty.com/api/workspace-sync/v1?${new URLSearchParams({ action: 'chain', vaultId: scope.vaultId, epoch: scope.epoch, head: anchor, after: String(after) })}`, { headers: auth })
    const first = await (await page(0)).json() as { entries: unknown[]; next: number }
    expect(first.entries.map(parseSyncPublication).map(p => p.sequence)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1)); expect(first.next).toBe(32)
    const newer = await packet(scope, anchor); await newer.upload(); await newer.commit()
    const second = await (await page(first.next)).json() as { entries: unknown[]; next: number | null; head: string }
    expect(second.entries.map(parseSyncPublication).map(p => p.sequence)).toEqual([33, 34]); expect(second.next).toBeNull(); expect(second.head).toBe(anchor)
    await h.db.prepare('UPDATE workspace_sync_operations_v1 SET expected_head=? WHERE vault_id=? AND sequence=33').bind(packets[0]!.reference.operationId, scope.vaultId).run()
    expect((await page(32)).status).toBe(409)
    await h.db.prepare('DELETE FROM workspace_sync_operations_v1 WHERE vault_id=? AND sequence=10').bind(scope.vaultId).run()
    expect((await page(0)).status).toBe(409)
  }, 30_000)
  it('revokes an admitted upload while its HTTP body is held, then cleans after positive storage settlement', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope)
    let body!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; controller.enqueue(p.bytes.slice(0, 1)) } })
    const uploading = h.mf.dispatchFetch(p.url('upload'), { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: stream, duplex: 'half' })
    void uploading.catch(() => {})
    try {
      await vi.waitFor(async () => expect(await h.db.prepare('SELECT COUNT(*) AS n FROM workspace_sync_uploads_v1 WHERE settled=0').first()).toEqual({ n: 1 }), { timeout: 5000 })
      const e = await erase(); await e.post()
      expect(await (await e.cleanup()).json()).toMatchObject({ status: 'cleanup-pending' })
      expect(await h.db.prepare('SELECT purged FROM workspace_sync_vaults_v1').first()).toEqual({ purged: 0 })
      body.enqueue(p.bytes.slice(1)); body.close()
      expect((await uploading).status).toBe(410)
      expect(await h.db.prepare('SELECT COUNT(*) AS n FROM workspace_sync_uploads_v1 WHERE settled=0').first()).toEqual({ n: 0 })
      expect(await (await e.cleanup()).json()).toMatchObject({ status: 'confirmed' })
      const bucket = await h.mf.getR2Bucket('WORKSPACE_SYNC_BUCKET')
      expect(await bucket.get(`workspace-sync-v1/${scope.vaultId}/${scope.epoch}/${p.reference.operationId}`)).toBeNull()
    } finally { try { body.error(new Error('test complete')) } catch { /* stream settled */ }; await uploading.catch(() => {}) }
  }, 15_000)
  it('rolls back account deletions, revocation targets and generation on a real D1 failure', async () => {
    h = await makeWorkspaceSyncHarness(); const scope = await enrollment(), p = await packet(scope); await p.upload(); await p.commit()
    await h.db.prepare("INSERT INTO memory(user_id,category,data) VALUES('a@example.test','profile','synthetic')").run()
    const before = await h.db.prepare('SELECT * FROM workspace_sync_subjects_v1').first()
    await h.db.prepare("CREATE TRIGGER sync_test_failure BEFORE UPDATE OF revoked ON workspace_sync_vaults_v1 BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").run()
    const e = await erase()
    expect((await e.post()).status).toBe(503)
    expect(await h.db.prepare('SELECT * FROM workspace_sync_subjects_v1').first()).toEqual(before)
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM memory').first()).toEqual({ n: 1 })
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM workspace_sync_erasure_targets_v1').first()).toEqual({ n: 0 })
    expect(await (await e.get()).json()).toMatchObject({ status: 'unknown' })
    expect((await h.mf.dispatchFetch(p.url('object'), { headers: auth })).status).toBe(200)
  })
})
