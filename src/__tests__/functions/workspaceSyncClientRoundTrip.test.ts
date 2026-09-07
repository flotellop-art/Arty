/** @vitest-environment node */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { JSDOM } from 'jsdom'
import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeWorkspaceSyncHarness } from './workspaceSyncHarness'
import { deferred } from '../helpers/workspaceLocks'
import type { SyncPrivateState } from '../../services/workspaceSync/privateState'
import type { Conversation } from '../../types'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true,
  WORKSPACE_RESTORE_START_ENABLED: true, WORKSPACE_UPGRADE_START_ENABLED: true }))
vi.mock('../../services/workspaceSync/activation', () => ({ WORKSPACE_SYNC_APPLY_START_ENABLED: true }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => `https://tryarty.com${path}` }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }))

const code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
const wrong = code.replace('00112233', '00112234')
const selection = { conversationIds: ['chat'], projectIds: [] }
type Profile = { dom: JSDOM; idb: IDBFactory }
type Exchange = { action: string; request: Request; response: Response }
let h: Awaited<ReturnType<typeof makeWorkspaceSyncHarness>>, profiles: Profile[], profile: Profile
let runtime: typeof import('../../services/workspaceWriter/runtime') | undefined, lock: ReturnType<typeof deferred>
let exchanges: Exchange[], afterResponse: ((exchange: Exchange) => Promise<Response>) | undefined
let beforeRequest: ((action: string, request: Request) => Promise<void>) | undefined

async function endDocument() {
  lock?.resolve()
  if (runtime) await vi.waitFor(() => expect(runtime!.documentWorkspaceSignal.aborted).toBe(true))
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  vi.stubGlobal('navigator', { locks: { request(_n: unknown, _o: unknown, callback: (v: unknown) => Promise<void>) { void callback({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime'); await runtime.documentWorkspace.acquire()
}
async function login() {
  const users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
  users.setActiveSession({ userId: 'a', authMethod: 'google', email: 'a@example.test', displayName: 'A', createdAt: 1 })
  await crypt.initCrypto('synthetic-key-a')
  await relink()
}
async function relink() {
  // Actual encrypted Google storage and captured-grant implementation. Only
  // Google's external tokeninfo HTTP is simulated by the workerd harness.
  const google = await import('../../services/googleAuth')
  await google.storeUser({ email: 'a@example.test', name: 'A', picture: '' })
  await google.storeMailboxFreeGrant({ access_token: 'a', refresh_token: 'synthetic-refresh-a', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: 'a@example.test' })
}
async function switchProfile(next: Profile) {
  await endDocument(); runtime = undefined; profile = next
  vi.stubGlobal('window', next.dom.window); vi.stubGlobal('document', next.dom.window.document)
  vi.stubGlobal('localStorage', next.dom.window.localStorage); vi.stubGlobal('sessionStorage', next.dom.window.sessionStorage)
  vi.stubGlobal('CustomEvent', next.dom.window.CustomEvent); vi.stubGlobal('indexedDB', next.idb)
  await newDocument()
}
async function prepareProfile() {
  const next = { dom: new JSDOM('', { url: 'https://tryarty.com/' }), idb: new IDBFactory() }; profiles.push(next)
  await switchProfile(next); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  const projects = await import('../../services/projects/store')
  await projects.createProject(await projects.beginProjectOperation(), 'Synthetic existing local project')
  await (await import('../../services/secureFileStorage')).bootstrapFileStorage()
  // The real cold migration and schema upgrade, never a preseeded v2 layout.
  await newDocument(); await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready')
  expect(runtime!.getDocumentStorageLayout().projects.version).toBe(1)
  await newDocument(); await (await import('../../services/workspaceWriter/upgrade')).createColdWorkspaceUpgrade('start').run()
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  expect(runtime!.getDocumentStorageLayout().projects.version).toBe(2)
  return next
}
async function rows(layout = runtime!.getDocumentStorageLayout()) {
  const db = await openDB(layout.projects.name, 2)
  try {
    const keys = await db.getAllKeys('meta'), values = await db.getAll('meta')
    return keys.map((key, i) => ({ key, value: values[i] })).filter(row => Array.isArray(row.key) && String(row.key[0]).startsWith('sync-'))
  } finally { db.close() }
}
async function replaceRows(saved: Awaited<ReturnType<typeof rows>>) {
  const current = await rows(), db = await openDB(runtime!.getDocumentStorageLayout().projects.name, 2)
  try { const tx = db.transaction('meta', 'readwrite'); for (const row of current) await tx.store.delete(row.key); for (const row of saved) await tx.store.put(row.value, row.key); await tx.done }
  finally { db.close() }
}
// Test-only bootstrap of a future journal result, NOT an import/apply API.
// T/checkpoint below come from real server publications. The fixture changes
// only encrypted private metadata, then uses actual outbox/reload/HTTP paths.
async function privateStateFixture(change?: (state: SyncPrivateState) => unknown) {
  const saved = await rows(), entry = saved.find(row => row.value.format === 'arty-sync-local-state')!
  const codec = await import('../../services/workspaceSync/encryption'), format = await import('../../services/workspaceSync/localFormat')
  const session = codec.createSyncVaultSession(), guard = { signal: new AbortController().signal, assertCurrent() {}, async validateReadOnly() {} }
  const key = await session.unlock(code, { vaultId: entry.value.vaultId, epoch: entry.value.epoch }, guard)
  try {
    const binding = format.syncStateBinding(entry.value)
    const plain = JSON.parse(await (await codec.openSyncLocalState(key, binding, entry.value.ciphertext)).plaintext.text()) as SyncPrivateState
    if (change) {
      entry.value = { ...entry.value, ciphertext: await codec.sealSyncLocalState(key, binding, new Blob([JSON.stringify(change(plain))])) }
      await replaceRows(saved)
    }
    return plain
  } finally { session.lock() }
}
async function reopenBox() {
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  await (await import('../../services/storage')).bootstrapConversationStorage()
  const box = await localBox(); await box.unlock(code); return box
}
async function saveExact(conversation: Conversation) {
  const history = await import('../../services/storage'); await history.bootstrapConversationStorage(); history.saveConversation(conversation)
  const { workspaceDataKey } = await import('../../services/workspaceWriter/layout')
  await vi.waitFor(() => expect(localStorage.getItem(workspaceDataKey(runtime!.getDocumentStorageLayout(), 'a', 'conversations'))).toBeNull())
  return history
}
async function localBox() { return (await import('../../services/workspaceSync/localOutbox')).createLocalSyncOutbox() }
async function created(secret = code) {
  const box = await localBox(), actor = box.connect()
  expect(await actor.inspect()).toMatchObject({ status: 'none' })
  expect(await actor.create(secret)).toMatchObject({ status: 'acknowledged', checkpoint: { sequence: 1, previousHead: null } })
  return { box, actor }
}
async function save(title: string) {
  const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
  history.saveConversation({ id: 'chat', title, createdAt: 1, updatedAt: 2, messages: [{ id: 'question', role: 'user', content: title, timestamp: 2 }] })
  await vi.waitFor(async () => {
    const { workspaceDataKey } = await import('../../services/workspaceWriter/layout')
    expect(localStorage.getItem(workspaceDataKey(runtime!.getDocumentStorageLayout(), 'a', 'conversations-enc'))).toBeTruthy()
    expect(localStorage.getItem(workspaceDataKey(runtime!.getDocumentStorageLayout(), 'a', 'conversations'))).toBeNull()
  })
  return history
}
beforeEach(async () => {
  h = await makeWorkspaceSyncHarness(); profiles = []; runtime = undefined; exchanges = []; afterResponse = undefined; beforeRequest = undefined
  const nativeFetch = globalThis.fetch; let requests = 0
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url)
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, init)
    if (url.origin !== 'https://tryarty.com' || url.pathname !== '/api/workspace-sync/v1') throw new Error('Unexpected external HTTP')
    expect(request.credentials).toBe('omit'); expect(request.redirect).toBe('error')
    await beforeRequest?.(url.searchParams.get('action')!, request)
    const response = await h.mf.dispatchFetch(request.url, { method: request.method,
      headers: { ...Object.fromEntries(request.headers), Origin: 'https://tryarty.com', 'cf-connecting-ip': `198.51.100.${++requests % 200 + 1}` },
      ...(request.method === 'GET' ? {} : { body: await request.clone().arrayBuffer() }) })
    const result = new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) })
    const exchange = { action: url.searchParams.get('action')!, request, response: result }; exchanges.push(exchange)
    return afterResponse ? afterResponse(exchange) : result
  })
  await prepareProfile()
}, 30_000)
afterEach(async () => {
  afterResponse = undefined; beforeRequest = undefined; await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await h.dispose()
  for (const p of profiles) p.dom.window.close()
})

it('real preparation → private discovery → durable encrypted genesis → ACK; second profile proves its key before any row', async () => {
  const { box } = await created(), checkpoint = box.snapshot.remote!.checkpoint
  expect(await rows()).toHaveLength(1)
  expect(box.snapshot.base.records).toEqual([]); expect(box.snapshot.pending).toBeNull()
  expect(exchanges.map(x => x.action)).toEqual(['discover', 'challenge', 'discover', 'enroll', 'status', 'reserve', 'upload', 'commit'])
  expect(JSON.stringify(await rows())).not.toContain(code)
  await prepareProfile()
  const peer = await localBox(), actor = peer.connect(), observed = await actor.inspect()
  expect(observed).toMatchObject({ status: 'active', head: checkpoint!.head })
  await expect(actor.join(wrong)).rejects.toThrow('integrity'); expect(await rows()).toEqual([])
  expect(await actor.join(code)).toMatchObject({ status: 'key-confirmed', checkpoint })
  expect(peer.snapshot.remote!.checkpoint).toEqual(checkpoint); expect(await rows()).toHaveLength(1)
  expect((await h.db.prepare('SELECT COUNT(*) AS n FROM workspace_sync_vaults_v1').first())!.n).toBe(1)
}, 30_000)

it.each(['enroll', 'reserve', 'upload', 'commit'])('lost %s response reloads and retries exact genesis bytes, including admitted retries OFF', async lost => {
  const box = await localBox(), actor = box.connect(); await actor.inspect()
  afterResponse = async exchange => { if (exchange.action === lost) { afterResponse = undefined; throw new TypeError('synthetic lost HTTP response') }; return exchange.response }
  await expect(actor.create(code)).rejects.toThrow('unavailable')
  const saved = await rows(), packet = (await box.resume())!, bytes = await packet.ciphertext.arrayBuffer(), reference = packet.reference
  expect(box.snapshot.remote!.checkpoint).toBeNull(); expect(saved).toHaveLength(2)
  if (lost !== 'enroll') await h.configure('false')
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  const fresh = await localBox(); await fresh.unlock(code)
  expect(await (await fresh.resume())!.ciphertext.arrayBuffer()).toEqual(bytes)
  const before = exchanges.length
  expect(await fresh.connect().resume()).toMatchObject({ status: 'acknowledged', checkpoint: { reference, sequence: 1 } })
  expect(exchanges.slice(before).filter(x => x.action === 'reserve')).toHaveLength(lost === 'enroll' ? 1 : 0)
  expect(await rows()).toHaveLength(1); expect(fresh.snapshot.pending).toBeNull()
}, 30_000)

it('quota before local genesis prevents enroll; failed ACK preserves the paired ciphertext for exact retry', async () => {
  const box = await localBox(), actor = box.connect(); await actor.inspect()
  const original = IDBObjectStore.prototype.put, name = runtime!.getDocumentStorageLayout().projects.name
  let fail = true
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (fail && this.transaction.db.name === name && value?.format === 'arty-sync-local-state') throw new DOMException('quota', 'QuotaExceededError')
    return original.call(this, value, key)
  })
  await expect(actor.create(code)).rejects.toMatchObject({ name: 'QuotaExceededError' })
  expect(await rows()).toEqual([]); expect(exchanges.some(x => x.action === 'enroll')).toBe(false)
  fail = false
  afterResponse = async exchange => { if (exchange.action === 'commit') fail = true; return exchange.response }
  await expect(actor.create(code)).rejects.toMatchObject({ name: 'QuotaExceededError' })
  const saved = await rows(), reference = (await box.resume())!.reference
  expect(saved).toHaveLength(2); expect(box.snapshot.remote!.checkpoint).toBeNull()
  fail = false; afterResponse = undefined; put.mockRestore()
  expect(await actor.resume()).toMatchObject({ status: 'acknowledged', checkpoint: { reference } })
  expect(await rows()).toHaveLength(1)
}, 30_000)

it('ACK uses historical A after live chat becomes B; an explicit rescan then publishes B causally after A', async () => {
  const { box, actor } = await created(); await save('Historical A')
  afterResponse = async exchange => { if (exchange.action === 'commit') { afterResponse = undefined; throw new TypeError('lost A commit') }; return exchange.response }
  await expect(actor.synchronize(selection)).rejects.toThrow('unavailable')
  const a = box.snapshot.localHead, aReference = box.snapshot.pending, historical = await rows()
  const history = await save('Current B')
  expect(await rows()).toEqual(historical)
  expect(await actor.resume()).toMatchObject({ status: 'acknowledged', checkpoint: { reference: aReference, sequence: 2 } })
  expect(box.snapshot.base).toEqual(a); expect(history.getConversation('chat')!.title).toBe('Current B')
  expect(await actor.synchronize(selection)).toMatchObject({ status: 'scanned', capture: { status: 'adopted' }, publication: { status: 'acknowledged', checkpoint: { sequence: 3, previousHead: aReference!.operationId } } })
  expect(box.snapshot.base).not.toEqual(a); expect(history.getConversation('chat')!.title).toBe('Current B')
  expect(await actor.synchronize(selection)).toMatchObject({ status: 'scanned', capture: { status: 'unchanged' }, publication: { status: 'idle' } })
}, 30_000)

it.each(['lock', 'relink'])('a delayed head cannot capture after %s, even if the same key/account is restored', async mode => {
  const { box, actor } = await created(); await save('Unsent local data')
  const saved = await rows(), reached = deferred(), release = deferred()
  afterResponse = async exchange => { if (exchange.action === 'head') { reached.resolve(); await release.promise }; return exchange.response }
  const pending = actor.synchronize(selection); const rejected = expect(pending).rejects.toThrow()
  await reached.promise
  if (mode === 'lock') { box.lock(); await box.unlock(code) } else await relink()
  release.resolve(); await rejected
  expect(await rows()).toEqual(saved)
  expect(exchanges.filter(x => x.action === 'reserve')).toHaveLength(1) // genesis only
}, 30_000)

