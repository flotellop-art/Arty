import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Env } from '../../../functions/env'
import { onRequest } from '../../../functions/api/measurement/client-reply-v1'
import { PRODUCT_MEASUREMENT_SCHEMA_SQL } from '../../../functions/api/_lib/productMeasurement'
import { measurementSQL, renderMeasurement } from '../../../scripts/lib/productMeasurement.mjs'
import * as google from '../../services/googleAuth'
import * as storage from '../../services/storage'
import { setActiveSession } from '../../services/userSession'
import { initCrypto } from '../../services/crypto'
import { setActiveKeys } from '../../services/activeApiKey'
import { useConversation } from '../../hooks/useConversation'
import { useClientReply } from '../../hooks/useClientReply'
import { ProductMeasurementSetting } from '../../components/settings/ProductMeasurementSetting'
import i18n from '../../i18n'
import { PRODUCT_MEASUREMENT_PATH } from '../../services/productMeasurementProtocol'
import { PRODUCT_MEASUREMENT_SETTING } from '../../services/productMeasurement'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/productMeasurementProtocol', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/productMeasurementProtocol')>(), PRODUCT_MEASUREMENT_RELEASED: true,
}))
vi.mock('../../hooks/usePlanStatus', () => ({ usePlanStatus: () => ({ plan: 'vip', allowedFamilies: ['mistral-medium'], loading: false, refresh() {} }) }))

