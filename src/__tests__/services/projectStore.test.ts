import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
let store: typeof import('../../services/projects/store')
let users: typeof import('../../services/userSession')
let c: typeof import('../../services/crypto')
let prepare: typeof import('../../services/projects/documentImport')['prepareProjectDocument']
const session = (userId = 'a') => ({ userId, authMethod: 'apikey' as const, displayName: userId, createdAt: 1 })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
function file(text = 'Document privé\nLe chantier est prévu lundi.', name = 'notes.txt'): File {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer } as File
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear()
  globalThis.indexedDB = new IDBFactory()
  users = await import('../../services/userSession'); users.setActiveSession(session())
  c = await import('../../services/crypto'); await c.initCrypto('test-projects')
  store = await import('../../services/projects/store')
  prepare = (await import('../../services/projects/documentImport')).prepareProjectDocument
})
async function withDocument() {
  const op = await store.beginProjectOperation()
  const project = await store.createProject(op, 'Chantier')
  const prepared = await prepare(op, file())
  return { op, prepared, project: await store.addProjectDocument(op, project, prepared) }
}
async function db() { return openDB('arty-projects', 1) }

describe('project store — real IndexedDB transactions and Web Crypto', () => {
  it('round-trips project, separately encrypted source and extracted text', async () => {
    const { op, project, prepared } = await withDocument()
    expect(await store.readProjectDocumentText(op, project, prepared.descriptor.id)).toBe(prepared.text)
    expect(await store.readProjectDocumentSource(op, project, prepared.descriptor.id)).toBe(prepared.base64)
    const database = await db(), rows = await database.getAll('documents')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.kind).sort()).toEqual(['source', 'text'])
    expect(JSON.stringify(rows)).not.toContain('Document privé')
    expect(JSON.stringify(await database.getAll('projects'))).not.toContain('Chantier')
    expect(await database.get('usage', 'a')).toMatchObject({ projects: 1, documents: 1, sourceBytes: prepared.descriptor.sourceBytes })
  })
  it('CAS permits only one of two changes to the same revision', async () => {
    const op = await store.beginProjectOperation(), project = await store.createProject(op, 'Initial')
    const results = await Promise.allSettled(['One', 'Two'].map(name => store.updateProject(op, project, { name })))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } })
  })
  it('20-project account quota is atomic across simultaneous new project IDs', async () => {
    const op = await store.beginProjectOperation()
    const results = await Promise.allSettled(Array.from({ length: 21 }, (_, i) => store.createProject(op, `P${i}`)))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(20)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'limit' } })
    expect((await (await db()).get('usage', 'a')).projects).toBe(20)
  })
  it('the last account document slot cannot be consumed twice by different projects', async () => {
    const op = await store.beginProjectOperation()
    const projects = []
    for (let i = 0; i < 5; i++) projects.push(await store.createProject(op, `P${i}`))
    for (let i = 0; i < 63; i++) {
      const index = Math.floor(i / 16)
      projects[index] = await store.addProjectDocument(op, projects[index]!, await prepare(op, file('Small source')))
    }
    const first = await prepare(op, file('One')), second = await prepare(op, file('Two'))
    const results = await Promise.allSettled([
      store.addProjectDocument(op, projects[3]!, first), store.addProjectDocument(op, projects[4]!, second),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'limit' } })
    const database = await db()
    expect((await database.get('usage', 'a')).documents).toBe(64)
    expect(await database.count('documents')).toBe(128)
  }, 20_000)
  it('rename cannot smuggle a forged UI catalogue or timestamps', async () => {
    const { op, project } = await withDocument()
    const renamed = await store.updateProject(op, { ...project, documents: [], createdAt: 0 }, { name: 'Renamed' })
    expect(renamed.documents).toEqual(project.documents)
    expect(renamed.createdAt).toBe(project.createdAt)
    expect((await (await db()).get('usage', 'a')).documents).toBe(1)
  })
  it('document deletion atomically frees active quota and stores a content-free tombstone', async () => {
    const { op, project, prepared } = await withDocument()
    const next = await store.removeProjectDocument(op, project, prepared.descriptor.id)
    expect(next.documents).toEqual([])
    const database = await db(), rows = await database.getAll('documents')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'tombstone', state: 'deleted', cipher: null, sourceBytes: 0, textChars: 0 })
    expect(await database.get('usage', 'a')).toMatchObject({ projects: 1, documents: 0, sourceBytes: 0 })
    await expect(store.addProjectDocument(op, next, prepared)).rejects.toMatchObject({ code: 'cancelled' })
    expect(await database.count('documents')).toBe(1)
  })
  it('deletes a locked project without decrypting its manifest and frees all sources', async () => {
    const { op, project } = await withDocument(), database = await db()
    const row = await database.get('projects', ['a', project.id])
    await database.put('projects', { ...row, cipher: 'broken' })
    expect(await store.getProject(op, project.id)).toMatchObject({ status: 'locked' })
    await store.deleteProject(op, project.id, project.revision)
    expect(await store.getProject(op, project.id)).toMatchObject({ status: 'deleted' })
    expect(await database.count('documents')).toBe(0)
    expect(await database.get('usage', 'a')).toMatchObject({ projects: 0, documents: 0, sourceBytes: 0 })
  })
  it('refuses a corrupt byte counter rather than accepting an undercount', async () => {
    const { op, project } = await withDocument(), database = await db()
    const usage = await database.get('usage', 'a')
    await database.put('usage', { ...usage, sourceBytes: 0 })
    await expect(store.updateProject(op, project, { name: 'No' })).rejects.toMatchObject({ code: 'corrupt' })
    expect((await store.getProject(op, project.id))?.project?.name).toBe('Chantier')
  })
  it('rejects ciphertext substitution between source and text rows', async () => {
    const { op, project, prepared } = await withDocument(), database = await db()
    const source = await database.get('documents', ['a', project.id, prepared.descriptor.id, 'source'])
    const text = await database.get('documents', ['a', project.id, prepared.descriptor.id, 'text'])
    await database.put('documents', { ...text, cipher: source.cipher })
    await expect(store.readProjectDocumentText(op, project, prepared.descriptor.id)).rejects.toMatchObject({ code: 'locked' })
  })
  it('text reads do not touch the source record (a broken original remains isolated)', async () => {
    const { op, project, prepared } = await withDocument(), database = await db()
    const key = ['a', project.id, prepared.descriptor.id, 'source']
    await database.put('documents', { ...await database.get('documents', key), cipher: 'broken original' })
    expect(await store.readProjectDocumentText(op, project, prepared.descriptor.id)).toBe(prepared.text)
    await expect(store.readProjectDocumentSource(op, project, prepared.descriptor.id)).rejects.toMatchObject({ code: 'locked' })
  })
  it('prepared objects cannot be forged, mutated or rebound to a new operation', async () => {
    const op = await store.beginProjectOperation(), project = await store.createProject(op, 'P'), prepared = await prepare(op, file())
    expect(Object.isFrozen(prepared)).toBe(true); expect(Object.isFrozen(prepared.descriptor)).toBe(true)
    await expect(store.addProjectDocument(op, project, { ...prepared })).rejects.toMatchObject({ code: 'cancelled' })
    await expect(store.addProjectDocument(await store.beginProjectOperation(), project, prepared)).rejects.toMatchObject({ code: 'cancelled' })
    expect((await (await db()).get('usage', 'a')).documents).toBe(0)
  })
  it('account switch cancels import before any source is committed', async () => {
    const op = await store.beginProjectOperation(), project = await store.createProject(op, 'P'), gate = deferred()
    const actual = crypto.subtle.encrypt.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => { const value = await actual(...args); await gate.promise; return value })
    const prepared = await prepare(op, file()), pending = store.addProjectDocument(op, project, prepared).catch(error => error)
    await vi.waitFor(() => expect(crypto.subtle.encrypt).toHaveBeenCalled())
    users.setActiveSession(session('b')); gate.resolve()
    expect(await pending).toMatchObject({ code: 'cancelled' })
    expect(await (await db()).count('documents')).toBe(0)
  })
  it('durable erasure fence cancels even if a stale known-sessions array resurrects A', async () => {
    const { op, project } = await withDocument()
    const known = localStorage.getItem('arty-known-sessions')!
    users.removeKnownSession('a')
    await store.purgeProjectsForAccount('a', () => {})
    localStorage.setItem('arty-known-sessions', known)
    await expect(store.beginProjectOperation()).rejects.toMatchObject({ code: 'cancelled' })
    await expect(store.updateProject(op, project, { name: 'Resurrected' })).rejects.toMatchObject({ code: 'cancelled' })
    const database = await db()
    expect(await database.count('projects')).toBe(0); expect(await database.count('documents')).toBe(0)
    expect(await database.get('usage', 'a')).toBeUndefined()
    users.setActiveSession(session()); await c.initCrypto('test-projects')
    expect(await store.listProjects(await store.beginProjectOperation())).toEqual([])
  })
  it('project deletion during decryption never publishes the old instructions', async () => {
    const op = await store.beginProjectOperation(), project = await store.createProject(op, 'P'), gate = deferred()
    const actual = crypto.subtle.decrypt.bind(crypto.subtle), spy = vi.spyOn(crypto.subtle, 'decrypt')
      .mockImplementationOnce(async (...args) => { const value = await actual(...args); await gate.promise; return value })
    const pending = store.getProject(op, project.id).catch(error => error)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    await store.deleteProject(op, project.id, project.revision); gate.resolve()
    expect(await pending).toMatchObject({ code: 'deleted' })
  })
  it('project/account isolation rejects foreign IDs and leaves B data on A erasure', async () => {
    const { project } = await withDocument()
    users.setActiveSession(session('b')); await c.initCrypto('test-b')
    const opB = await store.beginProjectOperation(), b = await store.createProject(opB, 'B only')
    expect(await store.getProject(opB, project.id)).toBeNull()
    users.removeKnownSession('a'); await store.purgeProjectsForAccount('a', () => {})
    expect((await (await db()).get('projects', ['b', b.id])).cipher).toBeTruthy()
    expect(await (await db()).get('usage', 'b')).toMatchObject({ projects: 1 })
  })
  it('blocks local preparations immediately and release never revives old operations', async () => {
    const op = await store.beginProjectOperation(), release = store.blockProjectOperations('a')
    await expect(store.beginProjectOperation()).rejects.toMatchObject({ code: 'unavailable' })
    release()
    await expect(prepare(op, file())).rejects.toMatchObject({ code: 'cancelled' })
    expect(await store.beginProjectOperation()).toBeTruthy()
  })
})