it.each(['valid-current', 'durable-rollback'])('late duplicate A preserves B or refuses %s without repairing storage', async mode => {
  const { box, actor } = await created(); await save('A')
  await box.capture(selection); const beforeA = await rows()
  // Publish on the server but deliberately lose the first response so both
  // real actors subsequently fetch the same already-published A.
  afterResponse = async exchange => { if (exchange.action === 'commit') { afterResponse = undefined; throw new TypeError('lost A') }; return exchange.response }
  await expect(actor.resume()).rejects.toThrow('unavailable')
  const second = box.connect(), reached = deferred(), release = deferred(); let held = false
  afterResponse = async exchange => { if (exchange.action === 'status' && !held) { held = true; reached.resolve(); await release.promise }; return exchange.response }
  const delayed = actor.resume(), settled = delayed.then(value => ({ value }), error => ({ error }))
  await reached.promise; expect(await second.resume()).toMatchObject({ status: 'acknowledged' })
  await save('B'); await box.capture(selection); const beforeLate = await rows(), b = box.snapshot
  if (mode === 'durable-rollback') await replaceRows(beforeA)
  release.resolve(); const result = await settled
  if (mode === 'valid-current') {
    expect(result).toMatchObject({ value: { status: 'already-acknowledged' } }); expect(await rows()).toEqual(beforeLate); expect(box.snapshot).toEqual(b)
  } else { expect(result).toMatchObject({ error: expect.any(Error) }); expect(await rows()).toEqual(beforeA) }
}, 30_000)

it.each(['content-type', 'content-length'])('rejecting %s aborts its fetch even before a body reader was acquired', async invalid => {
  const box = await localBox(), actor = box.connect(); let requestSignal: AbortSignal | undefined
  afterResponse = async exchange => {
    requestSignal = exchange.request.signal
    return new Response(new ReadableStream({ start() {} }), { headers: invalid === 'content-type'
      ? { 'Content-Type': 'text/html' } : { 'Content-Type': 'application/json', 'Content-Length': '32769' } })
  }
  await expect(actor.inspect()).rejects.toThrow('protocol')
  expect(requestSignal!.aborted).toBe(true); expect(await rows()).toEqual([])
}, 30_000)

it.each(['empty', 'selected'])('a losing creation can only replace an authenticated %s genesis, using both secrets', async mode => {
  const originalProfile = profile, box = await localBox(), actor = box.connect(); await actor.inspect()
  beforeRequest = async action => { if (action === 'enroll') throw new TypeError('offline before enrollment reached server') }
  await expect(actor.create(code)).rejects.toThrow('unavailable'); beforeRequest = undefined
  if (mode === 'selected') {
    await save('Unpublished local choice')
    expect(await box.capture(selection)).toMatchObject({ status: 'pending-changes' })
  }
  const saved = await rows()
  await prepareProfile(); const winner = await created(wrong), checkpoint = winner.box.snapshot.remote!.checkpoint
  await switchProfile(originalProfile); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  const reopened = await localBox(), join = reopened.connect(); await join.inspect()
  await expect(join.join(wrong)).rejects.toThrow('locked'); expect(await rows()).toEqual(saved)
  await reopened.unlock(code)
  if (mode === 'selected') {
    await expect(join.join(wrong)).rejects.toThrow('base'); expect(await rows()).toEqual(saved)
    const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
    expect(history.getConversation('chat')!.title).toBe('Unpublished local choice')
  } else {
    await expect(join.join(code)).rejects.toThrow('integrity'); expect(await rows()).toEqual(saved)
    expect(reopened.snapshot.pending).not.toBeNull() // old key remains usable on failure
    expect(await join.join(wrong)).toEqual({ status: 'joined-locked', checkpoint })
    expect(() => reopened.snapshot).toThrow('locked'); expect(await rows()).toHaveLength(1)
    await reopened.unlock(wrong); expect(reopened.snapshot.remote!.checkpoint).toEqual(checkpoint)
    expect(await reopened.connect().resume()).toMatchObject({ status: 'idle' })
  }
}, 30_000)

it('OFF before reservation is not an ACK; generic HTTP 409 is not a definitive operation conflict', async () => {
  const { box, actor } = await created(); await save('A'); await box.capture(selection)
  const saved = await rows()
  await h.configure('false')
  await expect(actor.resume()).rejects.toThrow('not-admitted'); expect(await rows()).toEqual(saved)
  afterResponse = async exchange => exchange.action === 'status' ? Response.json({ error: 'temporary_conflict' }, { status: 409 }) : exchange.response
  await expect(actor.resume()).rejects.toMatchObject({ reason: 'unavailable', httpStatus: 409 })
  expect(await rows()).toEqual(saved)
  afterResponse = undefined; await h.configure('true')
  expect(await actor.resume()).toMatchObject({ status: 'acknowledged', checkpoint: { sequence: 2 } })
}, 30_000)

it.each(['oversize', 'truncated', 'unknown-field'])('closed/bounded HTTP parser refuses %s discovery with no local adoption', async invalid => {
  const box = await localBox(), actor = box.connect()
  afterResponse = async exchange => {
    if (invalid === 'unknown-field') return Response.json({ ...await exchange.response.json(), unrelated: true })
    const bytes = new TextEncoder().encode(invalid === 'oversize' ? ' '.repeat(32769) : '{"protocol":1')
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } }), { headers: { 'Content-Type': 'application/json' } })
  }
  await expect(actor.inspect()).rejects.toThrow(); expect(await rows()).toEqual([])
}, 30_000)

it('a real 32-entry server page exceeds the request limit but joins within the separate response bound', async () => {
  const { box, actor } = await created()
  for (let i = 0; i < 32; i++) {
    await save(`Revision ${i}`)
    expect(await actor.synchronize(selection)).toMatchObject({ status: 'scanned', publication: { status: 'acknowledged', checkpoint: { sequence: i + 2 } } })
  }
  expect(box.snapshot.remote!.checkpoint!.sequence).toBe(33)
  await prepareProfile(); const peer = await localBox(), joining = peer.connect(); await joining.inspect()
  let pageBytes = 0
  afterResponse = async exchange => { if (exchange.action === 'chain') pageBytes = (await exchange.response.clone().arrayBuffer()).byteLength; return exchange.response }
  expect(await joining.join(code)).toMatchObject({ status: 'key-confirmed', checkpoint: { sequence: 1 } })
  expect(pageBytes).toBeGreaterThan(8192); expect(pageBytes).toBeLessThanOrEqual(32768)
  expect(await joining.synchronize(selection)).toEqual({ status: 'remote-changes' })
  const before = await rows(), baseline = peer.snapshot
  const start = exchanges.length
  expect(await joining.receive()).toMatchObject({ status: 'received-not-applied', content: 'not-validated', operations: 33, payloads: 32, records: 1, localPending: false })
  expect(exchanges.slice(start).filter(x => x.action === 'chain').map(x => new URL(x.request.url).searchParams.get('after'))).toEqual(['0', '32'])
  expect(exchanges.slice(start).every(x => x.request.method === 'GET')).toBe(true)
  expect(await rows()).toEqual(before); expect(peer.snapshot).toEqual(baseline)
}, 45_000)

it('legacy private v1 stays locally resumable and never becomes remote-authorized from a caller scope', async () => {
  const box = await localBox()
  await box.unlock(code, { vaultId: crypto.randomUUID(), epoch: crypto.randomUUID() }); await save('Legacy local pending')
  await box.capture(selection); const saved = await rows(), reference = (await box.resume())!.reference
  await expect(box.connect().resume()).rejects.toThrow('scope')
  expect(exchanges).toEqual([]); expect(await rows()).toEqual(saved); expect((await box.resume())!.reference).toEqual(reference)
  const bytes = await (await box.resume())!.ciphertext.arrayBuffer(), fresh = await reopenBox()
  expect((await privateStateFixture()).version).toBe(1)
  expect(await (await fresh.resume())!.ciphertext.arrayBuffer()).toEqual(bytes)
  await expect(fresh.connect().resume()).rejects.toThrow('scope'); expect(exchanges).toEqual([]); expect(await rows()).toEqual(saved)
}, 30_000)

it('account A→B→A inside the ACK write transaction rolls back both rows and cannot restore old authority', async () => {
  const { box, actor } = await created(); await save('A'); await box.capture(selection); const saved = await rows()
  const users = await import('../../services/userSession'), put = IDBObjectStore.prototype.put
  let injected = false
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (!injected && value?.format === 'arty-sync-local-state' && value.pending === null) {
      injected = true
      users.setActiveSession({ userId: 'b', authMethod: 'google', email: 'b@example.test', displayName: 'B', createdAt: 1 })
      users.setActiveSession({ userId: 'a', authMethod: 'google', email: 'a@example.test', displayName: 'A', createdAt: 1 })
    }
    return put.call(this, value, key)
  })
  await expect(actor.resume()).rejects.toThrow(); expect(injected).toBe(true); expect(await rows()).toEqual(saved)
}, 30_000)

it('changing selection while A is pending rewraps both rows without changing A; reload and ACK keep that selection', async () => {
  const { box } = await created(); await save('A'); await box.capture(selection)
  const packet = (await box.resume())!, reference = packet.reference, bytes = await packet.ciphertext.arrayBuffer(), before = await rows()
  const empty = { conversationIds: [], projectIds: [] }
  await box.capture(empty)
  const after = await rows()
  expect(after).not.toEqual(before)
  expect(after.find(x => x.value.format === 'arty-sync-local-operation')!.value.ciphertext).toEqual(before.find(x => x.value.format === 'arty-sync-local-operation')!.value.ciphertext)
  expect(new Set(after.map(x => x.value.revision)).size).toBe(1)
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  const reopened = await localBox(); await reopened.unlock(code)
  expect(reopened.snapshot.remote!.selection).toEqual(empty)
  expect((await reopened.resume())!.reference).toEqual(reference); expect(await (await reopened.resume())!.ciphertext.arrayBuffer()).toEqual(bytes)
  expect(await reopened.connect().resume()).toMatchObject({ status: 'acknowledged', checkpoint: { reference } })
  expect(reopened.snapshot.remote!.selection).toEqual(empty)
}, 30_000)

it('streaming B defers only the rescan after ACK A, retains the choice and never republishes A', async () => {
  const { box, actor } = await created(); await save('A'); await box.capture(selection)
  const aReference = box.snapshot.pending
  await save('B')
  const finish = (await import('../../services/conversationWork')).beginConversationWork('synthetic-stream')
  try {
    expect(await actor.synchronize(selection)).toMatchObject({ status: 'rescan-deferred', previous: { status: 'acknowledged', checkpoint: { reference: aReference } } })
    expect(box.snapshot.pending).toBeNull(); expect(box.snapshot.remote!.selection).toEqual(selection)
  } finally { finish() }
  expect(await actor.synchronize(selection)).toMatchObject({ status: 'scanned', previous: { status: 'idle' }, publication: { status: 'acknowledged', checkpoint: { sequence: 3 } } })
  expect(exchanges.filter(x => x.action === 'commit' && new URL(x.request.url).searchParams.get('operationId') === aReference!.operationId)).toHaveLength(1)
}, 30_000)

it('receive keeps a published A pending after a lost ACK and leaves the actual local B untouched', async () => {
  const { box, actor } = await created(); await save('Historical A')
  afterResponse = async exchange => { if (exchange.action === 'commit') { afterResponse = undefined; throw new TypeError('lost A') }; return exchange.response }
  await expect(actor.synchronize(selection)).rejects.toThrow('unavailable')
  const history = await save('Unsent B'), before = await rows(), baseline = box.snapshot, start = exchanges.length
  const report = await actor.receive()
  expect(report).toMatchObject({ status: 'received-not-applied', content: 'not-validated', anchor: { sequence: 2 }, localPending: true, remoteConflicts: 0 })
  expect(await rows()).toEqual(before); expect(box.snapshot).toEqual(baseline); expect(history.getConversation('chat')!.title).toBe('Unsent B')
  expect(exchanges.slice(start).every(x => x.request.method === 'GET')).toBe(true)
  report.anchor.sequence = 200 // never changes the private capability
  expect(await actor.reception()).toMatchObject({ anchor: { sequence: 2 } })
  const prepared = await actor.prepareReceived()
  expect(prepared).toMatchObject({ status: 'content-reviewed-not-applied', content: 'maximal-variants-validated', localPending: true, dependencyIssues: [], anchor: { sequence: 2 } })
  prepared.anchor.sequence = 888; prepared.dependencyIssues.push({ recordId: '', revisionId: '', targetId: '', relation: 'attachment', reason: 'missing' })
  expect(await actor.prepareReceived()).toMatchObject({ anchor: { sequence: 2 }, dependencyIssues: [] })
  expect(await rows()).toEqual(before); expect(box.snapshot).toEqual(baseline); expect(history.getConversation('chat')!.title).toBe('Unsent B')
  expect(await actor.resume()).toMatchObject({ status: 'acknowledged' })
  await expect(actor.prepareReceived()).rejects.toThrow('base')
  await expect(actor.reception()).rejects.toThrow('cancelled') // the failed preparation already retired this changed pair
  expect(await actor.reception()).toBeNull()
}, 30_000)

it.each(['lock', 'relink', 'pair'])('receive never exposes a partial result after %s while an object response is delayed', async mode => {
  const { box, actor } = await created(); await save('A'); await actor.synchronize(selection)
  const before = await rows(), reached = deferred(), release = deferred(); let held = false
  afterResponse = async exchange => { if (exchange.action === 'object' && !held) { held = true; reached.resolve(); await release.promise }; return exchange.response }
  const reading = actor.receive(), rejected = expect(reading).rejects.toThrow()
  await reached.promise
  if (mode === 'lock') { box.lock(); await box.unlock(code) }
  else if (mode === 'relink') await relink()
  else await box.capture({ conversationIds: [], projectIds: [] })
  release.resolve(); await rejected
  if (mode !== 'pair') expect(await rows()).toEqual(before)
  if (mode !== 'relink') expect(await actor.reception()).toBeNull()
}, 30_000)

it('receive refuses a missing old R2 body even when later ciphertext and the head are intact', async () => {
  const { box, actor } = await created(); await save('A'); await actor.synchronize(selection)
  const firstContent = box.snapshot.remote!.checkpoint!.reference
  await save('B'); await actor.synchronize(selection)
  const before = await rows(), bucket = await h.mf.getR2Bucket('WORKSPACE_SYNC_BUCKET')
  await bucket.delete(`workspace-sync-v1/${firstContent.vaultId}/${firstContent.epoch}/${firstContent.operationId}`)
  await expect(actor.receive()).rejects.toThrow(); expect(await rows()).toEqual(before); expect(await actor.reception()).toBeNull()
}, 30_000)

it('receive reattests the exact durable pair even after its report has been returned', async () => {
  const { box, actor } = await created(), prior = await rows()
  await save('A'); await actor.synchronize(selection); await actor.receive()
  await replaceRows(prior)
  await expect(actor.reception()).rejects.toThrow('base'); expect(await actor.reception()).toBeNull()
  expect(await rows()).toEqual(prior)
  expect(box.snapshot.remote!.checkpoint!.sequence).toBe(2) // no RAM/durable repair disguised as receive
}, 30_000)

async function actualProjectDocument() {
  const projects = await import('../../services/projects/store'), importer = await import('../../services/projects/documentImport')
  const op = await projects.beginProjectOperation(), p = await projects.createProject(op, 'Remote project')
  return projects.addProjectDocument(op, p, await importer.prepareProjectDocument(op, new NodeFile(['Original\r\nDocument'], 'source.txt') as unknown as File))
}

