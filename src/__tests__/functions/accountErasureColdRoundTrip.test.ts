/** @vitest-environment node */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { erasureDigest } from '../../services/accountErasureProtocol'
import { onRequestGet, onRequestPost } from '../../../functions/api/account/erasure-v1'
import { verifyEmailTrialToken } from '../../../functions/api/_lib/emailTrial'
import { deferred } from '../helpers/workspaceLocks'
import { createDatabaseShape, FILE_SHAPE } from '../../services/workspaceWriter/schema'
vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(() => { throw new Error('oauth forbidden') }) }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => `https://tryarty.com${path}` }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }))
let h: D1Harness, runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
const dom = new JSDOM('', { url: 'https://tryarty.com/?code=synthetic#callback' })
async function newDocument() {
  if (runtime) { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
  vi.resetModules(); lock = deferred()
  vi.stubGlobal('navigator', { locks: { request(_n: unknown, _o: unknown, callback: (v: unknown) => Promise<void>) { void callback({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime'); await runtime.documentWorkspace.acquire()
}
beforeAll(async () => {
  h = await makeD1Harness()
  vi.stubGlobal('localStorage', dom.window.localStorage); vi.stubGlobal('sessionStorage', dom.window.sessionStorage)
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('CustomEvent', dom.window.CustomEvent)
  vi.stubGlobal('indexedDB', new IDBFactory()); await newDocument()
})
afterAll(async () => {
  lock?.resolve()
  if (runtime) await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true))
  vi.unstubAllGlobals(); await h.dispose(); dom.window.close()
})

it('real hot POST commits D1 but loses its response → new cold document GETs with revoked token → new B document reads/writes', async () => {
  const email = 'cold-roundtrip@example.test', token = 'synthetic-cold-roundtrip-token'
  expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  let users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
  users.setActiveSession({ userId: 'b', authMethod: 'apikey', displayName: 'B', createdAt: 1 }); await crypt.initCrypto('key-b')
  let projects = await import('../../services/projects/store')
  const bProject = await projects.createProject(await projects.beginProjectOperation(), 'B durable')
  const files = await openDB('arty-files', 1, { upgrade(db) { createDatabaseShape(db, FILE_SHAPE) } }); files.close()
  await newDocument(); const layout = await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto'); projects = await import('../../services/projects/store')
  users.setActiveSession({ userId: 'a', authMethod: 'email', email, displayName: 'A', createdAt: 1 }); await crypt.initCrypto('key-a')
  const aProject = await projects.createProject(await projects.beginProjectOperation(), 'A pending')
  const trial = await import('../../services/emailTrialClient'); trial.setTrialToken(token)
  await h.db.prepare('INSERT INTO email_trial_sessions (token_hash,email,created_at,expires_at) VALUES (?1,?2,unixepoch(),unixepoch()+1000)').bind(await erasureDigest(token), email).run()
  const realFetch = globalThis.fetch, methods: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== 'https://tryarty.com/api/account/erasure-v1') return realFetch(input, init)
    const request = new Request(String(input), init); methods.push(request.method)
    if (request.method === 'POST') {
      expect((await onRequestPost({ request, env: h.env } as never)).status).toBe(200)
      expect(await verifyEmailTrialToken(new Request(request.url, { headers: { 'x-arty-trial-token': token } }), h.env)).toBeNull()
      throw new TypeError('lost response after real D1 commit')
    }
    expect(runtime.workspaceAdmission.getSnapshot()).toBe('maintenance')
    expect(() => runtime.assertDocumentWorkspace()).toThrow()
    expect([...request.headers.keys()].sort()).toEqual(['x-arty-erasure-capability', 'x-arty-erasure-operation'])
    return onRequestGet({ request, env: h.env } as never)
  })
  await expect((await import('../../services/accountService')).deleteAccount()).rejects.toThrow('lost response')
  const db = await openDB(layout.projects.name)
  expect(await db.get('meta', ['erasing', 'a'])).toMatchObject({ remote: { state: 'uncertain' } }); db.close()
  localStorage.removeItem('arty-a-email-trial-token')
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('erasure')
  const derive = vi.spyOn(crypto.subtle, 'deriveKey'), callback = dom.window.location.href
  await (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure().resume()
  expect(derive).not.toHaveBeenCalled(); expect(dom.window.location.href).toBe(callback); expect(methods).toEqual(['POST', 'GET']); derive.mockRestore()
  const after = await openDB(layout.projects.name)
  expect(await after.get('projects', ['a', aProject.id])).toBeUndefined(); expect(await after.get('meta', ['erasing', 'a'])).toBeUndefined(); after.close()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto'); projects = await import('../../services/projects/store')
  users.setActiveSession({ userId: 'b', authMethod: 'apikey', displayName: 'B', createdAt: 1 }); await crypt.initCrypto('key-b')
  const op = await projects.beginProjectOperation()
  expect(await projects.getProject(op, bProject.id)).toMatchObject({ status: 'ready', project: { name: 'B durable' } })
  const added = await projects.createProject(op, 'B after cold GET')
  expect(await projects.getProject(op, added.id)).toMatchObject({ status: 'ready', project: added })
})
