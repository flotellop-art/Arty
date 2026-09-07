/** @vitest-environment node */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeWorkspaceSyncHarness } from './workspaceSyncHarness'
import { parseSyncEnrollment } from '../../services/workspaceSync/transportFormat'
import { deferred } from '../helpers/workspaceLocks'
import { createDatabaseShape, FILE_SHAPE } from '../../services/workspaceWriter/schema'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true }))
const oauth = vi.hoisted(() => vi.fn())
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: oauth }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => `https://tryarty.com${path}` }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }))

let h: Awaited<ReturnType<typeof makeWorkspaceSyncHarness>>, dom: JSDOM
let runtime: typeof import('../../services/workspaceWriter/runtime') | undefined, lock: ReturnType<typeof deferred>
async function endDocument() {
  lock?.resolve()
  if (runtime) await vi.waitFor(() => expect(runtime!.documentWorkspaceSignal.aborted).toBe(true))
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  vi.stubGlobal('navigator', { locks: { request(_n: unknown, _o: unknown, callback: (v: unknown) => Promise<void>) { void callback({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime'); await runtime.documentWorkspace.acquire()
}
beforeEach(async () => {
  h = await makeWorkspaceSyncHarness(); runtime = undefined
  dom = new JSDOM('', { url: 'https://tryarty.com/?code=synthetic#callback' })
  vi.stubGlobal('localStorage', dom.window.localStorage); vi.stubGlobal('sessionStorage', dom.window.sessionStorage)
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('CustomEvent', dom.window.CustomEvent)
  vi.stubGlobal('indexedDB', new IDBFactory())
  oauth.mockReset().mockResolvedValueOnce('a').mockImplementation(() => { throw new Error('OAuth revoked: no refresh allowed') })
  await newDocument()
})
afterEach(async () => {
  await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await h.dispose(); dom.window.close()
})

async function upload(token: 'a' | 'b') {
  const scope = parseSyncEnrollment(await (await h.request('challenge', { enrollmentId: crypto.randomUUID() }, token)).json())
  expect((await h.request('enroll', { enrollmentId: scope.enrollmentId, generation: scope.generation, consent: true }, token)).status).toBe(200)
  // Opaque synthetic packet: this test covers transport/cleanup, not the codec.
  const bytes = new Uint8Array(200).fill(token === 'a' ? 65 : 66)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  const reference = { format: 'arty-sync-envelope-ref', version: 1, vaultId: scope.vaultId, epoch: scope.epoch, operationId: crypto.randomUUID(), bytes: bytes.length, sha256 }
  expect((await h.request('reserve', { reference, expectedHead: null }, token)).status).toBe(200)
  const url = (action: string) => `https://tryarty.com/api/workspace-sync/v1?${new URLSearchParams({ action, vaultId: scope.vaultId, epoch: scope.epoch, operationId: reference.operationId })}`
  const headers = { Origin: 'https://tryarty.com', 'x-google-token': token, 'cf-connecting-ip': token === 'a' ? '198.51.100.10' : '198.51.100.11' }
  expect((await h.mf.dispatchFetch(url('upload'), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes })).status).toBe(200)
  expect((await h.mf.dispatchFetch(url('commit'), { method: 'POST', headers })).status).toBe(200)
  return { scope, bytes, key: `workspace-sync-v1/${scope.vaultId}/${scope.epoch}/${reference.operationId}` }
}

it.each(['legacy', 'isolated-hot', 'isolated-cold', 'isolated-cold-lost'])(
  '%s: real services → middleware/D1/R2 pending → explicit cleanup without OAuth → B reads/writes', async mode => {
    expect(await runtime!.workspaceAdmission.admit()).toBe('ready')
    let users = await import('../../services/userSession'), crypt = await import('../../services/crypto'), projects = await import('../../services/projects/store')
    users.setActiveSession({ userId: 'b', authMethod: 'apikey', displayName: 'B', createdAt: 1 }); await crypt.initCrypto('key-b')
    const bProject = await projects.createProject(await projects.beginProjectOperation(), 'B durable')
    users.setActiveSession({ userId: 'a', authMethod: 'google', email: 'a@example.test', displayName: 'A', createdAt: 1 }); await crypt.initCrypto('key-a')
    const aProject = await projects.createProject(await projects.beginProjectOperation(), 'A pending')
    const files = await openDB('arty-files', 1, { upgrade(db) { createDatabaseShape(db, FILE_SHAPE) } }); files.close()
    if (mode !== 'legacy') {
      await newDocument(); await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()
      await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready')
    }
    const layout = runtime!.getDocumentStorageLayout(), aRemote = await upload('a'), bRemote = await upload('b')
    const bucket = await h.mf.getR2Bucket('WORKSPACE_SYNC_BUCKET')
    await h.db.prepare("INSERT INTO memory(user_id,category,data) VALUES('a@example.test','profile','A'),('b@example.test','profile','B')").run()
    const nativeFetch = globalThis.fetch, methods: string[] = []
    let loseCleanup = mode === 'isolated-cold-lost'
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('https://tryarty.com/api/account/')) return nativeFetch(input, init)
      const request = new Request(url, init), cleanup = url.endsWith('/erasure-cleanup-v1')
      methods.push(`${request.method} ${cleanup ? 'cleanup' : 'receipt'}`)
      if (request.method === 'GET' || cleanup) {
        expect([...request.headers.keys()].sort()).toEqual(['x-arty-erasure-capability', 'x-arty-erasure-operation'])
        expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error')
      }
      // Supply only browser Origin; real middleware and verified-subject handler
      // run in workerd. The harness simulates only Google's external tokeninfo.
      const response = await h.mf.dispatchFetch(url, { method: request.method, headers: { ...Object.fromEntries(request.headers), Origin: 'https://tryarty.com' } })
      const body = await response.arrayBuffer()
      if (cleanup && loseCleanup) {
        loseCleanup = false; expect(response.status).toBe(200)
        expect(JSON.parse(new TextDecoder().decode(body))).toMatchObject({ status: 'confirmed' })
        expect(await bucket.get(aRemote.key)).toBeNull()
        throw new TypeError('lost response after real cleanup commit')
      }
      return new Response(body, { status: response.status, headers: Object.fromEntries(response.headers) })
    })
    await expect((await import('../../services/accountService')).deleteAccount()).rejects.toThrow('erasure_cleanup_pending')
    expect(runtime!.documentWorkspaceSignal.aborted).toBe(false)
    const db = await openDB(layout.projects.name), pending = await db.get('meta', ['erasing', 'a'])
    expect(pending).toMatchObject({ serverConfirmed: false, remote: { state: 'uncertain' } })
    expect(await db.get('projects', ['a', aProject.id])).toBeDefined(); db.close()
    expect(await bucket.get(aRemote.key)).not.toBeNull(); expect(oauth).toHaveBeenCalledOnce()
    const authCount = h.authCalls.length, callback = dom.window.location.href
    if (mode === 'legacy') {
      await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready')
      expect(await (await import('../../services/accountService')).continueAccountErasureCleanup()).toBe('complete')
    } else if (mode === 'isolated-hot') {
      expect(await (await import('../../services/accountService')).continueAccountErasureCleanup()).toBe('reload-required')
      expect(runtime!.documentWorkspaceSignal.aborted).toBe(true)
      const saved = await openDB(layout.projects.name)
      expect(await saved.get('meta', ['erasing', 'a'])).toMatchObject({ serverConfirmed: true }); saved.close()
      await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('erasure')
      const derive = vi.spyOn(crypto.subtle, 'deriveKey')
      await (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure().resume()
      expect(derive).not.toHaveBeenCalled(); derive.mockRestore()
    } else {
      await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('erasure')
      const derive = vi.spyOn(crypto.subtle, 'deriveKey'), actor = (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure()
      await expect(actor.resume()).rejects.toThrow('erasure_cleanup_pending')
      const saved = await openDB(layout.projects.name); expect(await saved.get('meta', ['erasing', 'a'])).toEqual(pending); saved.close()
      expect(await bucket.get(aRemote.key)).not.toBeNull()
      if (loseCleanup) {
        await expect(actor.resume('resume-remote-cleanup')).rejects.toThrow('lost response')
        const saved = await openDB(layout.projects.name); expect(await saved.get('meta', ['erasing', 'a'])).toEqual(pending); saved.close()
        await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('erasure')
        await (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure().resume()
      } else await actor.resume('resume-remote-cleanup')
      expect(derive).not.toHaveBeenCalled(); derive.mockRestore()
    }
    expect(oauth).toHaveBeenCalledOnce(); expect(h.authCalls).toHaveLength(authCount); expect(dom.window.location.href).toBe(callback)
    expect(methods).toEqual(['POST receipt', 'GET receipt', 'POST cleanup', ...(mode === 'isolated-cold-lost' ? ['GET receipt'] : [])])
    expect(await bucket.get(aRemote.key)).toBeNull()
    expect(new Uint8Array(await (await bucket.get(bRemote.key))!.arrayBuffer())).toEqual(bRemote.bytes)
    expect(await h.db.prepare('SELECT revoked,purged FROM workspace_sync_vaults_v1 WHERE vault_id=?').bind(bRemote.scope.vaultId).first()).toEqual({ revoked: 0, purged: 0 })
    expect((await h.db.prepare('SELECT user_id,data FROM memory').all()).results).toEqual([{ user_id: 'b@example.test', data: 'B' }])
    const after = await openDB(layout.projects.name)
    expect(await after.get('projects', ['a', aProject.id])).toBeUndefined(); expect(await after.get('meta', ['erasing', 'a'])).toBeUndefined(); after.close()
    await newDocument(); expect(await runtime!.workspaceAdmission.admit()).toBe('ready')
    users = await import('../../services/userSession'); crypt = await import('../../services/crypto'); projects = await import('../../services/projects/store')
    users.setActiveSession({ userId: 'b', authMethod: 'apikey', displayName: 'B', createdAt: 1 }); await crypt.initCrypto('key-b')
    const operation = await projects.beginProjectOperation()
    expect(await projects.getProject(operation, bProject.id)).toMatchObject({ status: 'ready', project: { name: 'B durable' } })
    const added = await projects.createProject(operation, 'B after cleanup')
    expect(await projects.getProject(operation, added.id)).toMatchObject({ status: 'ready', project: added })
  }, 40_000)