async function firstApplyPreparation(projectsOnly = false, beforeJoin?: () => Promise<void>) {
  const { actor } = await created(), p = await actualProjectDocument()
  const files = await import('../../services/secureFileStorage')
  await files.putFile({ id: 'source-file', name: '', type: '', data: 'QQ==' })
  await saveExact({ id: 'source-chat', title: 'Incoming', createdAt: 0, updatedAt: 1,
    messages: [{ id: 'source-q', role: 'user', content: 'Received original', timestamp: 0, files: [{ id: 'source-file', name: '', type: '', size: 1 }] }] })
  await actor.synchronize({ conversationIds: projectsOnly ? [] : ['source-chat'], projectIds: [p.id] })
  await prepareProfile(); await beforeJoin?.(); await save('Local B stays here')
  const box = await localBox(), controller = box.connect(); await controller.inspect(); await controller.unlockOrJoin(code)
  const layout = runtime!.getDocumentStorageLayout(), before = await rows()
  const { workspaceDataKey } = await import('../../services/workspaceWriter/layout')
  const historyKey = workspaceDataKey(layout, 'a', 'conversations-enc'), historyBefore = localStorage.getItem(historyKey)
  await controller.receive(); await controller.prepareApply()
  return { box, controller, layout, before, historyKey, historyBefore, projectsOnly }
}
async function pendingFirstApply(projectsOnly = false, beforeJoin?: () => Promise<void>) {
  const f = await firstApplyPreparation(projectsOnly, beforeJoin)
  await f.controller.applyReceived()
  const db = await openDB('arty-workspace-control', 1)
  const header = await db.get('meta', 'workspace'), raw = await db.get('meta', `sync-apply:${header.apply.id}`); db.close()
  return { ...f, payload: JSON.parse(raw) }
}
it('first apply rechecks real actor authority after a delayed module import before any private capture', async () => {
  const f = await firstApplyPreparation(), actual = await import('../../services/workspaceSync/applyPublication')
  expect(f.box.snapshot.localHead.records).toEqual([])
  const entered = deferred(), release = deferred(), prepare = vi.fn(actual.prepareFirstSyncApply)
  const capture = vi.spyOn(await import('../../services/storage'), 'captureHistoryForRestore')
  const decrypt = vi.spyOn(await import('../../services/crypto'), 'decrypt'), root = await controlRoot()
  vi.doMock('../../services/workspaceSync/applyPublication', async () => { entered.resolve(); await release.promise; return { ...actual, prepareFirstSyncApply: prepare } })
  try {
    const preparing = f.controller.prepareApply(), rejected = expect(preparing).rejects.toThrow()
    await entered.promise; f.controller.close(); release.resolve(); await rejected
    expect(prepare).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled()
    expect(await controlRoot()).toEqual(root); expect(await rows()).toEqual(f.before)
  } finally { release.resolve(); vi.doUnmock('../../services/workspaceSync/applyPublication') }
}, 30_000)
async function coldApply() {
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('applying')
  return (await import('../../services/workspaceWriter/syncApply')).createColdWorkspaceSyncApply()
}
async function controlRoot() { const db = await openDB('arty-workspace-control', 1); try { return await db.get('meta', 'workspace') } finally { db.close() } }
async function readyProfile(next: Profile) {
  await switchProfile(next); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  await (await import('../../services/storage')).bootstrapConversationStorage()
  const box = await localBox(); await box.unlock(code); return box
}
// A real received update of M, never a private-state fixture. Both profiles
// passed migration/upgrade and the receiver already completed the v10 import.
async function existingUpdatePreparation(projectsOnly = false, plainHistory = false, beforeJoin?: () => Promise<void>) {
  const first = await pendingFirstApply(projectsOnly, beforeJoin), receiver = profile, source = profiles[0]!
  await (await coldApply()).resume()
  const importedBox = await reopenBox(), imported = importedBox.snapshot
  const chatId = imported.bindings.find(b => b.kind === 'conversation' && b.presence === 'record')?.localId
  const projectId = imported.bindings.find(b => b.kind === 'project' && b.presence === 'record')!.localId
  const sourceBox = await readyProfile(source), projectStore = await import('../../services/projects/store')
  const sourceProjectId = sourceBox.snapshot.bindings.find(b => b.kind === 'project' && b.presence === 'record')!.localId
  const op = await projectStore.beginProjectOperation(), oldProject = (await projectStore.getProject(op, sourceProjectId))!.project!
  const changedProject = await projectStore.updateProject(op, oldProject, { name: 'Updated project', instructions: '\uFEFFExact\r\nInstructions\uD800' })
  if (!projectsOnly) {
    const history = await import('../../services/storage'), old = history.getConversation('source-chat')!
    await saveExact({ ...old, title: 'Remote update', updatedAt: 17, usedModels: ['mistral'], messages: [...old.messages,
      { id: 'source-added-message', role: 'assistant', content: '\uFEFFNew\r\nanswer\uD800', timestamp: 17, model: 'historical-model' }] })
    await saveExact({ id: 'extra-remote-chat', title: 'Not materialized here', createdAt: 1, updatedAt: 1, messages: [] })
  }
  expect(await sourceBox.connect().synchronize({ conversationIds: projectsOnly ? [] : ['source-chat', 'extra-remote-chat'], projectIds: [sourceProjectId] }))
    .toMatchObject({ status: 'scanned', publication: { status: 'acknowledged' } })
  const remoteHead = sourceBox.snapshot.localHead
  const box = await readyProfile(receiver), controller = box.connect()
  const history = await save('Neighbour edited before preparation'), neighbour = structuredClone(history.getConversation('chat')!)
  if (plainHistory) {
    const { workspaceDataKey } = await import('../../services/workspaceWriter/layout')
    localStorage.setItem(workspaceDataKey(first.layout, 'a', 'conversations'), JSON.stringify(history.getConversations()))
  }
  const db = await openDB(first.layout.projects.name, 2)
  const beforeDocuments = await db.getAll('documents'), beforeProjects = await db.getAll('projects'), beforeUsage = await db.getAll('usage'); db.close()
  const beforeRows = await rows(), beforeSlots = Object.entries(localStorage)
  await controller.receive()
  const preview = await controller.prepareApply()
  expect(preview).toMatchObject({ status: 'existing-update-reviewed', canApply: true, conversations: projectsOnly ? 0 : 1, projects: 1 })
  expect(await rows()).toEqual(beforeRows); expect(Object.entries(localStorage)).toEqual(beforeSlots)
  return { first, receiver, source, box, controller, preview, chatId, projectId, imported, changedProject, remoteHead,
    beforeRows, beforeDocuments, beforeProjects, beforeUsage, neighbour }
}
it.each([false, true])('existing update uses the real journal and readers without ping-pong (projects only: %s)', async projectsOnly => {
  const f = await existingUpdatePreparation(projectsOnly)
  expect(f.preview.targets).toEqual(expect.arrayContaining([{ kind: 'project', localId: f.projectId, before: 'Remote project', after: 'Updated project' }]))
  if (!projectsOnly) expect(f.preview.targets).toContainEqual({ kind: 'conversation', localId: f.chatId, before: 'Incoming', after: 'Remote update' })
  if (!projectsOnly) expect(f.preview.retained).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'new-record' })]))
  const noMoreHTTP = exchanges.length
  await f.controller.applyReceived()
  expect(await controlRoot()).toMatchObject({ version: 11, apply: { phase: 'prepared' } })
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('applying')
  const crypt = await import('../../services/crypto'), decrypt = vi.spyOn(crypt, 'decrypt'), random = vi.spyOn(crypto, 'randomUUID')
  await (await import('../../services/workspaceWriter/syncApply')).createColdWorkspaceSyncApply().resume()
  expect(decrypt).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled(); expect(exchanges).toHaveLength(noMoreHTTP)
  decrypt.mockRestore(); random.mockRestore()
  const box = await reopenBox(), history = await import('../../services/storage'), view = box.snapshot
  expect(history.getConversation('chat')).toEqual(f.neighbour)
  expect(view.remote!.selection).toEqual({ conversationIds: [], projectIds: [] })
  expect(view.localHead.records).toHaveLength(f.imported.localHead.records.length)
  expect(view.bindings.filter(b => b.presence === 'record')).toEqual(f.imported.bindings.filter(b => b.presence === 'record'))
  if (!projectsOnly) {
    const chat = history.getConversation(f.chatId!)!
    expect(chat).toMatchObject({ title: 'Remote update', createdAt: 0, updatedAt: 17, usedModels: ['mistral'] })
    expect(chat.messages).toHaveLength(2); expect(chat.messages[1]).toMatchObject({ content: '\uFEFFNew\r\nanswer\uD800', timestamp: 17, model: 'historical-model', restoredArchive: true })
    expect(chat.messages[1]!.id).not.toBe('source-added-message')
  }
  const projectStore = await import('../../services/projects/store')
  await projectStore.withReadOnlyProjectLibrary(projectStore.captureLocalReadScope(), async reader => {
    const project = (await reader.get(f.projectId))!.project!
    expect(project).toMatchObject({ name: 'Updated project', instructions: f.changedProject.instructions, revision: 2, updatedAt: f.changedProject.updatedAt })
    expect(atob(await reader.source(project, project.documents[0]!.id))).toBe('Original\r\nDocument')
    expect(await reader.text(project, project.documents[0]!.id)).toContain('Original')
  })
  const db = await openDB(f.first.layout.projects.name, 2)
  expect(await db.getAll('documents')).toEqual(f.beforeDocuments); expect(await db.getAll('usage')).toEqual(f.beforeUsage)
  for (const row of f.beforeProjects.filter(p => p.id !== f.projectId)) expect(await db.get('projects', row.key)).toEqual(row)
  db.close()
  const chosen = { conversationIds: f.chatId ? [f.chatId] : [], projectIds: [f.projectId] }
  const capture = await (await import('../../services/workspaceSync/capture')).captureLocalSyncSnapshot(view.localHead, view.bindings, chosen)
  expect(capture.report.capturedObjects).toBeGreaterThan(0)
  expect(capture.changed).toBe(false); expect(capture.payloads.size).toBe(0)
  if (!projectsOnly) {
    const beforeHead = view.localHead.records.find(r => r.kind === 'conversation')!
    const { recordHeads } = await import('../../services/workspaceSync/schema'), parent = recordHeads(beforeHead)[0]!.id
    await saveExact({ ...history.getConversation(f.chatId!)!, title: 'Local edit after update' })
    expect(await box.connect().synchronize(chosen)).toMatchObject({ status: 'scanned', publication: { status: 'acknowledged' } })
    expect(recordHeads(box.snapshot.localHead.records.find(r => r.id === beforeHead.id)!)[0]!.parents).toEqual([parent])
    const origin = await readyProfile(f.source)
    expect((await rows()).find(r => r.value.format === 'arty-sync-local-state')!.value.version).toBe(1)
    const receivingBack = origin.connect(); await receivingBack.receive()
    expect(await receivingBack.prepareApply()).toMatchObject({ status: 'existing-update-reviewed', canApply: true, conversations: 1, projects: 0 })
    await receivingBack.applyReceived(); await (await coldApply()).resume(); await reopenBox()
    expect((await import('../../services/storage')).getConversation('source-chat')!.title).toBe('Local edit after update')
    expect((await rows()).find(r => r.value.format === 'arty-sync-local-state')!.value.version).toBe(2)
  }
}, 30_000)
it.each(['durable-pair', 'fence', 'key'])('existing update rejects %s replaced before warm entry without any private history capture or decrypt', async change => {
  const f = await existingUpdatePreparation(), seam = await import('../../services/workspaceSync/updatePublication'), prepare = seam.prepareExistingSyncUpdate
  const decrypt = vi.spyOn(await import('../../services/crypto'), 'decrypt')
  const capture = vi.spyOn(await import('../../services/storage'), 'captureHistoryForSyncCoverage')
  const root = await controlRoot(), slots = Object.entries(localStorage)
  const warm = vi.spyOn(seam, 'prepareExistingSyncUpdate').mockImplementationOnce(async args => {
    const db = await openDB(f.first.layout.projects.name, 2)
    if (change === 'durable-pair') { const state = await db.get('meta', ['sync-state', 'a']); await db.put('meta', { ...state, revision: state.revision + 1 }, ['sync-state', 'a']) }
    if (change === 'fence') await db.put('meta', crypto.randomUUID(), 'erasure-fence')
    db.close()
    if (change === 'key') f.box.lock()
    return prepare(args)
  })
  await expect(f.controller.prepareApply()).rejects.toThrow()
  expect(warm).toHaveBeenCalledOnce(); expect(decrypt).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled()
  expect(await controlRoot()).toEqual(root); expect(Object.entries(localStorage)).toEqual(slots)
  const db = await openDB('arty-workspace-control', 1); expect(await db.getAllKeys('meta')).toEqual(['workspace']); db.close()
}, 30_000)
it('existing update with only locally changed targets reviews without sealing, allocating or adopting', async () => {
  const f = await existingUpdatePreparation(), history = await import('../../services/storage'), projects = await import('../../services/projects/store')
  await saveExact({ ...history.getConversation(f.chatId!)!, title: 'My local conversation' })
  const op = await projects.beginProjectOperation(), project = (await projects.getProject(op, f.projectId))!.project!
  await projects.updateProject(op, project, { name: 'My local project' })
  const before = await rows(), slots = Object.entries(localStorage), root = await controlRoot()
  const random = vi.spyOn(crypto, 'randomUUID'), encrypt = vi.spyOn(crypto.subtle, 'encrypt')
  const preview = await f.controller.prepareApply()
  expect(preview).toMatchObject({ status: 'existing-update-reviewed', canApply: false, targets: [], conversations: 0, projects: 0, journalBytes: 0 })
  expect(preview.status === 'existing-update-reviewed' && preview.retained.filter(r => r.reason === 'local-change')).toHaveLength(2)
  expect(random).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled()
  await expect(f.controller.applyReceived()).rejects.toThrow('unavailable')
  expect(await rows()).toEqual(before); expect(Object.entries(localStorage)).toEqual(slots); expect(await controlRoot()).toEqual(root)
}, 30_000)
it('v11 payload parser accepts public BEFORE1/2 but refuses AFTER1 and changed closed bindings even with a recomputed checksum', async () => {
  const f = await existingUpdatePreparation(); await f.controller.applyReceived()
  const root = await controlRoot(), db = await openDB('arty-workspace-control', 1), p = JSON.parse(await db.get('meta', `sync-update:${root.apply.id}`)); db.close()
  const { digestText } = await import('../../services/workspaceWriter/migrationInventory')
  const { parseSyncUpdateHeader } = await import('../../services/workspaceWriter/syncUpdateProtocol')
  const { parseSyncUpdatePayload } = await import('../../services/workspaceWriter/syncUpdateJournal')
  for (const mutation of ['before1', 'before2', 'after1', 'before3', 'owner', 'revision', 'extra', 'same-cipher', 'project-extra', 'project-eu', 'project-duplicate']) {
    const next = structuredClone(p)
    if (mutation === 'before1') next.stateBefore.version = 1
    if (mutation === 'before2') next.stateBefore.version = 2
    if (mutation === 'after1') next.stateAfter.version = 1
    if (mutation === 'before3') next.stateBefore.version = 3
    if (mutation === 'owner') next.stateBefore.owner = 'b'
    if (mutation === 'revision') next.stateAfter.revision++
    if (mutation === 'extra') next.stateBefore.extra = true
    if (mutation === 'same-cipher') next.stateAfter.ciphertext = next.stateBefore.ciphertext
    if (mutation === 'project-extra') next.projects[0].after.extra = true
    if (mutation === 'project-eu') next.projects[0].after.euOnly = !next.projects[0].before.euOnly
    if (mutation === 'project-duplicate') next.projects.push(next.projects[0])
    const raw = JSON.stringify(next), h = parseSyncUpdateHeader({ ...root, apply: { ...root.apply, bytes: new TextEncoder().encode(raw).length, hash: await digestText(raw) } })!
    const parsed = parseSyncUpdatePayload(raw, h, { assertCurrent() {} })
    if (mutation === 'before1' || mutation === 'before2') expect(await parsed).toEqual(next)
    else await expect(parsed, mutation).rejects.toThrow()
  }
}, 30_000)
it.each(['target', 'neighbour', 'key', 'grant', 'fence-presence', 'erasing-undefined', 'erasing-null'])('existing update refuses warm %s changes without adopting a journal', async change => {
  const f = await existingUpdatePreparation(), history = await import('../../services/storage')
  if (change === 'target' || change === 'neighbour') await saveExact({ ...history.getConversation(change === 'target' ? f.chatId! : 'chat')!, title: 'Keep this newer edit' })
  if (change === 'key') f.box.lock()
  if (change === 'grant') (await import('../../services/googleAuth')).logout()
  if (change === 'fence-presence' || change.startsWith('erasing')) {
    const db = await openDB(f.first.layout.projects.name, 2)
    if (change === 'fence-presence') {
      if (await db.getKey('meta', 'erasure-fence') === undefined) await db.put('meta', 'initial', 'erasure-fence')
      else await db.delete('meta', 'erasure-fence')
    } else await db.put('meta', change === 'erasing-null' ? null : undefined, ['erasing', 'a'])
    db.close()
  }
  const slots = Object.entries(localStorage)
  await expect(f.controller.applyReceived()).rejects.toThrow()
  expect(await controlRoot()).toMatchObject({ state: 'ready' }); expect(await rows(f.first.layout)).toEqual(f.beforeRows)
  expect(Object.entries(localStorage)).toEqual(slots)
}, 30_000)
it.each(['key', 'grant'])('existing update warm last-root-success %s invalidation aborts the actual RW', async mode => {
  const f = await existingUpdatePreparation(), root = await controlRoot(), put = IDBObjectStore.prototype.put
  const google = await import('../../services/googleAuth'); let revoked = false, aborted = false
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    const request = put.call(this, value, key)
    if (value?.format === 'arty-workspace-control' && value.version === 11) {
      this.transaction.addEventListener('abort', () => { aborted = true }, { once: true })
      request.addEventListener('success', () => { revoked = true; if (mode === 'key') f.box.lock(); else google.logout() }, { once: true })
    }
    return request
  })
  await expect(f.controller.applyReceived()).rejects.toThrow()
  expect(revoked).toBe(true); expect(aborted).toBe(true); expect(await controlRoot()).toEqual(root)
  const control = await openDB('arty-workspace-control', 1); expect(await control.getAllKeys('meta')).toEqual(['workspace']); control.close()
  expect(await rows(f.first.layout)).toEqual(f.beforeRows)
}, 30_000)
it.each(['adopted', 'publishing', 'history', 'history-plain', 'records', 'ready'])('existing update resumes after a real committed %s boundary and lost acknowledgement', async boundary => {
  const f = await existingUpdatePreparation(false, true)
  const put = IDBObjectStore.prototype.put, set = profile.dom.window.Storage.prototype.setItem, remove = profile.dom.window.Storage.prototype.removeItem
  const { workspaceDataKey } = await import('../../services/workspaceWriter/layout'), plainKey = workspaceDataKey(f.first.layout, 'a', 'conversations')
  let cut = false
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    const matches = boundary === 'records' ? value?.format === 'arty-sync-local-state' && value.revision === f.beforeRows[0]!.value.revision + 1
      : value?.format === 'arty-workspace-control' && (boundary === 'ready' ? value.state === 'ready' : value.version === 11 && value.apply.phase === (boundary === 'adopted' ? 'prepared' : boundary))
    if (matches && !cut) { cut = true; this.transaction.addEventListener('complete', () => runtime!.documentWorkspace.retire(), { once: true }) }
    return put.call(this, value, key)
  })
  vi.spyOn(profile.dom.window.Storage.prototype, 'setItem').mockImplementation(function(key, value) {
    set.call(this, key, value)
    if (boundary === 'history' && key === f.first.historyKey && !cut) { cut = true; runtime!.documentWorkspace.retire() }
  })
  vi.spyOn(profile.dom.window.Storage.prototype, 'removeItem').mockImplementation(function(key) {
    remove.call(this, key)
    if (boundary === 'history-plain' && key === plainKey && !cut) { cut = true; runtime!.documentWorkspace.retire() }
  })
  if (boundary === 'adopted') await expect(f.controller.applyReceived()).rejects.toThrow()
  else { await f.controller.applyReceived(); await expect((await coldApply()).resume()).rejects.toThrow() }
  expect(cut).toBe(true); vi.restoreAllMocks()
  if (boundary !== 'ready') await (await coldApply()).resume()
  await reopenBox(); const history = await import('../../services/storage')
  expect(history.getConversation('chat')).toEqual(f.neighbour); expect(history.getConversation(f.chatId!)!.title).toBe('Remote update')
  expect(history.getConversation(f.chatId!)!.messages).toHaveLength(2)
  const db = await openDB(f.first.layout.projects.name, 2)
  expect((await db.get('projects', ['a', f.projectId])).revision).toBe(2)
  expect(await db.getAll('documents')).toEqual(f.beforeDocuments); expect(await db.getAll('usage')).toEqual(f.beforeUsage); db.close()
}, 30_000)
it('existing update admits only the closed history/project/state matrix, never per-row mixtures', async () => {
  const f = await existingUpdatePreparation(false, true), slots = Object.entries(localStorage)
  const { workspaceDataKey } = await import('../../services/workspaceWriter/layout'), plainKey = workspaceDataKey(f.first.layout, 'a', 'conversations')
  await f.controller.applyReceived()
  const root = await controlRoot(), control = await openDB('arty-workspace-control', 1), jobKey = `sync-update:${root.apply.id}`
  const raw = await control.get('meta', jobKey), p = JSON.parse(raw); control.close()
  for (const phase of ['prepared', 'publishing']) for (const historyMode of ['before', 'intermediate', 'after']) for (const rowsMode of ['before', 'after', 'mixed-project', 'mixed-state']) {
    const tag = `${phase}/${historyMode}/${rowsMode}`, c = await openDB('arty-workspace-control', 1), db = await openDB(f.first.layout.projects.name, 2)
    await c.put('meta', { ...root, apply: { ...root.apply, phase } }, 'workspace'); await c.put('meta', raw, jobKey); c.close()
    await db.put('projects', rowsMode === 'after' || rowsMode === 'mixed-project' ? p.projects[0].after : p.projects[0].before)
    await db.put('meta', rowsMode === 'after' || rowsMode === 'mixed-state' ? p.stateAfter : p.stateBefore, ['sync-state', 'a']); db.close()
    for (const [key, value] of slots) localStorage.setItem(key, value)
    if (historyMode !== 'before') localStorage.setItem(f.first.historyKey, p.historyCipher)
    if (historyMode === 'after') localStorage.removeItem(plainKey)
    const allowed = rowsMode === 'before' && (phase === 'publishing' || historyMode === 'before') || phase === 'publishing' && rowsMode === 'after' && historyMode === 'after'
    const cold = await coldApply()
    if (allowed) { await cold.resume(); expect(await controlRoot(), tag).toMatchObject({ state: 'ready' }) }
    else { await expect(cold.resume(), tag).rejects.toThrow(); expect(await controlRoot(), tag).toMatchObject({ version: 11, apply: { phase } }) }
  }
}, 30_000)
it.each(['history', 'project'])('existing update quota at %s allows abandonment only before its first business write', async boundary => {
  const f = await existingUpdatePreparation(), beforeSlots = Object.entries(localStorage)
  await f.controller.applyReceived()
  const put = IDBObjectStore.prototype.put, set = profile.dom.window.Storage.prototype.setItem
  const writing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    if (boundary === 'project' && this.name === 'projects' && value?.id === f.projectId) throw new DOMException('quota', 'QuotaExceededError')
    return put.call(this, value, key)
  })
  const setting = vi.spyOn(profile.dom.window.Storage.prototype, 'setItem').mockImplementation(function(key, value) {
    if (boundary === 'history' && key === f.first.historyKey) throw new DOMException('quota', 'QuotaExceededError')
    set.call(this, key, value)
  })
  await expect((await coldApply()).resume()).rejects.toThrow()
  const afterFailure = Object.entries(localStorage)
  if (boundary === 'history') {
    await (await coldApply()).abort()
    expect(Object.entries(localStorage)).toEqual(beforeSlots); expect(await rows(f.first.layout)).toEqual(f.beforeRows)
  } else {
    await expect((await coldApply()).abort()).rejects.toThrow()
    expect(Object.entries(localStorage)).toEqual(afterFailure); expect(await rows(f.first.layout)).toEqual(f.beforeRows)
  }
  writing.mockRestore(); setting.mockRestore()
  if (boundary === 'project') await (await coldApply()).resume()
  const box = await reopenBox(); expect(box.snapshot.localHead.records.length).toBe(f.imported.localHead.records.length)
}, 30_000)
it('existing update abandons an invalidated prepared job without restoring over a late ordinary writer', async () => {
  const f = await existingUpdatePreparation(); await f.controller.applyReceived()
  const db = await openDB(f.first.layout.projects.name, 2), before = await db.get('projects', ['a', f.projectId])
  const changed = { ...before, lateWriter: 'preserve actual data' }; await db.put('projects', changed); db.close()
  await expect((await coldApply()).resume()).rejects.toThrow(); expect(await controlRoot()).toMatchObject({ apply: { phase: 'prepared' } })
  await (await coldApply()).abort()
  const reopened = await openDB(f.first.layout.projects.name, 2); expect(await reopened.get('projects', before.key)).toEqual(changed); reopened.close()
  expect(await rows(f.first.layout)).toEqual(f.beforeRows)
}, 30_000)
it.each([10, 11])('v%s erasure bridge rolls back root and job when local data change on its last root success', async version => {
  const f = version === 10 ? await pendingFirstApply() : await existingUpdatePreparation()
  if (version === 11) await f.controller.applyReceived()
  const cold = await coldApply(), root = await controlRoot(), put = IDBObjectStore.prototype.put
  let changed = false
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    const request = put.call(this, value, key)
    if (value?.version === 6 && value?.state === 'erasing') request.addEventListener('success', () => {
      changed = true; localStorage.setItem('arty-project-erasure-fence', crypto.randomUUID())
    }, { once: true })
    return request
  })
  await expect(cold.eraseLocal()).rejects.toThrow(); expect(changed).toBe(true); expect(await controlRoot()).toEqual(root)
  const db = await openDB('arty-workspace-control', 1)
  expect(await db.get('meta', `${version === 10 ? 'sync-apply' : 'sync-update'}:${root.apply.id}`)).toBeTruthy(); db.close()
}, 30_000)
it('materialized coverage uses the real private M after cold import with an EMPTY selection, returning counts only and writing nothing', async () => {
  const f = await pendingFirstApply(); await (await coldApply()).resume()
  const box = await reopenBox(), actor = box.connect(); await actor.receive()
  expect(box.snapshot.remote!.selection).toEqual({ conversationIds: [], projectIds: [] })
  const before = await rows(), view = box.snapshot, traffic = exchanges.length, originalHistory = localStorage.getItem(f.historyKey)
  const encrypt = vi.spyOn(crypto.subtle, 'encrypt'), random = vi.spyOn(crypto, 'randomUUID')
  const report = await actor.inspectMaterialized()
  expect(report).toEqual({ status: 'materialized-reviewed-not-applied', local: { requested: 5, inspected: 5, equal: 5, different: 0,
    missing: 0, unreadable: 0, notInspected: 0, missingDependencies: 0, remoteClosureChecked: false, writeAuthorized: false },
    remote: { conflicts: 0, deletedVariants: 0, dependencyIssues: 0 } })
  expect(Object.keys(report)).toEqual(['status', 'local', 'remote'])
  expect(exchanges).toHaveLength(traffic); expect(encrypt).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
  expect(await rows()).toEqual(before); expect(box.snapshot).toEqual(view); expect(localStorage.getItem(f.historyKey)).toBe(originalHistory)
  encrypt.mockRestore(); random.mockRestore()
  const history = await import('../../services/storage'), chatId = view.bindings.find(b => b.kind === 'conversation' && b.presence === 'record')!.localId
  await saveExact({ ...history.getConversation(chatId)!, messages: [...history.getConversation(chatId)!.messages,
    { id: 'new-local-message', role: 'user', content: 'Not in M', timestamp: 3 }] })
  report.local.equal = 999 // A detached count cannot be replayed as authority.
  expect(await actor.inspectMaterialized()).toMatchObject({ local: { equal: 4, different: 1, missing: 0, unreadable: 0 } })
  expect(box.snapshot.remote!.selection).toEqual({ conversationIds: [], projectIds: [] })
}, 30_000)
it.each(['durable-pair', 'grant', 'key', 'last-await-cache'])('materialized coverage rejects actual actor %s invalidation during private decryption', async mode => {
  const f = await pendingFirstApply(); await (await coldApply()).resume()
  const box = await reopenBox(), actor = box.connect(); await actor.receive(); await actor.prepareReceived()
  const crypt = await import('../../services/crypto'), original = crypt.decrypt
  vi.spyOn(crypt, 'decrypt').mockImplementationOnce(async cipher => {
    const result = await original(cipher)
    if (mode === 'durable-pair') await replaceRows(f.before)
    if (mode === 'key') box.lock()
    if (mode === 'grant') (await import('../../services/googleAuth')).logout()
    if (mode === 'last-await-cache') (await import('../../services/storage')).getConversations()[0]!.title = 'Changed during decrypt'
    return result
  })
  await expect(actor.inspectMaterialized()).rejects.toThrow()
  expect(await controlRoot()).toMatchObject({ state: 'ready' })
}, 30_000)
// Real two-device import/edit/publication, not a fabricated M or conflict DTO.
// Only the delete variant uses the lower causal adapter: deletion capture/UI
// remains a separate, unfinished writer contract.
async function concurrentPending(kind: 'edit' | 'equal' | 'delete' = 'edit') {
  const source = profile, first = await created(); await save('Baseline M'); await first.actor.synchronize(selection)
  await prepareProfile()
  const joining = await localBox(), join = joining.connect(); await join.inspect(); await join.join(code)
  await save('Unselected receiver conversation')
  await join.receive(); await join.prepareApply(); await join.applyReceived(); await (await coldApply()).resume()
  const imported = await reopenBox(), receiver = profile, initial = imported.snapshot
  const binding = initial.bindings.find(b => b.kind === 'conversation' && b.presence === 'record')!
  const history = await import('../../services/storage'), chat = history.getConversation(binding.localId)!
  const selected = { conversationIds: [binding.localId], projectIds: [] }
  await saveExact({ ...chat, title: kind === 'equal' ? 'Same concurrent title' : 'Pending A' })
  await imported.capture(selected)
  await saveExact({ ...chat, title: 'Newer live B' })
  const sourceBox = await readyProfile(source)
  if (kind === 'delete') {
    const causal = await import('../../services/workspaceSync/causal'), schema = await import('../../services/workspaceSync/schema')
    const manifest = sourceBox.snapshot.localHead, record = manifest.records.find(r => r.id === binding.logicalId)!
    const next = causal.stageSyncChange(manifest, { vaultId: manifest.vaultId, epoch: manifest.epoch, recordId: record.id, kind: record.kind,
      revision: { id: crypto.randomUUID(), intent: 'delete', parents: schema.recordHeads(record).map(r => r.id), value: { state: 'deleted' } } })
    await (await sourceBox.prepareSnapshot(next, new Map(), sourceBox.snapshot.bindings)).adopt(); await sourceBox.connect().resume()
  } else {
    const sourceHistory = await import('../../services/storage')
    await saveExact({ ...sourceHistory.getConversation('chat')!, title: kind === 'equal' ? 'Same concurrent title' : 'Remote R' })
    await sourceBox.connect().synchronize(selection)
  }
  const remote = sourceBox.snapshot, box = await readyProfile(receiver), actor = box.connect()
  expect(await actor.resume()).toEqual({ status: 'conflict' })
  expect(await actor.receive()).toMatchObject({ localPending: true, anchor: { sequence: 3 } })
  const { workspaceDataKey } = await import('../../services/workspaceWriter/layout'), layout = runtime!.getDocumentStorageLayout()
  const historyKey = workspaceDataKey(layout, 'a', 'conversations-enc')
  return { box, actor, source, receiver, selected, binding, remote, layout, historyKey, historyBefore: localStorage.getItem(historyKey), before: await rows(), snapshot: box.snapshot }
}
async function openedPending(box: Awaited<ReturnType<typeof localBox>>, base = box.snapshot.base) {
  const codec = await import('../../services/workspaceSync/encryption'), packet = (await box.resume())!
  const session = codec.createSyncVaultSession(), key = await session.unlock(code, { vaultId: base.vaultId, epoch: base.epoch },
    { signal: new AbortController().signal, assertCurrent() {}, async validateReadOnly() {} })
  try {
    const opened = await codec.openSyncUpdate(key, packet.reference, packet.ciphertext, base)
    return { manifest: opened.manifest, payloads: await Promise.all(opened.payloadIds.map(async id => ({ id, text: await opened.payload(id).text() }))),
      blobs: new Map(opened.payloadIds.map(id => [id, opened.payload(id)])),
      reference: packet.reference, bytes: await packet.ciphertext.arrayBuffer() }
  } finally { session.lock() }
}