// Miniflare's synchronous proxy is not compatible with jsdom's URL globals.
// This end-to-end UI recipe executes the actual collector SQL in SQLite;
// d1.productMeasurement.test.ts separately exercises the same writer in D1.
let raw: DatabaseSync, h: { db: D1Database; env: Env }, serial = 0, owner = ''
beforeAll(async () => {
  raw = new DatabaseSync(':memory:')
  const db = { prepare(sql: string) {
    let args: (string | number)[] = []
    return {
      bind(...values: (string | number)[]) { args = values; return this },
      async run() { raw.prepare(sql).run(...args); return { success: true } },
      async first() { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null },
      async all() { return { success: true, results: raw.prepare(sql).all(...args).map(row => ({ ...row })) } },
    }
  } } as unknown as D1Database
  h = { db, env: { DB: db, GOOGLE_CLIENT_ID: 'synthetic-client' } as Env }
  await db.prepare(PRODUCT_MEASUREMENT_SCHEMA_SQL).run()
})
afterAll(() => { raw?.close() })
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); google.resetGoogleMemCache(); storage.resetConversationMemCache()
  await h.db.prepare('DELETE FROM product_measurement_client_reply_v1').run()
  owner = `roundtrip-${++serial}`
  setActiveSession({ userId: owner, authMethod: 'google', email: 'PRIVATE@example.invalid', displayName: 'Synthetic', createdAt: 1 })
  await initCrypto(`synthetic-key-${serial}`); await google.storeUser({ email: 'PRIVATE@example.invalid', name: 'Synthetic', picture: '' })
  await google.storeMailboxFreeGrant({ access_token: 'synthetic-token', refresh_token: 'PRIVATE-refresh', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: 'PRIVATE@example.invalid' })
  await google.bootstrapGoogleStorage(); await storage.bootstrapConversationStorage(); await i18n.changeLanguage('fr')
  setActiveKeys('synthetic-anthropic', undefined, 'synthetic-mistral')
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    if (url === PRODUCT_MEASUREMENT_PATH) return onRequest({ request: new Request('https://tryarty.com' + PRODUCT_MEASUREMENT_PATH, init), env: h.env } as never)
    if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo?')) return Response.json({ email: 'PRIVATE@example.invalid', email_verified: true, aud: 'synthetic-client', sub: 'PRIVATE-SUB' })
    if (url === '/api/ai/mistral-proxy') return new Response(`data: ${JSON.stringify({ model: 'mistral-medium-latest', choices: [{ delta: { content: 'Réponse synthétique à relire.' } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    throw new Error('Unexpected synthetic endpoint')
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const received = async () => (await h.db.prepare('SELECT * FROM product_measurement_client_reply_v1').all()).results
function setup() {
  const conversation = renderHook(() => useConversation())
  const form = renderHook(() => useClientReply(conversation.result.current.startClientReply, conversation.result.current.projectReview.review, () => {}))
  act(() => form.result.current.open())
  act(() => form.result.current.update({ request: 'PRIVATE request', facts: 'PRIVATE facts', objective: 'PRIVATE objective', euOnly: true }))
  return { conversation, form }
}

describe('setting → real manual guide → transport → finalizer → collector → SQLite → report', () => {
  it.each([false, true])('only the explicitly enabled guide emits the saved declaration (enabled=%s)', async enabled => {
    render(<ProductMeasurementSetting />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem(`arty-${owner}-${PRODUCT_MEASUREMENT_SETTING}`)).toBeNull()
    if (enabled) fireEvent.click(screen.getByRole('switch'))
    const { conversation, form } = setup(); let pending!: Promise<void>
    act(() => { pending = form.result.current.submit() })
    await waitFor(() => expect(conversation.result.current.projectReview.request?.kind).toBe('confirm'))
    expect(fetch).not.toHaveBeenCalled()
    act(() => conversation.result.current.projectReview.answer(conversation.result.current.projectReview.request!.reviewId, true))
    await act(async () => { await pending })
    await waitFor(() => expect(storage.getConversations()[0]?.messages.at(-1)?.content).toBe('Réponse synthétique à relire.'))
    if (enabled) {
      await waitFor(async () => expect((await received())[0]?.saved).toBe(1))
      const day = String((await received())[0].day), to = new Date(new Date(day + 'T00:00:00Z').getTime() + 86_400_000).toISOString().slice(0, 10)
      const aggregate = await h.db.prepare(measurementSQL(day, to)).first()
      const report = renderMeasurement(aggregate, 'json')
      expect(JSON.parse(report).totals).toMatchObject({ total: 1, saved: 1 }); expect(report).not.toContain('PRIVATE')
    } else expect(await received()).toEqual([])
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(enabled
      ? ['/api/ai/mistral-proxy', PRODUCT_MEASUREMENT_PATH, 'https://oauth2.googleapis.com/tokeninfo?access_token=synthetic-token']
      : ['/api/ai/mistral-proxy'])
    expect(JSON.stringify(storage.getConversations())).not.toMatch(/observation|product-measurement|consent|"outcome"/)
  })
  it('abandons an enabled form unmounted during review without any beacon', async () => {
    render(<ProductMeasurementSetting />); fireEvent.click(screen.getByRole('switch'))
    const { conversation, form } = setup(); let pending!: Promise<void>
    act(() => { pending = form.result.current.submit() })
    await waitFor(() => expect(conversation.result.current.projectReview.request?.kind).toBe('confirm'))
    form.unmount(); await act(async () => { await pending })
    expect(fetch).not.toHaveBeenCalled(); expect(await received()).toEqual([])
  })
  it.each(['fr', 'en'])('shows opt-in scope and failed withdrawal honestly (%s)', async locale => {
    await i18n.changeLanguage(locale); render(<ProductMeasurementSetting />)
    fireEvent.click(screen.getByRole('switch')); expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (key.endsWith(PRODUCT_MEASUREMENT_SETTING)) throw new Error('quota'); real.call(this, key, value) })
    fireEvent.click(screen.getByRole('switch')); expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent(locale === 'fr' ? 'avant de recharger' : 'before reloading')
    expect(screen.getByRole('switch')).toBeDisabled()
    cleanup(); render(<ProductMeasurementSetting />)
    expect(screen.getByRole('switch')).toBeDisabled(); expect(screen.getByRole('alert')).toBeInTheDocument()
    vi.restoreAllMocks()
    fireEvent.click(screen.getByRole('button', { name: locale === 'fr' ? 'Réessayer la désactivation' : 'Retry saving the off setting' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(`arty-${owner}-${PRODUCT_MEASUREMENT_SETTING}`)!)).toMatchObject({ enabled: false })
    cleanup(); render(<ProductMeasurementSetting />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(fetch).not.toHaveBeenCalled()
  })
})
