import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { captureCalendarDocumentCopy as capture } from '../../services/workflows/calendarDocumentCopy'
import { deleteConversation, saveConversation } from '../../services/storage'
import { initCrypto } from '../../services/crypto'
import { copyText, resetCalendarCopyFixture } from '../helpers/calendarCopyFixture'
import { created, draft, google, installCalendarAccount, relinkCalendarGoogle } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
import type { Conversation } from '../../types'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
let source: Conversation
const open = (isBusy = () => false) => capture('document-copy', 'source-answer', { isBusy })
beforeEach(async () => { source = await resetCalendarCopyFixture(); vi.stubGlobal('fetch', vi.fn(async () => created())) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('document text → independent adopted copy → exact reviewed Calendar mutation', () => {
  it('freezes inert text and historical references without reading attachments or performing any request', async () => {
    const getter = vi.fn(() => { throw new Error('must not read') })
    Object.defineProperty(source.messages[1], 'files', { get: getter, enumerable: true })
    Object.defineProperty(source.messages[1], 'generatedImages', { get: getter, enumerable: true })
    const actor = open(); await actor.validate()
    expect(actor.account).toBe('a@example.invalid'); expect(actor.source.text).toBe(copyText)
    expect(actor.source.references[0]).toContain('SHA-256 ' + 'a'.repeat(64))
    expect(Object.isFrozen(actor.source)).toBe(true); expect(getter).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    expect(() => actor.prepare(draft)).toThrow('calendarCopy.errors.state'); actor.dispose()
  })
  it.each(['in-place', 'saved-ABA', 'other-conversation', 'deleted'])('rejects %s before adoption without a request', async change => {
    const actor = open()
    if (change === 'in-place') source.messages[1]!.content = 'Changed'
    if (change === 'saved-ABA') { saveConversation({ ...source, title: 'B' }); saveConversation(source) }
    if (change === 'other-conversation') saveConversation({ ...source, id: 'elsewhere' })
    if (change === 'deleted') deleteConversation(source.id)
    await expect(actor.adopt()).rejects.toMatchObject({ code: 'changed' }); expect(fetch).not.toHaveBeenCalled()
  })
  it('checks busy at capture and at adoption, including a changed source while readonly validation waits', async () => {
    expect(() => open(() => true)).toThrow('calendarCopy.errors.busy')
    let busy = false
    const actor = open(() => busy), pending = actor.adopt(); busy = true
    await expect(pending).rejects.toMatchObject({ code: 'busy' }); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['interrupted', 'streaming', 'empty', 'duplicate', 'too-long', 'timestamp'])('refuses an unusable %s response', kind => {
    if (kind === 'interrupted') source.messages[1]!.interrupted = true
    if (kind === 'streaming') source.messages.push({ id: 'streaming', role: 'assistant', content: 'partial', timestamp: 3 })
    if (kind === 'empty') source.messages[1]!.content = '   '
    if (kind === 'duplicate') source.messages.push({ ...source.messages[1]! })
    if (kind === 'too-long') source.messages[1]!.content = 'a'.repeat(200001)
    if (kind === 'timestamp') source.messages[1]!.timestamp = Number.MAX_SAFE_INTEGER
    expect(() => open()).toThrow(); expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ status: 'pending' }, { modelLabel: 'Vérification en cours…' }])('allows an orphan historical pending verification %j without claiming it completed or restarting it', async pending => {
    source.messages[1]!.factCheck = pending as never
    const actor = open(); expect(actor.source.verificationPending).toBe(true); await actor.adopt(); expect(fetch).not.toHaveBeenCalled()
  })
  it('does not invoke an accessor on the copied content', () => {
    const getter = vi.fn(() => 'forged')
    Object.defineProperty(source.messages[1], 'content', { get: getter, enumerable: true })
    expect(() => open()).toThrow(); expect(getter).not.toHaveBeenCalled()
  })
  it('drops only source stability after adoption: later writes/deletion do not affect the independent copy', async () => {
    const actor = open(); await actor.adopt()
    source.messages[1]!.content = 'Modified'; saveConversation(source); deleteConversation(source.id)
    expect(actor.source.text).toBe(copyText); await actor.validate()
    const fields = { ...draft, description: '<script>literal</script>', location: '' }, prepared = actor.prepare(fields)
    fields.description = 'Unreviewed'
    await prepared.execute()
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(payload).toEqual({ calendarProtocol: 1, type: 'create', calendarAccount: 'a@example.invalid', title: draft.title,
      start: '2026-08-13T09:00:00+02:00', end: '2026-08-13T10:00:00+02:00', location: '', description: '<script>literal</script>' })
    expect(prepared.review).toContain('<script>literal</script>'); expect(fetch).toHaveBeenCalledOnce()
  })
  it('revokes old review A on review B, on edits and even on an invalid new preparation', async () => {
    const actor = open(); await actor.adopt()
    const a = actor.prepare(draft), b = actor.prepare({ ...draft, title: 'B' })
    await expect(a.execute()).rejects.toMatchObject({ code: 'state' })
    actor.discardReview(); await expect(b.execute()).rejects.toMatchObject({ code: 'state' })
    const c = actor.prepare(draft)
    expect(() => actor.prepare({})).toThrow(); await expect(c.execute()).rejects.toMatchObject({ code: 'state' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['same-grant', 'grant-ABA', 'owner', 'crypto', 'fence', 'closed'])('retains %s authority boundaries after adoption', async change => {
    const actor = open(); await actor.adopt(); const prepared = actor.prepare(draft)
    if (change === 'same-grant') await relinkCalendarGoogle('a')
    if (change === 'grant-ABA') { await relinkCalendarGoogle('b'); await relinkCalendarGoogle('a') }
    if (change === 'owner') await installCalendarAccount('b')
    if (change === 'crypto') await initCrypto('synthetic-other-key')
    if (change === 'fence') { const db = await openDB('arty-projects', 1, { upgrade(db) { db.createObjectStore('meta') } }); await db.put('meta', 'changed', 'erasure-fence'); db.close() }
    if (change === 'closed') actor.dispose()
    await expect(prepared.execute()).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled()
  })
  it('reserves one attempt before awaits, and never retries an unknown response', async () => {
    const actor = open(); await actor.adopt(); const prepared = actor.prepare(draft), gate = deferred<Response>()
    vi.mocked(fetch).mockImplementation(() => gate.promise)
    const outcome = prepared.execute().catch(e => e)
    await expect(prepared.execute()).rejects.toMatchObject({ code: 'state' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); gate.reject(new Error('Response lost'))
    expect(await outcome).toMatchObject({ outcome: 'unknown' }); expect(() => actor.prepare(draft)).toThrow(); expect(fetch).toHaveBeenCalledOnce()
  })
  it('revocation notification is immediate, content-free, nonthrowing, unsubscribable and cannot recapture authority', async () => {
    const lease = google.captureGoogleGrant()!, observed: unknown[] = []
    const stopThrowing = google.onGoogleGrantInvalidated(() => { throw new Error('observer') })
    const stop = google.onGoogleGrantInvalidated((...args) => observed.push([args, lease.isCurrent(), google.captureGoogleGrant()]))
    const installing = google.storeTokens({ access_token: 'synthetic-new', expires_at: Date.now() + 3600000 })
    expect(observed).toEqual([[[], false, null]])
    await installing; stop(); stopThrowing(); google.resetGoogleMemCache(); expect(observed).toHaveLength(1)
  })
  it('validates limits without truncation and leaves the source untouched', async () => {
    const actor = open(); await actor.adopt()
    expect(actor.prepare({ ...draft, description: 'x'.repeat(8192) }).payload.description).toHaveLength(8192)
    expect(() => actor.prepare({ ...draft, description: 'x'.repeat(8193) })).toThrow()
    expect(() => actor.prepare({ ...draft, title: 'x'.repeat(1025) })).toThrow()
    expect(source.messages[1]!.content).toBe(copyText); expect(fetch).not.toHaveBeenCalled()
  })
})