it.each(['edit', 'equal', 'delete'] as const)('terminal concurrent %s keeps A/R ancestry and B; replacement is GET-only until explicit send', async kind => {
  const f = await concurrentPending(kind), old = await openedPending(f.box), privateBefore = await privateStateFixture(), traffic = exchanges.length
  expect(await f.actor.pendingStatus()).toMatchObject({ status: 'conflict', reference: old.reference })
  expect(await rows()).toEqual(f.before)
  const result = await f.actor.reconcilePending()
  expect(result).toMatchObject({ status: 'reconciled-pending', conflicts: 1, historical: true, applied: false, localChanges: 'not-rescanned', anchor: f.remote.remote!.checkpoint })
  const replacement = await openedPending(f.box), { recordHeads } = await import('../../services/workspaceSync/schema')
  expect(replacement.reference.operationId).not.toBe(old.reference.operationId)
  const causal = await import('../../services/workspaceSync/causal')
  expect(() => causal.assertSyncManifestRetains(old.manifest, replacement.manifest)).not.toThrow()
  expect(() => causal.assertSyncManifestRetains(f.remote.base, replacement.manifest)).not.toThrow()
  const heads = recordHeads(replacement.manifest.records.find(r => r.id === f.binding.logicalId)!)
  expect(heads).toHaveLength(2)
  if (kind === 'equal') expect(new Set(heads.map(r => r.value.state === 'live' && r.value.sha256)).size).toBe(1)
  if (kind === 'delete') expect(heads.map(r => r.value.state).sort()).toEqual(['deleted', 'live'])
  expect(replacement.payloads).toEqual(old.payloads)
  const after = await privateStateFixture()
  expect(after).toMatchObject({ version: 3, base: f.remote.base, checkpoint: f.remote.remote!.checkpoint,
    pendingBase: { base: f.remote.base, checkpoint: f.remote.remote!.checkpoint } })
  expect(after.bindings).toEqual(privateBefore.bindings)
  expect(f.box.snapshot.localHead).toEqual(f.snapshot.localHead); expect(f.box.snapshot.remote!.selection).toEqual(f.selected)
  expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  expect(exchanges.slice(traffic).every(x => x.request.method === 'GET')).toBe(true)
  const saved = await rows(), requests = exchanges.length, reopened = await reopenBox()
  expect(exchanges).toHaveLength(requests); expect(await rows()).toEqual(saved)
  expect((await openedPending(reopened)).bytes).toEqual(replacement.bytes)
  expect(await reopened.connect().resume()).toMatchObject({ status: 'acknowledged', checkpoint: { sequence: 4 } })
  expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  expect(reopened.snapshot.localHead).toEqual(f.snapshot.localHead)
  if (kind === 'edit') {
    expect(await reopened.capture(f.selected)).toMatchObject({ status: 'adopted' })
    const newer = await openedPending(reopened), record = newer.manifest.records.find(r => r.id === f.binding.logicalId)!
    const liveB = recordHeads(record).find(r => !heads.some(h => h.id === r.id))!
    expect(liveB.parents).toEqual(recordHeads(old.manifest.records.find(r => r.id === f.binding.logicalId)!).map(r => r.id))
    expect(recordHeads(record)).toHaveLength(2); expect(newer.payloads[0]!.text).toContain('Newer live B')
  }
  const peer = await readyProfile(f.source), receiving = peer.connect(), peerBefore = await rows()
  expect(await receiving.receive()).toMatchObject({ remoteConflicts: 1, anchor: { sequence: 4 } })
  expect(await rows()).toEqual(peerBefore)
  expect((await import('../../services/storage')).getConversation('chat')!.title).not.toBe('Newer live B')
}, 30_000)

