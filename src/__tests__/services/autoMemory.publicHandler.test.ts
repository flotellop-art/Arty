import * as paid from '../../services/paidFeatures'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { DatabaseSync as SQLiteDatabase } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { onRequestPost } from '../../../functions/api/ai/memory-extract'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import { maybeExtractMemory } from '../../services/autoMemory'
import * as memory from '../../services/localMemoryService'
import * as scoped from '../../services/scopedStorage'
import * as trial from '../../services/trialClient'
import * as toast from '../../services/toast'
import type { Conversation } from '../../types'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
// Same native SQLite bridge as useClientReply.measurementRoundTrip: actual SQL
// and unchanged public handler, not a D1/workerd or connected-provider recipe.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
let raw: SQLiteDatabase, env: Env, providerCalls: number, replies: number[], attemptedUrls: string[]
let replacementId: string
const conversation = (): Conversation => ({ id: 'public-memory-roundtrip', title: 'Synthetic', createdAt: 1, updatedAt: 1,
  messages: [1, 2, 3].map(n => ({ id: `m${n}`, role: 'user', content: 'Préférence synthétique durable. '.repeat(6), timestamp: n })) })

beforeEach(async () => {
  await resetCalendarFixture()
  vi.spyOn(paid, 'hasPaidServerFeatures').mockReturnValue(true)
  vi.spyOn(trial, 'getTrialRemaining').mockReturnValue(null)
  vi.spyOn(toast, 'toast').mockImplementation(() => {})
  raw = new DatabaseSync(':memory:')
  raw.exec(readFileSync('schema.sql', 'utf8'))
  const db = { prepare(sql: string) {
    let args: (string | number)[] = []
    return {
      bind(...values: (string | number)[]) { args = values; return this },
      async run() { const result = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } } },
      async first() { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null },
      async all() { return { success: true, results: raw.prepare(sql).all(...args).map(row => ({ ...row })) } },
    }
  } } as unknown as D1Database
  env = { ALLOWED_EMAILS: 'a@example.invalid', DB: db, GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: 'synthetic-server-key' } as Env
  providerCalls = 0; replies = []; attemptedUrls = []; replacementId = 'lm-not-sent'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    attemptedUrls.push(url)
    if (url === '/api/ai/memory-extract') {
      const response = await onRequestPost({ request: new Request('https://arty.test' + url, init), env } as never)
      replies.push(response.status); return response
    }
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) return Response.json({
      email: 'a@example.invalid', email_verified: true, aud: 'synthetic-client', sub: 'synthetic-a',
    })
    if (url === 'https://api.anthropic.com/v1/messages') {
      providerCalls++
      return Response.json({ content: [{ type: 'text', text: JSON.stringify({
        add: [{ fact: 'Nouveau souvenir synthétique' }], replace: [{ id: replacementId, fact: 'Remplacement synthétique' }],
      }) }], usage: { input_tokens: 10, output_tokens: 2 } })
    }
    throw new Error('Unexpected synthetic endpoint')
  }))
})
afterEach(() => { raw?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('new memory client → unchanged public handler → SQL → ciphertext → reload', () => {
  it('keeps encrypted A and adds B without any subsidy policy or new API contract', async () => {
    const a = await memory.addFact('Ancien souvenir synthétique')
    await maybeExtractMemory(conversation())
    expect(replies).toEqual([200]); expect(providerCalls).toBe(1)
    expect(attemptedUrls).toEqual(['/api/ai/memory-extract', 'https://oauth2.googleapis.com/tokeninfo?access_token=synthetic-a', 'https://api.anthropic.com/v1/messages'])
    const persisted = await scoped.secureGetJSON('local-memory-facts')
    expect(persisted).toEqual([a, expect.objectContaining({ content: 'Nouveau souvenir synthétique' })])
    expect(scoped.getItem('local-memory-facts')).toMatch(/^v[12]:/)
    memory.resetLocalMemoryCache(); await memory.bootstrapLocalMemory()
    expect(memory.getAll()).toEqual(persisted)
    expect(raw.prepare("SELECT count FROM bg_quota WHERE task='memory-extract'").get()).toMatchObject({ count: 1 })
    expect(toast.toast).toHaveBeenCalledOnce()
  })
  it('does not accept the old handler replacement of a partially transmitted manual fact', async () => {
    const a = (await memory.addFact('x'.repeat(300)))!; replacementId = a.id
    await maybeExtractMemory(conversation())
    expect(replies).toEqual([200]); expect(providerCalls).toBe(1)
    expect(attemptedUrls).toEqual(['/api/ai/memory-extract', 'https://oauth2.googleapis.com/tokeninfo?access_token=synthetic-a', 'https://api.anthropic.com/v1/messages'])
    expect(memory.getAll()[0]).toEqual(a)
    memory.resetLocalMemoryCache(); await memory.bootstrapLocalMemory()
    expect(memory.getAll()[0].content).toBe('x'.repeat(300))
  })
  it('keeps ciphertext unchanged at the public daily cap and does not resend the attempted prefix', async () => {
    const a = await memory.addFact('Ancien souvenir synthétique'), cipher = scoped.getItem('local-memory-facts')
    raw.prepare("INSERT INTO bg_quota(email,day,task,count,updated_at) VALUES(?,?,'memory-extract',20,0)")
      .run('a@example.invalid', new Date().toISOString().slice(0, 10))
    await maybeExtractMemory(conversation()); await maybeExtractMemory(conversation())
    expect(replies).toEqual([429]); expect(providerCalls).toBe(0)
    expect(attemptedUrls).toEqual(['/api/ai/memory-extract', 'https://oauth2.googleapis.com/tokeninfo?access_token=synthetic-a'])
    expect(scoped.getItem('local-memory-facts')).toBe(cipher); expect(memory.getAll()).toEqual([a])
    expect(toast.toast).not.toHaveBeenCalled()
  })
})
