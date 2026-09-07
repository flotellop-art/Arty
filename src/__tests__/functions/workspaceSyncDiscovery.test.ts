/** @vitest-environment node */
import { afterEach, describe, expect, it } from 'vitest'
import { makeWorkspaceSyncHarness } from './workspaceSyncHarness'
import { parseSyncDiscovery, parseSyncEnrollment, SYNC_TRANSPORT_PATH } from '../../services/workspaceSync/transportFormat'
import { createRemoteErasure, ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, ERASURE_SUBJECT_HEADER } from '../../services/accountErasureProtocol'

let h: Awaited<ReturnType<typeof makeWorkspaceSyncHarness>> | undefined
afterEach(async () => { await h?.dispose(); h = undefined })
const tables = ['subjects', 'enrollments', 'vaults', 'operations', 'uploads', 'erasure_targets'].map(t => `workspace_sync_${t}_v1`)
const auth = { Origin: 'https://tryarty.com', 'x-google-token': 'a' }
const discover = (token = 'a', suffix = '') => h!.mf.dispatchFetch(`https://tryarty.com${SYNC_TRANSPORT_PATH}?action=discover${suffix}`, { headers: { ...auth, 'x-google-token': token } })
async function enroll() {
  const challenge = parseSyncEnrollment(await (await h!.request('challenge', { enrollmentId: crypto.randomUUID() })).json())
  expect((await h!.request('enroll', { enrollmentId: challenge.enrollmentId, generation: challenge.generation, consent: true })).status).toBe(200)
  return challenge
}
async function snapshot() {
  const schema = (await h!.db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'workspace_sync_*' ORDER BY name").all()).results
  const rows = await Promise.all(tables.map(async t => (await h!.db.prepare(`SELECT * FROM ${t}`).all()).results))
  return { schema, rows }
}
async function joinCurrent() {
  const current = parseSyncDiscovery(await (await discover()).json())
  if (current.status !== 'active') throw new Error('fixture vault missing')
  return { generation: current.generation, vaultId: current.vaultId, epoch: current.epoch, consent: true }
}

describe('discovery and exact consent, actual middleware/handlers/D1', () => {
  it('observes none without creating a registry, challenge, vault or other state', async () => {
    h = await makeWorkspaceSyncHarness()
    const before = await snapshot(), response = await discover()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBe(auth.Origin)
    expect(parseSyncDiscovery(await response.json())).toEqual({ protocol: 1, status: 'none' })
    expect(await snapshot()).toEqual(before)
  })
  it('joins the discovered incarnation with no new challenge or writes; null head remains preparation', async () => {
    h = await makeWorkspaceSyncHarness(); const enrolled = await enroll(), before = await snapshot()
    const observed = parseSyncDiscovery(await (await discover()).json())
    expect(observed).toEqual({ protocol: 1, status: 'active', generation: enrolled.generation,
      vaultId: enrolled.vaultId, epoch: enrolled.epoch, head: null, sequence: 0 })
    const body = await joinCurrent()
    for (let i = 0; i < 2; i++) {
      const response = await h.request('join', body)
      expect(response.status).toBe(200); expect(parseSyncDiscovery(await response.json())).toEqual(observed)
    }
    expect(await snapshot()).toEqual(before)
  })
  it('keeps empty discovery distinct from the durable creation challenge', async () => {
    h = await makeWorkspaceSyncHarness()
    await h.request('challenge', { enrollmentId: crypto.randomUUID() })
    const before = await snapshot()
    expect(await (await discover()).json()).toEqual({ protocol: 1, status: 'none' })
    expect(await snapshot()).toEqual(before)
  })
  it('observes a real published head without treating join as a publication ACK', async () => {
    h = await makeWorkspaceSyncHarness(); const enrolled = await enroll(), body = await joinCurrent()
    // Opaque server fixture, not a genesis or proof of the encryption codec.
    const bytes = new Uint8Array(200).fill(17), hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const reference = { format: 'arty-sync-envelope-ref', version: 1, vaultId: enrolled.vaultId, epoch: enrolled.epoch,
      operationId: crypto.randomUUID(), bytes: bytes.length, sha256: Array.from(hash, b => b.toString(16).padStart(2, '0')).join('') }
    expect((await h.request('reserve', { reference, expectedHead: null })).status).toBe(200)
    const url = (action: string) => `https://tryarty.com${SYNC_TRANSPORT_PATH}?${new URLSearchParams({ action,
      vaultId: enrolled.vaultId, epoch: enrolled.epoch, operationId: reference.operationId })}`
    expect((await h.mf.dispatchFetch(url('upload'), { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: bytes })).status).toBe(200)
    expect((await h.mf.dispatchFetch(url('commit'), { method: 'POST', headers: auth })).status).toBe(200)
    const before = await snapshot(), observed = parseSyncDiscovery(await (await discover()).json())
    expect(observed).toEqual({ protocol: 1, status: 'active', generation: enrolled.generation, vaultId: enrolled.vaultId,
      epoch: enrolled.epoch, head: reference.operationId, sequence: 1 })
    // Consent fixes incarnation, not a now-outdated head observation.
    expect(parseSyncDiscovery(await (await h.request('join', body)).json())).toEqual(observed)
    expect(await snapshot()).toEqual(before)
  })
  it('does not discover or join A through another subject, including the same verified email', async () => {
    h = await makeWorkspaceSyncHarness(); await enroll(); const body = await joinCurrent(), before = await snapshot()
    for (const token of ['b', 'same-email-other-sub']) {
      expect(await (await discover(token)).json()).toEqual({ protocol: 1, status: 'none' })
      expect((await h.request('join', body, token)).status).toBe(409)
    }
    for (const token of ['missing-sub', 'bad-sub', 'wrong-audience', 'invalid']) {
      expect((await discover(token)).status).toBe(401)
      expect((await h.request('join', body, token)).status).toBe(401)
    }
    expect(await snapshot()).toEqual(before)
  })
  it('refuses stale consent after actual erasure and recreation without joining the replacement', async () => {
    h = await makeWorkspaceSyncHarness(); await enroll(); const original = await joinCurrent()
    const intent = await createRemoteErasure('google', 'a@example.test')
    const response = await h.mf.dispatchFetch('https://tryarty.com/api/account/erasure-v1', { method: 'POST', headers: {
      ...auth, [ERASURE_OPERATION_HEADER]: crypto.randomUUID(), [ERASURE_CAPABILITY_HEADER]: intent.capability,
      [ERASURE_SUBJECT_HEADER]: intent.subjectHash } })
    expect(response.status).toBe(202)
    expect(await (await discover()).json()).toEqual({ protocol: 1, status: 'none' })
    expect((await h.request('join', original)).status).toBe(409)
    const replacement = await enroll(), before = await snapshot()
    expect(replacement.generation).not.toBe(original.generation)
    expect((await h.request('join', original)).status).toBe(409)
    expect((await h.request('join', { ...original, vaultId: replacement.vaultId, epoch: replacement.epoch })).status).toBe(409)
    expect(await snapshot()).toEqual(before)
    expect((await h.request('join', await joinCurrent())).status).toBe(200)
  })
  it('requires exact closed consent and query shape without changing the observed vault', async () => {
    h = await makeWorkspaceSyncHarness(); await enroll(); const body = await joinCurrent(), before = await snapshot()
    for (const changed of [{ ...body, consent: false }, { ...body, consent: 'true' }, { ...body, email: 'a@example.test' },
      { ...body, vaultId: crypto.randomUUID() }, { ...body, epoch: crypto.randomUUID() }, { ...body, generation: crypto.randomUUID() }]) {
      expect([400, 409]).toContain((await h.request('join', changed)).status)
    }
    expect((await discover('a', '&vaultId=' + body.vaultId)).status).toBe(400)
    expect((await discover('a', '&action=discover')).status).toBe(400)
    expect((await h.request('join', body, 'a', { Origin: 'https://foreign.test' })).status).toBe(403)
    expect(await snapshot()).toEqual(before)
  })
  it('START gates every new join before auth/body/SQL; discovery and admitted head reads survive OFF', async () => {
    h = await makeWorkspaceSyncHarness(); const enrolled = await enroll(), body = await joinCurrent()
    for (const flag of ['false', '', 'TRUE', '1']) {
      await h.configure(flag)
      const calls = h.authCalls.length
      expect((await h.request('join', { malformed: true }, 'invalid')).status).toBe(404)
      expect(h.authCalls).toHaveLength(calls)
      expect((await discover()).status).toBe(200)
      const params = new URLSearchParams({ action: 'head', vaultId: enrolled.vaultId, epoch: enrolled.epoch })
      expect((await h.mf.dispatchFetch(`https://tryarty.com${SYNC_TRANSPORT_PATH}?${params}`, { headers: auth })).status).toBe(200)
    }
    await h.configure('true', false); const calls = h.authCalls.length
    expect((await h.request('join', body)).status).toBe(503); expect(h.authCalls).toHaveLength(calls)
    expect((await discover()).status).toBe(200)
  })
  it.each(tables)('fails closed with a partial schema missing %s', async table => {
    h = await makeWorkspaceSyncHarness(); await enroll(); const body = await joinCurrent()
    await h.db.prepare(`DROP TABLE ${table}`).run()
    expect((await discover()).status).toBe(503)
    expect((await h.request('join', body)).status).toBe(503)
  })
  it('does not call an absent schema an empty account or recreate it', async () => {
    h = await makeWorkspaceSyncHarness()
    for (const table of tables) await h.db.prepare(`DROP TABLE ${table}`).run()
    expect((await discover()).status).toBe(503)
    expect((await h.db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'workspace_sync_*'").all()).results).toEqual([])
  })
  it('returns unavailable, never none, when the actual discovery query cannot execute', async () => {
    h = await makeWorkspaceSyncHarness(); await enroll(); const body = await joinCurrent()
    // Keep all expected table names but break the SQL read, modeling a corrupt
    // restored schema rather than replacing the handler/database with a mock.
    await h.db.prepare('ALTER TABLE workspace_sync_subjects_v1 RENAME COLUMN generation TO broken_generation').run()
    const observed = await discover(), joined = await h.request('join', body)
    expect(observed.status).toBe(503); expect(joined.status).toBe(503)
    expect(await observed.json()).toEqual({ error: 'sync_request_unavailable' })
    expect(await joined.json()).toEqual({ error: 'sync_request_unavailable' })
  })
  it.each(['registry', 'enrollment', 'generation', 'subject', 'purged', 'head', 'sequence'])('does not hide an inconsistent active vault: %s', async damage => {
    h = await makeWorkspaceSyncHarness(); await enroll(); const body = await joinCurrent()
    const sql: Record<string, string> = {
      registry: 'DELETE FROM workspace_sync_subjects_v1', enrollment: 'DELETE FROM workspace_sync_enrollments_v1',
      generation: "UPDATE workspace_sync_subjects_v1 SET generation='00000000-0000-4000-8000-000000000001'",
      subject: "UPDATE workspace_sync_enrollments_v1 SET subject_hash='foreign'",
      purged: 'UPDATE workspace_sync_vaults_v1 SET purged=1',
      head: "UPDATE workspace_sync_vaults_v1 SET head='00000000-0000-4000-8000-000000000001'",
      sequence: 'UPDATE workspace_sync_vaults_v1 SET sequence=1',
    }
    await h.db.prepare(sql[damage]!).run(); const before = await snapshot()
    expect((await discover()).status).toBe(409)
    expect((await h.request('join', body)).status).toBe(409)
    expect(await snapshot()).toEqual(before)
  })
  it('refuses multiple active vaults even if the database uniqueness constraint was lost', async () => {
    h = await makeWorkspaceSyncHarness(); await enroll(); const body = await joinCurrent()
    await h.db.prepare('DROP INDEX workspace_sync_active_subject_v1').run()
    await h.db.prepare(`INSERT INTO workspace_sync_vaults_v1(vault_id,epoch,subject_hash)
      SELECT ?1,?2,subject_hash FROM workspace_sync_subjects_v1`).bind(crypto.randomUUID(), crypto.randomUUID()).run()
    const before = await snapshot()
    expect((await discover()).status).toBe(409)
    expect((await h.request('join', body)).status).toBe(409)
    expect(await snapshot()).toEqual(before)
  })
})

describe('closed discovery observation parser, no authority implied', () => {
  const value = { protocol: 1, status: 'active', generation: crypto.randomUUID(), vaultId: crypto.randomUUID(), epoch: crypto.randomUUID(), head: null, sequence: 0 }
  it('accepts exactly none or a coherent active head observation', () => {
    expect(parseSyncDiscovery({ protocol: 1, status: 'none' })).toEqual({ protocol: 1, status: 'none' })
    expect(parseSyncDiscovery(value)).toEqual(value)
    const published = { ...value, head: crypto.randomUUID(), sequence: 1 }
    expect(parseSyncDiscovery(published)).toEqual(published)
  })
  it('rejects extra fields, accessors, prototypes and incoherent checkpoints', () => {
    for (const bad of [{ protocol: 1, status: 'none', vaultId: value.vaultId }, { ...value, secret: 'never' },
      { ...value, sequence: 1 }, { ...value, head: crypto.randomUUID() }, { ...value, sequence: -1 },
      { ...value, generation: '' }, { ...value, protocol: 2 }, { ...value, status: 'joined' }, Object.create(value)]) {
      expect(() => parseSyncDiscovery(bad)).toThrow()
    }
    let calls = 0
    const accessor = { ...value, get status() { calls++; return 'active' } }
    expect(() => parseSyncDiscovery(accessor)).toThrow(); expect(calls).toBe(0)
  })
})