it.each(['unknown', 'reserved', 'uploaded', 'generic-409', 'wrong-reference', 'wrong-predecessor', 'timeout'])('pending replacement refuses %s status and keeps the exact old pair', async failure => {
  const f = await concurrentPending(), traffic = exchanges.length
  afterResponse = async exchange => {
    if (exchange.action !== 'status') return exchange.response
    if (failure === 'timeout') throw new TypeError('synthetic unavailable')
    if (failure === 'unknown') return Response.json({ error: 'operation_unknown' }, { status: 404 })
    if (failure === 'generic-409') return Response.json({ error: 'temporary_conflict' }, { status: 409 })
    const actual = await exchange.response.clone().json() as any
    if (failure === 'wrong-reference') actual.reference.operationId = crypto.randomUUID()
    else if (failure === 'wrong-predecessor') actual.expectedHead = crypto.randomUUID()
    else actual.status = failure
    return Response.json(actual)
  }
  await expect(f.actor.reconcilePending()).rejects.toThrow()
  expect(await rows()).toEqual(f.before); expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  expect(f.box.snapshot).toEqual(f.snapshot); expect(exchanges.slice(traffic).every(x => x.request.method === 'GET')).toBe(true)
}, 30_000)

it.each(['quota', 'key-last-success', 'actor-last-success', 'grant-last-success', 'lost-local-ack'])('pending replacement is recoverable at %s', async failure => {
  const f = await concurrentPending(), put = IDBObjectStore.prototype.put, remove = IDBObjectStore.prototype.delete
  const google = await import('../../services/googleAuth')
  let injected = false
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    if (!injected && failure === 'quota' && value?.format === 'arty-sync-local-state') { injected = true; throw new DOMException('full', 'QuotaExceededError') }
    return put.call(this, value, key)
  })
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function(key) {
    const request = remove.call(this, key)
    if (!injected && Array.isArray(key) && key[0] === 'sync-operation') {
      injected = true
      if (failure === 'lost-local-ack') this.transaction.addEventListener('complete', () => runtime!.documentWorkspace.retire(), { once: true })
      else request.addEventListener('success', () => {
        if (failure === 'key-last-success') f.box.lock()
        else if (failure === 'actor-last-success') f.actor.close()
        else if (failure === 'grant-last-success') google.logout()
      }, { once: true })
    }
    return request
  })
  await expect(f.actor.reconcilePending()).rejects.toThrow(); expect(injected).toBe(true); vi.restoreAllMocks()
  const durable = await rows(f.layout)
  expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  if (failure !== 'lost-local-ack') expect(durable).toEqual(f.before)
  else {
    expect(durable).toHaveLength(2); expect(durable).not.toEqual(f.before)
    const pending = durable.find(r => r.value.format === 'arty-sync-local-operation')!.value
    const fresh = await reopenBox(), packet = (await fresh.resume())!
    expect(packet.reference).toEqual(pending.reference)
    const format = await import('../../services/workspaceSync/localFormat')
    expect(new Uint8Array(await packet.ciphertext.arrayBuffer())).toEqual(format.syncBase64ToBytes(pending.ciphertext, 130, 64 * 1024 * 1024))
    expect(await fresh.connect().resume()).toMatchObject({ status: 'acknowledged' })
    expect(fresh.snapshot.localHead).toEqual(f.snapshot.localHead)
  }
}, 30_000)

it('replacement prepared under OFF is not remotely admitted and can conflict again after another advance', async () => {
  const f = await concurrentPending(); await h.configure('false')
  expect(await f.actor.reconcilePending()).toMatchObject({ status: 'reconciled-pending' })
  const first = await openedPending(f.box), saved = await rows()
  await expect(f.actor.resume()).rejects.toThrow('not-admitted'); expect(await rows()).toEqual(saved)
  await h.configure('true')
  const peer = await readyProfile(f.source), history = await import('../../services/storage')
  await saveExact({ ...history.getConversation('chat')!, title: 'Later R2' }); await peer.connect().synchronize(selection)
  const receiver = await readyProfile(f.receiver), actor = receiver.connect()
  expect(await actor.resume()).toEqual({ status: 'conflict' })
  await expect(actor.reconcilePending()).rejects.toThrow(); expect(await rows()).toEqual(saved)
  await actor.receive(); await actor.reconcilePending()
  const second = await openedPending(receiver), causal = await import('../../services/workspaceSync/causal')
  expect(second.reference.operationId).not.toBe(first.reference.operationId)
  expect(() => causal.assertSyncManifestRetains(first.manifest, second.manifest)).not.toThrow()
  expect(receiver.snapshot.localHead).toEqual(f.snapshot.localHead)
  expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  expect(await actor.resume()).toMatchObject({ status: 'acknowledged', checkpoint: { sequence: 5 } })
}, 30_000)

it('pending inspection reattests even an idle pair changed by another outbox', async () => {
  const { actor } = await created(), second = await localBox(); await second.unlock(code)
  expect(await actor.pendingStatus()).toBeNull()
  await save('A from a second handle'); await second.capture(selection)
  const before = await rows(), traffic = exchanges.length
  await expect(actor.pendingStatus()).rejects.toThrow('base')
  expect(await rows()).toEqual(before); expect(exchanges).toHaveLength(traffic)
}, 30_000)

it('pending replacement refuses a published A after its lost HTTP ACK, without clearing A or B', async () => {
  const { box, actor } = await created(); await save('M'); await actor.synchronize(selection)
  await save('A'); await box.capture(selection)
  afterResponse = async exchange => { if (exchange.action === 'commit') { afterResponse = undefined; throw new TypeError('lost published ACK') }; return exchange.response }
  await expect(actor.resume()).rejects.toThrow('unavailable'); await save('B')
  await actor.receive(); const before = await rows(), snapshot = box.snapshot, traffic = exchanges.length
  expect(await actor.pendingStatus()).toMatchObject({ status: 'published' })
  await expect(actor.reconcilePending()).rejects.toThrow('base')
  expect(await rows()).toEqual(before); expect(box.snapshot).toEqual(snapshot)
  expect((await import('../../services/storage')).getConversation('chat')!.title).toBe('B')
  expect(exchanges.slice(traffic).every(x => x.request.method === 'GET')).toBe(true)
}, 30_000)

it('pending replacement refuses a received anchor still at the conflicted predecessor', async () => {
  const f = await concurrentPending()
  afterResponse = async exchange => {
    if (exchange.action !== 'head') return exchange.response
    const actual = await exchange.response.clone().json() as object
    return Response.json({ ...actual, head: f.snapshot.remote!.checkpoint!.head, sequence: f.snapshot.remote!.checkpoint!.sequence })
  }
  await f.actor.receive(); afterResponse = undefined
  await expect(f.actor.reconcilePending()).rejects.toThrow('base')
  expect(await rows()).toEqual(f.before); expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
}, 30_000)

it('R already retaining A needs no duplicate bodies and does not fabricate an ACK of the conflicted operation', async () => {
  const f = await concurrentPending(), old = await openedPending(f.box), causal = await import('../../services/workspaceSync/causal')
  const peer = await readyProfile(f.source)
  // Protocol fixture through codec + real HTTP, not a claim that the
  // unfinished conflict-choice/application UI can materialize a multi-head M.
  const union = causal.reconcileSyncManifests(f.snapshot.base, old.manifest, peer.snapshot.base)
  const codec = await import('../../services/workspaceSync/encryption')
  const wire = (await import('../../services/workspaceSync/clientTransport')).createWorkspaceSyncTransport()
  const guard = { signal: wire.signal, assertCurrent: wire.assertCurrent, validateReadOnly: wire.validateReadOnly }
  const session = codec.createSyncVaultSession(), base = peer.snapshot.base, predecessor = peer.snapshot.remote!.checkpoint!.head
  const key = await session.unlock(code, { vaultId: base.vaultId, epoch: base.epoch }, guard)
  try {
    const published = await codec.prepareSyncUpdate(key, base, union, old.blobs,
      { assertCurrent: wire.assertCurrent, validate: wire.validateReadOnly })
    await wire.reserve(published.reference, predecessor, guard)
    await wire.upload(published.reference, predecessor, published.ciphertext, guard)
    expect(await wire.commit(published.reference, predecessor, guard)).toMatchObject({ status: 'published' })
  } finally { session.lock(); wire.close() }
  const receiver = await readyProfile(f.receiver), actor = receiver.connect(); await actor.receive()
  const traffic = exchanges.length
  expect(await actor.reconcilePending()).toMatchObject({ status: 'reconciled-pending', conflicts: 1 })
  const packet = await openedPending(receiver)
  expect(packet.payloads).toEqual([]); expect(packet.manifest).toEqual(union)
  expect(receiver.snapshot.pending).toEqual(packet.reference)
  expect(receiver.snapshot.localHead).toEqual(f.snapshot.localHead)
  expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  expect(exchanges.slice(traffic).every(x => x.request.method === 'GET')).toBe(true)
  expect(await actor.resume()).toMatchObject({ status: 'acknowledged', checkpoint: { sequence: 5 } })
}, 30_000)

