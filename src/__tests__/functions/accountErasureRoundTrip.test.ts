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
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn() }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => `https://tryarty.com${path}` }))
vi.mock('../../services/secureFileStorage', () => ({ wipeFileStorage: vi.fn(async () => {}) }))
vi.mock('../../services/mailAccounts', () => ({ purgeMailAccountsForUser: vi.fn(async () => {}) }))
let h: D1Harness
const dom = new JSDOM('', { url: 'https://tryarty.com' })
beforeAll(async () => { h = await makeD1Harness(); vi.stubGlobal('localStorage', dom.window.localStorage); vi.stubGlobal('indexedDB', new IDBFactory()) })
afterAll(async () => { vi.unstubAllGlobals(); await h.dispose(); dom.window.close() })

it('actual client + IDB journal + D1 route: committed deletion, lost HTTP response, revoked token, fresh-JS GET recovery', async () => {
  const email = 'roundtrip@example.test', token = 'synthetic-roundtrip-token'
  let users = await import('../../services/userSession')
  users.setActiveSession({ userId: 'other', authMethod: 'email', email: 'other@example.test', displayName: 'Other', createdAt: 1 })
  users.setActiveSession({ userId: 'owner', authMethod: 'email', email, displayName: 'Owner', createdAt: 1 })
  const c = await import('../../services/crypto'); await c.initCrypto('synthetic-key')
  const store = await import('../../services/projects/store')
  const project = await store.createProject(await store.beginProjectOperation(), 'Pending local deletion')
  const trial = await import('../../services/emailTrialClient'); trial.setTrialToken(token)
  await h.db.prepare("INSERT INTO email_trial_sessions (token_hash,email,created_at,expires_at) VALUES (?1,?2,unixepoch(),unixepoch()+1000)").bind(await erasureDigest(token), email).run()
  await h.db.prepare("INSERT INTO memory (user_id,category,data) VALUES (?1,'profil','private')").bind(`trial-email:${email}`).run()
  const realFetch = globalThis.fetch, methods: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== 'https://tryarty.com/api/account/erasure-v1') return realFetch(input, init)
    const request = new Request(String(input), init); methods.push(request.method)
    if (request.method === 'POST') {
      expect((await onRequestPost({ request, env: h.env } as never)).status).toBe(200)
      // The email session is actually gone from D1 BEFORE the client fails.
      expect(await verifyEmailTrialToken(new Request(request.url, { headers: { 'x-arty-trial-token': token } }), h.env)).toBeNull()
      throw new TypeError('synthetic lost response after commit')
    }
    expect(request.headers.has('x-arty-trial-token')).toBe(false)
    expect(request.headers.has('x-google-token')).toBe(false)
    return onRequestGet({ request, env: h.env } as never)
  })
  let account = await import('../../services/accountService')
  await expect(account.deleteAccount()).rejects.toThrow('lost response after commit')
  const db = await openDB('arty-projects', 1)
  expect(await db.get('projects', ['owner', project.id])).toBeTruthy()
  expect(await db.get('meta', ['erasing', 'owner'])).toMatchObject({ remote: { state: 'uncertain' } })
  localStorage.removeItem('arty-owner-email-trial-token')
  vi.resetModules() // fresh JS graph; preserve actual D1 and local IDB/LS
  account = await import('../../services/accountService'); users = await import('../../services/userSession')
  expect(await account.getAccountErasureState()).toBe('uncertain')
  await account.deleteAccount()
  expect(methods).toEqual(['POST', 'GET'])
  expect(await db.get('projects', ['owner', project.id])).toBeUndefined()
  expect(await db.get('meta', ['erasing', 'owner'])).toBeUndefined()
  expect(users.getActiveUserId()).toBeNull()
  expect(users.getKnownSessions().map(s => s.userId)).toEqual(['other'])
  expect((await h.db.prepare('SELECT * FROM memory').all()).results).toEqual([])
  expect((await h.db.prepare('SELECT * FROM account_erasure_receipts_v1').all()).results).toHaveLength(1)
  db.close()
})