it.each(['newer-B', 'lock', 'relink', 'second-status'])('pending replacement handles %s during its last HTTP validation', async event => {
  const f = await concurrentPending(), history = await import('../../services/storage')
  let statuses = 0, laterHistory = f.historyBefore
  afterResponse = async exchange => {
    if (exchange.action !== 'status' || ++statuses !== 2) return exchange.response
    if (event === 'lock') f.box.lock()
    else if (event === 'relink') await relink()
    else if (event === 'second-status') return Response.json({ error: 'operation_unknown' }, { status: 404 })
    else {
      await saveExact({ ...history.getConversation(f.binding.localId)!, title: 'B changed during preparation' })
      laterHistory = localStorage.getItem(f.historyKey)
    }
    return exchange.response
  }
  if (event === 'newer-B') {
    expect(await f.actor.reconcilePending()).toMatchObject({ status: 'reconciled-pending', localChanges: 'not-rescanned' })
    expect(f.box.snapshot.localHead).toEqual(f.snapshot.localHead)
    expect((await openedPending(f.box)).payloads.every(p => !p.text.includes('B changed during preparation'))).toBe(true)
  } else {
    await expect(f.actor.reconcilePending()).rejects.toThrow(); expect(await rows()).toEqual(f.before)
  }
  expect(statuses).toBe(2); expect(localStorage.getItem(f.historyKey)).toBe(laterHistory)
}, 30_000)

async function editExistingProjectAndReload() {
  const store = await import('../../services/projects/store'), op = await store.beginProjectOperation()
  const db = await openDB(runtime!.getDocumentStorageLayout().projects.name)
  const rows = (await db.getAll('projects')).filter(p => p.owner === 'a'); db.close()
  const projects = await Promise.all(rows.map(row => store.getProject(op, row.id)))
  const project = projects.find(p => p?.project?.name === 'Synthetic existing local project')!.project!
  expect(project.name).toBe('Synthetic existing local project')
  await store.updateProject(op, project, { name: 'Existing project edited after recovery' })
  await reopenBox()
  const fresh = await import('../../services/projects/store')
  expect(await fresh.getProject(await fresh.beginProjectOperation(), project.id)).toMatchObject({ status: 'ready', project: { name: 'Existing project edited after recovery' } })
}

it.each(['copies', 'file', 'records', 'publishing', 'history', 'ready'])('first apply resumes after committed %s boundary without duplicate rows or state', async boundary => {
  const f = await pendingFirstApply(), first = await coldApply(), add = IDBObjectStore.prototype.add, put = IDBObjectStore.prototype.put
  const set = profile.dom.window.Storage.prototype.setItem
  let cut = false
  const stopAtCommit = (store: IDBObjectStore, value: any) => {
    const matches = boundary === 'file' ? store.name === 'files' : boundary === 'records' ? value?.format === 'arty-sync-local-state' && value.version === 2
      : value?.format === 'arty-workspace-control' && (boundary === 'ready' ? value.state === 'ready' : value.apply?.phase === boundary)
    if (matches && !cut) { cut = true; store.transaction.addEventListener('complete', () => runtime!.documentWorkspace.retire(), { once: true }) }
  }
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(value, key) { stopAtCommit(this, value); return add.call(this, value, key) })
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) { stopAtCommit(this, value); return put.call(this, value, key) })
  vi.spyOn(profile.dom.window.Storage.prototype, 'setItem').mockImplementation(function(key, value) {
    set.call(this, key, value)
    if (boundary === 'history' && key === f.historyKey && !cut) { cut = true; runtime!.documentWorkspace.retire() }
  })
  await expect(first.resume()).rejects.toThrow(); expect(cut).toBe(true); vi.restoreAllMocks()
  if (boundary !== 'ready') await (await coldApply()).resume()
  const box = await reopenBox(); expect(box.snapshot.localHead.records).toHaveLength(5)
  expect((await rows()).filter(r => (r.key as string[])[0] === 'sync-state')).toHaveLength(1)
  const history = await import('../../services/storage'); expect(history.getConversation('chat')!.title).toBe('Local B stays here')
  expect(box.snapshot.bindings.filter(b => b.kind === 'conversation' && b.presence === 'record')).toHaveLength(1)
  const files = await openDB(f.layout.files.name), projects = await openDB(f.layout.projects.name)
  for (const row of f.payload.files) expect(await files.get('files', row.fileId)).toEqual(row)
  for (const row of f.payload.projects) expect(await projects.get('projects', row.key)).toEqual(row)
  expect(await projects.get('meta', ['sync-state', 'a'])).toEqual(f.payload.stateAfter)
  files.close(); projects.close()
}, 30_000)

it.each(['idb-quota', 'history-quota', 'projects-only'])('first apply can abandon exact unpublished copies after %s, keeping B and old pair', async failure => {
  const f = await pendingFirstApply(failure === 'projects-only'), first = await coldApply()
  const put = IDBObjectStore.prototype.put, set = profile.dom.window.Storage.prototype.setItem
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    if (failure === 'idb-quota' && value?.format === 'arty-sync-local-state' && value.version === 2) throw new DOMException('synthetic capacity limit', 'QuotaExceededError')
    if (failure === 'projects-only' && value?.apply?.phase === 'publishing') this.transaction.addEventListener('complete', () => runtime!.documentWorkspace.retire(), { once: true })
    return put.call(this, value, key)
  })
  vi.spyOn(profile.dom.window.Storage.prototype, 'setItem').mockImplementation(function(key, value) {
    if (failure === 'history-quota' && key === f.historyKey) throw new DOMException('synthetic capacity limit', 'QuotaExceededError')
    return set.call(this, key, value)
  })
  await expect(first.resume()).rejects.toThrow()
  // Keep quota denial active while abandoning: no large replacement or old
  // history write is used to make this pass. Only the cut hook is exhausted.
  await (await coldApply()).abort(); vi.restoreAllMocks()
  const box = await reopenBox(); expect(box.snapshot.localHead.records).toHaveLength(0); expect(await rows()).toEqual(f.before)
  expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  const files = await openDB(f.layout.files.name), projects = await openDB(f.layout.projects.name)
  for (const row of f.payload.files) expect(await files.get('files', row.fileId)).toBeUndefined()
  for (const row of f.payload.projects) expect(await projects.get('projects', row.key)).toBeUndefined()
  files.close(); projects.close()
  await editExistingProjectAndReload()
}, 30_000)

it('late B change after warm adoption refuses before first cold copy, yet untouched job can be abandoned', async () => {
  const f = await pendingFirstApply(), db = await openDB(f.layout.projects.name)
  const old = (await db.getAll('projects'))[0], changed = { ...old, lateSyntheticWriter: 'preserve me' }
  await db.put('projects', changed); db.close()
  await expect((await coldApply()).resume()).rejects.toThrow('changed')
  expect((await controlRoot()).apply.phase).toBe('prepared')
  const files = await openDB(f.layout.files.name)
  for (const row of f.payload.files) expect(await files.get('files', row.fileId)).toBeUndefined()
  files.close(); await (await coldApply()).abort()
  await reopenBox(); const after = await openDB(f.layout.projects.name)
  expect(await after.get('projects', old.key)).toEqual(changed); after.close(); expect(await rows()).toEqual(f.before)
}, 30_000)

it('projects-only first apply can roll forward without touching history, then pre-existing projects still edit and reload', async () => {
  const f = await pendingFirstApply(true)
  expect(f.payload.historyCipher).toBeNull(); await (await coldApply()).resume(); await reopenBox()
  expect(localStorage.getItem(f.historyKey)).toBe(f.historyBefore)
  await editExistingProjectAndReload()
}, 30_000)

it.each(['key', 'grant'])('warm %s revocation on the actual last root request aborts an uncommitted control transaction', async mode => {
  const f = await firstApplyPreparation(), root = await controlRoot(), put = IDBObjectStore.prototype.put
  const google = await import('../../services/googleAuth'); let revoked = false, aborted = false
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    const request = put.call(this, value, key)
    if (value?.format === 'arty-workspace-control' && value.version === 10) {
      this.transaction.addEventListener('abort', () => { aborted = true }, { once: true })
      request.addEventListener('success', () => { revoked = true; if (mode === 'key') f.box.lock(); else google.logout() }, { once: true })
    }
    return request
  })
  await expect(f.controller.applyReceived()).rejects.toThrow()
  expect(revoked).toBe(true); expect(aborted).toBe(true)
  expect(await controlRoot()).toEqual(root)
  const db = await openDB('arty-workspace-control', 1); expect(await db.getAllKeys('meta')).toEqual(['workspace']); db.close()
  expect(await rows(f.layout)).toEqual(f.before)
}, 30_000)

it('legacy streaming history refuses actionably without replacing B, then an ordinary saved rename permits preparation', async () => {
  const { actor } = await created(); await save('Source'); await actor.synchronize(selection)
  await prepareProfile()
  const history = await saveExact({ id: 'old-chat', title: 'Old B', createdAt: 0, updatedAt: 1,
    messages: [{ id: 'old-message', role: 'assistant', content: 'Old B response', timestamp: 1 }] })
  const { workspaceDataKey } = await import('../../services/workspaceWriter/layout'), crypt = await import('../../services/crypto')
  const historyKey = workspaceDataKey(runtime!.getDocumentStorageLayout(), 'a', 'conversations-enc')
  const raw = JSON.parse(await crypt.decrypt(localStorage.getItem(historyKey)!)); raw[0].messages[0].id = 'streaming'
  const cipher = await crypt.encrypt(JSON.stringify(raw)); localStorage.setItem(historyKey, cipher)
  // Actual bootstrap after a new document, not a hand-installed RAM result.
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  const freshHistory = await import('../../services/storage'); await freshHistory.bootstrapConversationStorage()
  const box = await localBox(), controller = box.connect(); await controller.inspect(); await controller.join(code); await controller.receive()
  const before = await rows()
  await expect(controller.prepareApply()).rejects.toThrow('history-not-durable')
  expect(localStorage.getItem(historyKey)).toBe(cipher); expect(await rows()).toEqual(before)
  expect((await controlRoot()).state).toBe('ready')
  const c = freshHistory.getConversation('old-chat')!; expect(c.messages[0]!.id).not.toBe('streaming')
  c.title = 'Old B renamed'; await saveExact(c)
  expect(await controller.prepareApply()).toMatchObject({ status: 'first-apply-prepared', conversations: 1 })
  box.close(); expect(history).toBeDefined()
}, 30_000)

it.each(['fence', 'receipt', 'null-fence', 'undefined-receipt'])('erasure bridge refuses a changed active %s at control RW entry without deleting the apply job', async mode => {
  const f = await pendingFirstApply(), cold = await coldApply(), before = await controlRoot()
  const native = IDBDatabase.prototype.transaction, active = await openDB(f.layout.projects.name); let changed = false
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function(stores, access, options) {
    if (!changed && this.name === 'arty-workspace-control' && access === 'readwrite') {
      changed = true
      // A deliberately queued noncooperative writer, before the bridge opens
      // its final active read. Actual IDB serialization, no mocked proof.
      const tx = active.transaction('meta', 'readwrite')
      const write = mode === 'fence' || mode === 'null-fence' ? tx.store.put(mode === 'null-fence' ? null : crypto.randomUUID(), 'erasure-fence')
        : tx.store.put(mode === 'undefined-receipt' ? undefined : { owner: 'a', operationId: crypto.randomUUID(), nonce: crypto.randomUUID(), serverConfirmed: false, pending: [], localOnly: true }, ['erasing', 'a'])
      void write.catch(() => {}); void tx.done.catch(() => {})
    }
    return native.call(this, stores, access, options)
  })
  await expect(cold.eraseLocal()).rejects.toThrow(); expect(changed).toBe(true); active.close(); vi.restoreAllMocks()
  expect(await controlRoot()).toEqual(before)
  const control = await openDB('arty-workspace-control', 1)
  expect(await control.get('meta', `sync-apply:${before.apply.id}`)).toBeTruthy(); control.close()
}, 30_000)

it.each([10, 11])('v%s local erasure removes A including its v2 barrier and preserves real encrypted B history, project, file and pending pair', async version => {
  let bProjectId = '', bPair: Awaited<ReturnType<typeof rows>>, bCipher = '', bKey = '', bPacket: ArrayBuffer
  const loginB = async () => {
    const users = await import('../../services/userSession'); users.setActiveSession({ userId: 'b', authMethod: 'apikey', displayName: 'Synthetic B', createdAt: 1 })
    await (await import('../../services/crypto')).initCrypto('synthetic-key-b')
  }
  const beforeJoin = async () => {
    await loginB()
    const store = await import('../../services/projects/store'), p = await store.createProject(await store.beginProjectOperation(), 'Account B original'); bProjectId = p.id
    await (await import('../../services/secureFileStorage')).putFile({ id: 'b-file', name: 'B.txt', type: 'text/plain', data: 'Qg==' })
    const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
    history.saveConversation({ id: 'b-chat', title: 'Account B original', createdAt: 0, updatedAt: 1, messages: [{ id: 'b-q', role: 'user', content: 'B original', timestamp: 0, files: [{ id: 'b-file', name: 'B.txt', type: 'text/plain', size: 1 }] }] })
    const { workspaceDataKey } = await import('../../services/workspaceWriter/layout')
    bKey = workspaceDataKey(runtime!.getDocumentStorageLayout(), 'b', 'conversations-enc')
    await vi.waitFor(() => expect(localStorage.getItem(workspaceDataKey(runtime!.getDocumentStorageLayout(), 'b', 'conversations'))).toBeNull())
    bCipher = localStorage.getItem(bKey)!
    const box = await localBox(); await box.unlock(code, { vaultId: crypto.randomUUID(), epoch: crypto.randomUUID() })
    await box.capture({ conversationIds: ['b-chat'], projectIds: [p.id] }); bPair = await rows(); bPacket = await (await box.resume())!.ciphertext.arrayBuffer(); box.close()
    await login()
  }
  let f: Pick<Awaited<ReturnType<typeof pendingFirstApply>>, 'layout' | 'historyKey'>
  if (version === 10) f = await pendingFirstApply(false, beforeJoin)
  else {
    const update = await existingUpdatePreparation(false, false, beforeJoin)
    await update.controller.applyReceived(); f = update.first
  }
  const first = await coldApply(), put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, key) {
    if (value?.apply?.phase === 'publishing') this.transaction.addEventListener('complete', () => runtime!.documentWorkspace.retire(), { once: true })
    return put.call(this, value, key)
  })
  await expect(first.resume()).rejects.toThrow(); vi.restoreAllMocks()
  const active = await openDB(f.layout.projects.name); expect((await active.get('meta', ['sync-state', 'a'])).version).toBe(2); active.close()
  const traffic = exchanges.length; await (await coldApply()).eraseLocal()
  expect(await controlRoot()).toMatchObject({ version: 6, state: 'erasing', erasure: { authority: { owner: 'a', localOnly: true, serverConfirmed: false } } })
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('erasure')
  await (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure().resume('local-only')
  expect(exchanges).toHaveLength(traffic)
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await loginB()
  expect(await rows()).toEqual(bPair!); expect(localStorage.getItem(bKey)).toBe(bCipher); expect(localStorage.getItem(f.historyKey)).toBeNull()
  const history = await import('../../services/storage'); await history.bootstrapConversationStorage(); expect(history.getConversation('b-chat')!.title).toBe('Account B original')
  expect(await (await import('../../services/secureFileStorage')).getFile('b-file')).toMatchObject({ data: 'Qg==' })
  const box = await localBox(); await box.unlock(code); expect(await (await box.resume())!.ciphertext.arrayBuffer()).toEqual(bPacket!)
  const store = await import('../../services/projects/store'), op = await store.beginProjectOperation(), p = (await store.getProject(op, bProjectId))!.project!
  expect(p.name).toBe('Account B original'); await store.updateProject(op, p, { name: 'B still editable' }); box.close()
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await loginB()
  const reloaded = await import('../../services/projects/store')
  expect(await reloaded.getProject(await reloaded.beginProjectOperation(), bProjectId)).toMatchObject({ status: 'ready', project: { name: 'B still editable' } })
}, 30_000)

it('erasure bridge keepalive does not extend the deadline while active evidence is blocked', async () => {
  const f = await pendingFirstApply(), cold = await coldApply(), root = await controlRoot(), reached = deferred()
  const active = await openDB(f.layout.projects.name), native = IDBDatabase.prototype.transaction
  let holding: ReturnType<typeof active.transaction> | undefined, entered = false
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function(stores, access, options) {
    if (!entered && this.name === 'arty-workspace-control' && access === 'readwrite') {
      entered = true; holding = active.transaction('meta', 'readwrite'); void holding.done.catch(() => {})
      const keep = async () => { try { while (holding) await holding.objectStore('meta').get('erasure-fence') } catch { /* intentional abort */ } }
      void keep(); reached.resolve()
    }
    return native.call(this, stores, access, options)
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const erasing = cold.eraseLocal(), refusal = expect(erasing).rejects.toThrow('cancelled')
    await reached.promise
    await vi.advanceTimersByTimeAsync(120_001); await refusal
  } finally {
    holding?.abort(); holding = undefined; vi.useRealTimers(); vi.restoreAllMocks(); active.close()
  }
  // Both aborted transactions settle before a fresh root read can finish.
  expect(await controlRoot()).toEqual(root)
  const control = await openDB('arty-workspace-control', 1); expect(await control.getAllKeys('meta')).toHaveLength(2); control.close()
}, 30_000)

it('cold apply payload rejects closed-field and state/usage corruption even under a recomputed journal digest', async () => {
  const f = await pendingFirstApply(), header = await controlRoot(), protocol = await import('../../services/workspaceWriter/syncApplyJournal')
  const { digestText } = await import('../../services/workspaceWriter/migrationInventory')
  const guard = { signal: new AbortController().signal, assertCurrent() {} }
  for (const kind of ['extra', 'owner', 'state-version', 'state-revision', 'state-owner', 'state-generation', 'usage', 'duplicate-file', 'file-owner', 'doc-kind']) {
    const payload = structuredClone(f.payload)
    if (kind === 'extra') payload.extra = true
    if (kind === 'owner') payload.owner = 'b'
    if (kind === 'state-version') payload.stateAfter.version = 1
    if (kind === 'state-revision') payload.stateAfter.revision++
    if (kind === 'state-owner') payload.stateAfter.owner = 'b'
    if (kind === 'state-generation') payload.stateAfter.generation = crypto.randomUUID()
    if (kind === 'usage') payload.usageAfter.projects++
    if (kind === 'duplicate-file') payload.files.push(payload.files[0])
    if (kind === 'file-owner') payload.files[0].ownerKey = 'arty-b'
    if (kind === 'doc-kind') payload.documents[0].kind = 'unknown'
    const raw = JSON.stringify(payload), rewritten = { ...header, apply: { ...header.apply, bytes: new TextEncoder().encode(raw).length, hash: await digestText(raw) } }
    await expect(protocol.parseSyncApplyPayload(raw, rewritten, guard), kind).rejects.toThrow()
  }
}, 30_000)

it('two storage-prepared profiles apply and update comparison/gallery/documents through real journals, then recapture unchanged', async () => {
  const sourceProfile = profile
  const { actor } = await created(), p = await actualProjectDocument(), doc = p.documents[0]!
  const files = await import('../../services/secureFileStorage'), history = await import('../../services/storage')
  const imageId = '11111111-1111-1111-1111-111111111111'
  await files.putFile({ id: 'attachment', name: 'original', type: '', data: 'QQ==' })
  await files.putFile({ id: imageId, name: 'image.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' })
  await history.bootstrapConversationStorage()
  for (const chatId of ['chat', 'peer']) history.saveConversation({ id: chatId, title: 'Compared', createdAt: 0, updatedAt: 1, projectId: p.id, hasProjectContext: true,
    comparison: { version: 1, groupId: 'group', sourceConversationId: 'unselected', sourceMessageId: 'old-q', peerId: chatId === 'chat' ? 'peer' : 'chat',
      questionId: 'q', responseId: 'absent-r', provider: 'mistral', requestedModel: 'historical', status: 'done',
      metrics: { firstTokenMs: null, totalMs: null, inputTokens: 0, outputTokens: 0, costEur: null } },
    messages: [{ id: 'q', role: 'user', content: '\uFEFFQ\r\n', timestamp: 0, files: [{ id: 'attachment', name: 'presentation', type: '', size: 999 }] },
      { id: 'r', role: 'assistant', content: `\uD800\n![A](arty-img://${imageId})`, timestamp: 1, generatedImages: [imageId],
        projectTurn: { version: 1, mode: 'search', euOnly: p.euOnly, partial: false, projectId: p.id, projectRevision: p.revision,
          sources: [{ projectId: p.id, projectRevision: p.revision, documentId: doc.id, documentRevision: doc.revision, sourceHash: doc.sourceHash,
            extractorVersion: doc.extractorVersion, name: doc.name, format: doc.format, startLine: 0, endLine: 1, partial: false }] } }] })
  await vi.waitFor(async () => {
    const { workspaceDataKey } = await import('../../services/workspaceWriter/layout')
    expect(localStorage.getItem(workspaceDataKey(runtime!.getDocumentStorageLayout(), 'a', 'conversations'))).toBeNull()
    expect(localStorage.getItem(workspaceDataKey(runtime!.getDocumentStorageLayout(), 'a', 'conversations-enc'))).toBeTruthy()
  })
  expect(await actor.synchronize({ conversationIds: ['chat', 'peer'], projectIds: [p.id] })).toMatchObject({ status: 'scanned', publication: { status: 'acknowledged' } })
  await prepareProfile()
  const peer = await localBox(), controller = peer.connect(); await controller.inspect(); await controller.join(code)
  const localHistory = await save('Unsent receiver B'), before = await rows(), baseline = peer.snapshot, traffic = exchanges.length
  await controller.receive()
  expect(await controller.prepareReceived()).toMatchObject({ status: 'content-reviewed-not-applied', liveVariants: 7, records: 7,
    orphanDocumentRecords: 0, dependencyIssues: [], anchor: { sequence: 2 } })
  expect(await rows()).toEqual(before); expect(peer.snapshot).toEqual(baseline)
  expect(localHistory.getConversation('chat')!.title).toBe('Unsent receiver B'); expect(localHistory.getConversation('peer')).toBeNull()
  expect(exchanges.slice(traffic).every(x => x.request.method === 'GET')).toBe(true)
  expect(await (await import('../../services/secureFileStorage')).getFile(imageId)).toBeNull()
  const originalB = structuredClone(localHistory.getConversation('chat')!), layout = runtime!.getDocumentStorageLayout()
  const oldProjects = await openDB(layout.projects.name, 2)
  const originals = { projects: await oldProjects.getAll('projects'), documents: await oldProjects.getAll('documents') }; oldProjects.close()
  expect(await controller.prepareApply()).toMatchObject({ status: 'first-apply-prepared', conversations: 2, files: 2, projects: 1, documents: 1, selectionUnchanged: true })
  expect(await rows()).toEqual(before); expect(peer.snapshot).toEqual(baseline)
  const noMoreHTTP = exchanges.length
  expect(await controller.applyReceived()).toEqual({ status: 'reload-required' })
  expect(runtime!.documentWorkspaceSignal.aborted).toBe(true)
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('applying')
  const decrypt = vi.spyOn((await import('../../services/crypto')), 'decrypt'), random = vi.spyOn(crypto, 'randomUUID')
  await (await import('../../services/workspaceWriter/syncApply')).createColdWorkspaceSyncApply().resume()
  expect(decrypt).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled(); decrypt.mockRestore(); random.mockRestore()
  expect(exchanges).toHaveLength(noMoreHTTP)
  let reopened = await reopenBox()
  const importedHistory = await import('../../services/storage'), state = reopened.snapshot
  expect(state.remote!.selection).toEqual(baseline.remote!.selection)
  expect(importedHistory.getConversation('chat')).toEqual(originalB)
  const imported = state.bindings.filter(b => b.kind === 'conversation' && b.presence === 'record').map(b => importedHistory.getConversation(b.localId)!)
  expect(imported).toHaveLength(2)
  for (const c of imported) {
    expect(c.title).toBe('Compared'); expect(c.messages.every(m => m.restoredArchive === true)).toBe(true)
    expect(c.messages[1]!.content).toContain(`arty-img://${imageId}`)
    expect(c.comparison!.metrics!.costEur).toBeNull()
    expect(c.messages[1]!.generatedImages![0]).not.toBe(imageId)
    expect(await (await import('../../services/secureFileStorage')).getFile(c.messages[1]!.generatedImages![0]!)).toMatchObject({ type: 'image/png' })
  }
  const projectId = state.bindings.find(b => b.kind === 'project' && b.presence === 'record')!.localId
  const projectStore = await import('../../services/projects/store')
  await projectStore.withReadOnlyProjectLibrary(projectStore.captureLocalReadScope(), async reader => {
    const localProject = (await reader.get(projectId))!.project!
    expect(localProject.revision).toBe(1); expect(localProject.documents).toHaveLength(1)
    expect(atob(await reader.source(localProject, localProject.documents[0]!.id))).toBe('Original\r\nDocument')
    expect(await reader.text(localProject, localProject.documents[0]!.id)).toContain('Original')
  })
  const finalProjects = await openDB(layout.projects.name, 2)
  for (const row of originals.projects) expect(await finalProjects.get('projects', row.key)).toEqual(row)
  for (const row of originals.documents) expect(await finalProjects.get('documents', row.key)).toEqual(row)
  expect((await finalProjects.get('meta', ['sync-state', 'a'])).version).toBe(2); finalProjects.close()
  const captureSelection = { conversationIds: imported.map(c => c.id), projectIds: [projectId] }
  const capture = await (await import('../../services/workspaceSync/capture')).captureLocalSyncSnapshot(state.localHead, state.bindings, captureSelection)
  expect(capture.changed).toBe(false); expect(capture.payloads.size).toBe(0)
  const diagnostic = reopened.connect(); await diagnostic.receive()
  expect(await diagnostic.inspectMaterialized()).toMatchObject({ local: { requested: 7, equal: 7, unreadable: 0, missing: 0 }, remote: { dependencyIssues: 0 } })
  diagnostic.close()
  // The comparison's absent response was reserved during the real first
  // import. A later ordinary source message must promote that SAME identity,
  // while gallery aliases, attachments, document provenance and peer survive.
  const receiverProfile = profile, sourceBox = await readyProfile(sourceProfile), sourceHistory = await import('../../services/storage')
  const sourceChat = sourceHistory.getConversation('chat')!
  const logicalChat = sourceBox.snapshot.bindings.find(b => b.kind === 'conversation' && b.localId === 'chat')!.logicalId
  const targetId = state.bindings.find(b => b.logicalId === logicalChat)!.localId
  const priorChat = imported.find(c => c.id === targetId)!, reservedId = priorChat.comparison!.responseId
  expect(state.bindings.find(b => b.localId === reservedId)!.presence).toBe('reference')
  await saveExact({ ...sourceChat, title: 'Comparison updated', updatedAt: 19, messages: [...sourceChat.messages,
    { id: 'absent-r', role: 'assistant', content: '\uFEFFFinal comparison answer\r\n\uD800', timestamp: 19, model: 'historical' }] })
  expect(await sourceBox.connect().synchronize({ conversationIds: ['chat', 'peer'], projectIds: [p.id] })).toMatchObject({ publication: { status: 'acknowledged' } })
  const receiverBox = await readyProfile(receiverProfile), receiver = receiverBox.connect()
  const filesBeforeDB = await openDB(layout.files.name), projectsBeforeDB = await openDB(layout.projects.name, 2)
  const unchanged = { files: await filesBeforeDB.getAll('files'), projects: await projectsBeforeDB.getAll('projects'),
    documents: await projectsBeforeDB.getAll('documents'), usage: await projectsBeforeDB.getAll('usage') }
  filesBeforeDB.close(); projectsBeforeDB.close()
  await receiver.receive()
  const allocate = vi.spyOn(crypto, 'randomUUID'), update = await receiver.prepareApply()
  expect(update).toMatchObject({ status: 'existing-update-reviewed', conversations: 1, projects: 0, canApply: true })
  expect(allocate).toHaveBeenCalledOnce(); allocate.mockRestore() // journal ID only, no new message identity
  if (update.status !== 'existing-update-reviewed') throw new Error('test')
  update.targets[0]!.localId = 'chat'; update.targets[0]!.after = 'Forged preview only'
  await receiver.applyReceived(); await (await coldApply()).resume(); reopened = await reopenBox()
  const updatedHistory = await import('../../services/storage'), updated = updatedHistory.getConversation(targetId)!
  expect(updated.title).toBe('Comparison updated'); expect(updated.messages[2]).toMatchObject({ id: reservedId, content: '\uFEFFFinal comparison answer\r\n\uD800', restoredArchive: true })
  expect(updated.comparison).toEqual(priorChat.comparison); expect(updated.messages.slice(0, 2)).toEqual(priorChat.messages)
  expect(updatedHistory.getConversation('chat')).toEqual(originalB)
  expect(reopened.snapshot.bindings.find(b => b.localId === reservedId)!.presence).toBe('embedded')
  const filesAfterDB = await openDB(layout.files.name), projectsAfterDB = await openDB(layout.projects.name, 2)
  expect(await filesAfterDB.getAll('files')).toEqual(unchanged.files); expect(await projectsAfterDB.getAll('projects')).toEqual(unchanged.projects)
  expect(await projectsAfterDB.getAll('documents')).toEqual(unchanged.documents); expect(await projectsAfterDB.getAll('usage')).toEqual(unchanged.usage)
  filesAfterDB.close(); projectsAfterDB.close()
  const updatedCapture = await (await import('../../services/workspaceSync/capture')).captureLocalSyncSnapshot(reopened.snapshot.localHead, reopened.snapshot.bindings, captureSelection)
  expect(updatedCapture.report.capturedObjects).toBeGreaterThan(0); expect(updatedCapture.changed).toBe(false); expect(updatedCapture.payloads.size).toBe(0)
  const edited = updatedHistory.getConversation(imported[0]!.id)!; edited.title = 'Edited after receive'; await saveExact(edited)
  expect(await reopened.capture(captureSelection)).toMatchObject({ status: 'adopted', report: { changedObjects: 1 } })
  expect((await rows()).find(r => (r.key as string[])[0] === 'sync-state')!.value.version).toBe(2)
  expect(await reopened.connect().resume()).toMatchObject({ status: 'acknowledged' })
  expect((await rows()).find(r => (r.key as string[])[0] === 'sync-state')!.value.version).toBe(2)
  reopened.close()
  const users = await import('../../services/userSession'); users.removeKnownSession('a')
  const barrier = await rows(), fence = localStorage.getItem('arty-project-erasure-fence')
  await expect(projectStore.purgeProjectsForAccount('a', () => {})).rejects.toThrow('unavailable')
  expect(localStorage.getItem('arty-project-erasure-fence')).toBe(fence); expect(await rows()).toEqual(barrier)
}, 30_000)

it('valid encrypted but incompatible peer content leaves its chain, local pending A and user B intact', async () => {
  const { box, actor } = await created(), snapshot = box.snapshot, recordId = crypto.randomUUID(), payloadId = crypto.randomUUID()
  const { encodeSyncContent } = await import('../../services/workspaceSync/captureContent'), { stageSyncChange } = await import('../../services/workspaceSync/causal')
  // Deliberate hostile-peer fixture using the low-level outbox, not a claim
  // that the ordinary local capture produces unknown fields or trusts a DTO.
  const body = encodeSyncContent('conversation', { conversation: { id: recordId, futureAuthority: true }, galleryAliases: [] })
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', await body.arrayBuffer())).toString('hex')
  const next = stageSyncChange(snapshot.base, { vaultId: snapshot.base.vaultId, epoch: snapshot.base.epoch, recordId, kind: 'conversation',
    revision: { id: crypto.randomUUID(), intent: 'create', parents: [], value: { state: 'live', payloadId, sha256: digest, bytes: body.size } } })
  await (await box.prepareSnapshot(next, new Map([[payloadId, body]]), [{ kind: 'conversation', localId: 'hostile-fixture', parentLocalId: null, logicalId: recordId, presence: 'record' }])).adopt()
  afterResponse = async exchange => { if (exchange.action === 'commit') { afterResponse = undefined; throw new TypeError('lost ACK') }; return exchange.response }
  await expect(actor.resume()).rejects.toThrow('unavailable')
  const history = await save('B'), before = await rows(), baseline = box.snapshot
  await actor.receive(); await expect(actor.prepareReceived()).rejects.toThrow('format')
  expect(await actor.reception()).toMatchObject({ content: 'not-validated', anchor: { sequence: 2 }, localPending: true })
  await expect(actor.prepareReceived()).rejects.toThrow('format')
  expect(await rows()).toEqual(before); expect(box.snapshot).toEqual(baseline); expect(history.getConversation('chat')!.title).toBe('B')
}, 30_000)

it.each(['lock', 'relink', 'pair'])('private content preparation refuses %s during the real original-source hash', async mode => {
  const { box, actor } = await created(), p = await actualProjectDocument()
  await actor.synchronize({ conversationIds: [], projectIds: [p.id] }); await actor.receive()
  const before = await rows(), original = crypto.subtle.digest.bind(crypto.subtle), reached = deferred(), release = deferred()
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    const result = await original(...args); reached.resolve(); await release.promise; return result
  })
  const preparing = actor.prepareReceived(), rejected = expect(preparing).rejects.toThrow()
  await reached.promise
  try {
    if (mode === 'lock') { box.lock(); await box.unlock(code) }
    if (mode === 'relink') await relink()
    if (mode === 'pair') await box.capture({ conversationIds: [], projectIds: [] })
  } finally { release.resolve() }
  await rejected
  if (mode !== 'pair') expect(await rows()).toEqual(before)
  await expect(actor.prepareReceived()).rejects.toThrow()
}, 30_000)

it('v3 T-only conversation/file survive title-only publication without being materialized or reuploaded; ACK/reload retain M', async () => {
  const { box, actor } = await created(), history = await save('M')
  await actor.synchronize(selection); const materialized = box.snapshot
  const local = structuredClone(history.getConversation('chat')!)
  const files = await import('../../services/secureFileStorage')
  await files.putFile({ id: 'remote-file', name: 'original.bin', type: '', data: 'QQ==' })
  await saveExact({ id: 'remote-chat', title: 'Remote only', createdAt: 1, updatedAt: 2,
    messages: [{ id: 'remote-question', role: 'user', content: 'R', timestamp: 2, files: [{ id: 'remote-file', name: 'visible.bin', type: '', size: 999 }] }] })
  await actor.synchronize({ conversationIds: ['chat', 'remote-chat'], projectIds: [] })
  const transport = box.snapshot.base, remoteRecords = transport.records.filter(r => r.id !== materialized.localHead.records[0]!.id)
  expect(remoteRecords).toHaveLength(2)
  // Explicit fixture: remove the synthetic remote-only physical data and keep
  // its real published T. There is no application writer under test here.
  history.deleteConversation('remote-chat'); await saveExact(local); await files.deleteFile('remote-file')
  box.close(); actor.close()
  await privateStateFixture(state => ({ ...state, materialized: materialized.localHead, bindings: materialized.bindings, selection }))
  const fresh = await reopenBox(), controller = fresh.connect(), traffic = exchanges.length
  expect(await controller.synchronize(selection)).toMatchObject({ status: 'scanned', capture: { status: 'unchanged' } })
  expect(exchanges.slice(traffic).some(x => x.action === 'reserve')).toBe(false)
  await saveExact({ ...local, title: 'Title only' })
  expect(await fresh.capture(selection)).toMatchObject({ status: 'adopted', report: { changedObjects: 1 } })
  const packet = (await fresh.resume())!, codec = await import('../../services/workspaceSync/encryption')
  const session = codec.createSyncVaultSession(), key = await session.unlock(code, { vaultId: transport.vaultId, epoch: transport.epoch }, { signal: new AbortController().signal, assertCurrent() {}, async validateReadOnly() {} })
  const opened = await codec.openSyncUpdate(key, packet.reference, packet.ciphertext, transport)
  expect(opened.payloadIds).toHaveLength(1)
  for (const record of remoteRecords) expect(opened.manifest.records.find(r => r.id === record.id)).toEqual(record)
  session.lock()
  const captured = fresh.snapshot.localHead, mapping = fresh.snapshot.bindings
  expect(await controller.resume()).toMatchObject({ status: 'acknowledged', checkpoint: { sequence: 4 } })
  expect(fresh.snapshot.localHead).toEqual(captured); expect(captured.records).toHaveLength(1)
  const restarted = await reopenBox()
  expect(restarted.snapshot.localHead).toEqual(captured); expect(restarted.snapshot.bindings).toEqual(mapping)
  expect(restarted.snapshot.base.records).toHaveLength(3)
  expect(await restarted.connect().synchronize(selection)).toMatchObject({ capture: { status: 'unchanged' } })
  const currentHistory = await import('../../services/storage'); await currentHistory.bootstrapConversationStorage()
  expect(currentHistory.getConversation('chat')).toEqual({ ...local, title: 'Title only' })
  expect(currentHistory.getConversation('remote-chat')).toBeNull()
  expect(await (await import('../../services/secureFileStorage')).getFile('remote-file')).toBeNull()
}, 30_000)

it.each(['edit', 'delete'])('v3 local C extends physical M, staying concurrent with a remote %s in T through ACK/reload', async intent => {
  const { box, actor } = await created(), history = await save('M'); await actor.synchronize(selection)
  const baseline = box.snapshot, local = structuredClone(history.getConversation('chat')!), record = baseline.localHead.records[0]!, parent = record.revisions[0]!.id
  if (intent === 'edit') { await save('Remote R'); await actor.synchronize(selection) }
  else {
    const { stageSyncChange } = await import('../../services/workspaceSync/causal')
    const deleted = stageSyncChange(baseline.base, { vaultId: baseline.base.vaultId, epoch: baseline.base.epoch, recordId: record.id, kind: record.kind,
      revision: { id: crypto.randomUUID(), intent: 'delete', parents: [parent], value: { state: 'deleted' } } })
    await (await box.prepareSnapshot(deleted, new Map(), baseline.bindings)).adopt(); await actor.resume()
  }
  const transport = box.snapshot.base, remote = transport.records[0]!.revisions.find(r => r.id !== parent)!
  await saveExact(local); box.close(); actor.close()
  await privateStateFixture(state => ({ ...state, materialized: baseline.localHead, bindings: baseline.bindings }))
  const fresh = await reopenBox(); await saveExact({ ...local, title: 'Local C' })
  expect(await fresh.connect().synchronize(selection)).toMatchObject({ capture: { status: 'adopted' }, publication: { status: 'acknowledged' } })
  const { recordHeads } = await import('../../services/workspaceSync/schema'), merged = fresh.snapshot.base.records[0]!
  const heads = recordHeads(merged), child = heads.find(r => r.id !== remote.id)!
  expect(heads).toHaveLength(2); expect(heads).toContainEqual(remote)
  expect(child.intent).toBe('edit'); expect(child.parents).toEqual([parent])
  expect(fresh.snapshot.localHead.records[0]!.revisions.map(r => r.id)).not.toContain(remote.id)
  const captured = fresh.snapshot.localHead, reopened = await reopenBox()
  expect(reopened.snapshot.localHead).toEqual(captured)
  expect(await reopened.connect().synchronize(selection)).toMatchObject({ capture: { status: 'unchanged' } })
}, 30_000)

it.each([2, 3])('old A keeps its frozen origin when T already attests publication %i; exact ACK never rolls T or M back', async latest => {
  const { box, actor } = await created(); await save('A'); await box.capture(selection)
  const pendingRows = await rows(), pending = box.snapshot, aBytes = await (await box.resume())!.ciphertext.arrayBuffer()
  expect(await actor.resume()).toMatchObject({ status: 'acknowledged', checkpoint: { sequence: 2 } })
  if (latest === 3) { await save('Remote descendant R'); await actor.synchronize(selection) }
  const transport = box.snapshot; await save('Unsent local B')
  box.close(); actor.close(); await replaceRows(pendingRows)
  await privateStateFixture(state => ({ ...state, base: transport.base, checkpoint: transport.remote!.checkpoint }))
  const fresh = await reopenBox(), traffic = exchanges.length
  expect(await (await fresh.resume())!.ciphertext.arrayBuffer()).toEqual(aBytes)
  let statusReply: unknown
  afterResponse = async exchange => { if (exchange.action === 'status') statusReply = await exchange.response.clone().json(); return exchange.response }
  expect(await fresh.connect().resume()).toMatchObject({ status: 'acknowledged', checkpoint: { reference: pending.pending, sequence: 2 } })
  afterResponse = undefined
  expect(fresh.snapshot.base).toEqual(transport.base); expect(fresh.snapshot.remote!.checkpoint).toEqual(transport.remote!.checkpoint)
  expect(fresh.snapshot.localHead).toEqual(pending.localHead); expect(fresh.snapshot.pending).toBeNull()
  expect(statusReply).toMatchObject({ previousHead: pending.remote!.checkpoint!.head, sequence: 2 })
  expect(exchanges.slice(traffic).some(x => x.action === 'reserve')).toBe(false)
  const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
  expect(history.getConversation('chat')!.title).toBe('Unsent local B')
  expect(await fresh.connect().synchronize(selection)).toMatchObject({ capture: { status: 'adopted' } })
  expect(await fresh.connect().synchronize(selection)).toMatchObject({ capture: { status: 'unchanged' } })
}, 30_000)

it('legacy private v2 pending survives real reopen/retry/ACK without implicit upgrade', async () => {
  const { box, actor } = await created(); await save('V2 pending A'); await box.capture(selection)
  const reference = box.snapshot.pending, bytes = await (await box.resume())!.ciphertext.arrayBuffer()
  box.close(); actor.close()
  await privateStateFixture(state => {
    if (state.version !== 3) throw new Error('fixture expected v3')
    const { materialized: _m, pendingBase: _p, ...v2 } = state; return { ...v2, version: 2 }
  })
  const fresh = await reopenBox()
  expect((await privateStateFixture()).version).toBe(2)
  expect(await (await fresh.resume())!.ciphertext.arrayBuffer()).toEqual(bytes)
  expect(await fresh.connect().resume()).toMatchObject({ status: 'acknowledged', checkpoint: { reference } })
  const reopened = await reopenBox()
  expect((await privateStateFixture()).version).toBe(2)
  expect(await reopened.connect().synchronize(selection)).toMatchObject({ capture: { status: 'unchanged' } })
}, 30_000)

it.each(['extra-descendant', 'missing-A'])('ACK rejects an authenticated v3 checkpoint with %s instead of repairing T', async inconsistency => {
  const { box, actor } = await created(); await save('A'); await box.capture(selection)
  const pendingRows = await rows(), origin = box.snapshot.base
  await actor.resume(); const a = box.snapshot
  await save('R'); await actor.synchronize(selection); const r = box.snapshot
  await save('Unsent B'); box.close(); actor.close(); await replaceRows(pendingRows)
  await privateStateFixture(state => ({ ...state, base: inconsistency === 'extra-descendant' ? r.base : origin, checkpoint: a.remote!.checkpoint }))
  const fresh = await reopenBox(), before = await rows()
  await expect(fresh.connect().resume()).rejects.toThrow()
  expect(await rows()).toEqual(before); expect(fresh.snapshot.pending).not.toBeNull()
  const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
  expect(history.getConversation('chat')!.title).toBe('Unsent B')
}, 30_000)

it.each(['missing-origin', 'orphan-origin', 'invented-M', 'equivocal-M', 'wrong-packet-base'])('AEAD-valid impossible v3 %s refuses unlock without repair or HTTP', async failure => {
  const { box, actor } = await created(); await save('A'); await actor.synchronize(selection)
  await save('B'); await box.capture(selection)
  if (failure === 'orphan-origin') await actor.resume()
  box.close(); actor.close()
  await privateStateFixture(state => {
    if (state.version !== 3) throw new Error('fixture expected v3')
    if (failure === 'missing-origin') state.pendingBase = null
    if (failure === 'orphan-origin') state.pendingBase = { base: state.base, checkpoint: state.checkpoint }
    if (failure === 'invented-M') state.materialized.records[0]!.revisions.at(-1)!.id = crypto.randomUUID()
    if (failure === 'equivocal-M') {
      const value = state.materialized.records[0]!.revisions[0]!.value
      if (value.state === 'live') value.sha256 = 'e'.repeat(64)
    }
    if (failure === 'wrong-packet-base') {
      // Structurally valid historical genesis, but A was actually sealed
      // against the already-published nonempty base at sequence 2.
      state.pendingBase = { base: { ...state.base, records: [] }, checkpoint: null }
    }
    return state
  })
  const saved = await rows(), historySlots = { ...localStorage }, traffic = exchanges.length
  await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready'); await login()
  const fresh = await localBox(); await expect(fresh.unlock(code)).rejects.toThrow()
  expect(await rows()).toEqual(saved); expect(exchanges).toHaveLength(traffic)
  for (const [key, value] of Object.entries(historySlots)) if (key.includes('conversations')) expect(localStorage.getItem(key)).toBe(value)
  const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
  expect(history.getConversation('chat')!.title).toBe('B')
}, 30_000)
