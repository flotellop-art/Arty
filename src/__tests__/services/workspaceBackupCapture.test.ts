import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { openDB } from 'idb'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'

vi.unmock('../../services/workspaceWriter/runtime')
let users: typeof import('../../services/userSession')
let crypt: typeof import('../../services/crypto')
let history: typeof import('../../services/storage')
let files: typeof import('../../services/secureFileStorage')
let projects: typeof import('../../services/projects/store')
let capture: typeof import('../../services/workspaceBackup/capture')
let archive: typeof import('../../services/workspaceBackup/archive')
let source: Conversation
const session = (userId = 'a') => ({ userId, authMethod: 'apikey' as const, displayName: 'Synthetic', createdAt: 1 })
const signal = () => new AbortController().signal
const options = () => ({ includeProject: false, isBusy: () => false, signal: signal() })
function deferred<T>() { let resolve!: (v: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (v: T) => resolve(v) } }

beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob)
  localStorage.clear(); vi.stubGlobal('indexedDB', new IDBFactory())
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_n: string, _o: unknown, callback: (lock: unknown) => Promise<void>) { return callback({}) },
  } })
  await (await import('../../services/workspaceWriter/runtime')).documentWorkspace.acquire()
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
  history = await import('../../services/storage'); files = await import('../../services/secureFileStorage')
  projects = await import('../../services/projects/store'); capture = await import('../../services/workspaceBackup/capture')
  archive = await import('../../services/workspaceBackup/archive')
  users.setActiveSession(session()); await crypt.initCrypto('synthetic-backup-key')
  localStorage.setItem('arty-conv-encryption-disabled', '1')
  await history.bootstrapConversationStorage()
  source = { id: 'c', title: 'Privé Émile 😀', createdAt: 1, updatedAt: 2, tags: ['work', 'Client Émile'], euOnly: false,
    messages: [{ id: 'user', role: 'user', content: 'Original exact\r\n', timestamp: 1, pinned: false },
      { id: 'assistant', role: 'assistant', content: 'Texte historique', timestamp: 2, interrupted: true,
        factCheck: { overallConfidence: 'low', claims: [], checkedAt: 0, modelLabel: '', status: 'pending', appliedCorrections: 0 } }] }
  history.saveConversation(source)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
async function addTextFile() {
  await files.putFile({ id: 'f', name: 'saved.txt', type: 'text/plain', size: 1, data: 'QQ==' })
  source.messages[0]!.files = [{ id: 'f', name: 'original.txt', type: '', size: 999 }]
  source.messages[1]!.files = [{ id: 'f', name: 'other.txt', type: 'text/plain', size: 0 }]
  history.saveConversation(source)
}

describe('capture + seal + reopen from real admitted source stores', () => {
  it('keeps a saved capture verifiable after source writes but never allows a new stale download', async () => {
    const prepared = await capture.prepareConversationArchive('c', options()), blob = prepared.archive, code = prepared.recoveryCode, report = prepared.report
    expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.diagnostics)).toBe(true)
    history.saveConversation({ ...source, title: 'renamed' })
    expect(() => prepared.archive).toThrow('backup_changed')
    expect((await prepared.verify(blob, code)).fingerprint).toBe(report.fingerprint)
    const abort = new AbortController(); abort.abort()
    await expect(prepared.verify(blob, code, abort.signal)).rejects.toThrow('backup_cancelled')
  })
  it('detects a direct in-place mutation at handoff without a save or timestamp change', async () => {
    const prepared = await capture.prepareConversationArchive('c', options())
    source.messages[0]!.content = 'Changed through a shared reference'
    expect(() => prepared.archive).toThrow('backup_changed')
  })
  it('never invokes an accessor in the allowlisted projection', async () => {
    const getter = vi.fn(() => 'should not run')
    Object.defineProperty(source, 'title', { get: getter, enumerable: true })
    await expect(capture.prepareConversationArchive('c', options())).rejects.toThrow('backup_format')
    expect(getter).not.toHaveBeenCalled()
  })
  it('makes one atomic multi-file snapshot while a replacement waits behind the readonly transaction', async () => {
    await addTextFile(); await files.putFile({ id: 'g', name: 'second.txt', type: 'text/plain', data: 'QQ==' })
    const db = await openDB('arty-files', 1)
    const oldF = await db.get('files', 'f'), oldG = await db.get('files', 'g')
    const original = IDBObjectStore.prototype.get
    let replacement: Promise<void> | undefined
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function(key) {
      const request = original.call(this, key)
      if (this.name === 'files' && key === 'f') request.addEventListener('success', () => {
        const tx = db.transaction('files', 'readwrite')
        replacement = Promise.all([tx.store.put({ ...oldF, name: 'new-f' }), tx.store.put({ ...oldG, name: 'new-g' }), tx.done]).then(() => {})
      }, { once: true })
      return request
    })
    const snapshot = await files.readOwnedFileSnapshot(['f', 'g'], () => {})
    expect(snapshot.get('f')!.name).toBe(oldF.name); expect(snapshot.get('g')!.name).toBe(oldG.name)
    await replacement; expect((await db.get('files', 'g')).name).toBe('new-g'); db.close()
  })
  it('does not allow a detached readonly project read to fall back to a creator after closing', async () => {
    const op = await projects.beginProjectOperation(), project = await projects.createProject(op, 'P')
    const entered = deferred<void>(), resume = deferred<void>(), real = crypt.decrypt
    vi.spyOn(crypt, 'decrypt').mockImplementationOnce(async value => { const plain = await real(value); entered.resolve(); await resume.promise; return plain })
    let pending!: Promise<unknown>
    await projects.withReadOnlyProjectLibrary(projects.captureLocalReadScope(), async reader => { pending = reader.get(project.id).catch(error => error); await entered.promise })
    const opens = vi.spyOn(indexedDB, 'open')
    resume.resolve(); expect(await pending).toMatchObject({ code: 'cancelled' }); expect(opens).not.toHaveBeenCalled()
  })
  it('cancels when aborting during encryption rather than returning a sealed archive', async () => {
    const abort = new AbortController(), real = crypto.subtle.encrypt.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => { const bytes = await real(...args); abort.abort(); return bytes })
    await expect(capture.prepareConversationArchive('c', { ...options(), signal: abort.signal })).rejects.toThrow('backup_cancelled')
  })
  it.each(['\uD800A', '\uFEFFA'])('rejects lossy UTF16 but preserves an initial BOM in stored text: %j', async storedText => {
    const op = await projects.beginProjectOperation(), { prepareProjectDocument } = await import('../../services/projects/documentImport')
    let p = await projects.createProject(op, 'P')
    p = await projects.addProjectDocument(op, p, await prepareProjectDocument(op, new NodeFile(['AA'], 'a.txt') as unknown as File))
    const db = await openDB('arty-projects', 1), key = ['a', p.id, p.documents[0]!.id, 'text'], row = await db.get('documents', key)
    const payload = JSON.parse(await crypt.decrypt(row.cipher)); payload.content = storedText
    await db.put('documents', { ...row, cipher: await crypt.encrypt(JSON.stringify(payload)) }); db.close()
    source.projectId = p.id; source.hasProjectContext = true; history.saveConversation(source)
    if (storedText.startsWith('\uD800')) await expect(capture.prepareConversationArchive('c', { ...options(), includeProject: true })).rejects.toThrow('backup_format')
    else {
      const prepared = await capture.prepareConversationArchive('c', { ...options(), includeProject: true })
      const opened = await archive.openWorkspaceBackup(prepared.archive, prepared.recoveryCode, { assertCurrent() {} })
      const bytes = await opened.object(opened.manifest.projects[0]!.documents[0]!.textObjectId).arrayBuffer()
      expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)).toBe(storedText)
    }
  })
  it('refuses a project revision changed during a document read', async () => {
    const op = await projects.beginProjectOperation(), { prepareProjectDocument } = await import('../../services/projects/documentImport')
    let p = await projects.createProject(op, 'P')
    p = await projects.addProjectDocument(op, p, await prepareProjectDocument(op, new NodeFile(['A'], 'a.txt') as unknown as File))
    source.projectId = p.id; source.hasProjectContext = true; history.saveConversation(source)
    const entered = deferred<void>(), resume = deferred<void>(), real = crypt.decrypt
    vi.spyOn(crypt, 'decrypt').mockImplementation(async value => {
      const plain = await real(value)
      if (plain.includes('"kind":"source"')) { entered.resolve(); await resume.promise }
      return plain
    })
    const result = capture.prepareConversationArchive('c', { ...options(), includeProject: true }).catch(e => e)
    await entered.promise; await projects.updateProject(op, p, { name: 'new' }); resume.resolve()
    expect(capture.backupErrorCode(await result)).toBe('changed')
  })
  it('preserves a whole conversation and all three file sizes without any source write or project DB creation', async () => {
    await addTextFile()
    const before = { ...localStorage }, dbs = await indexedDB.databases()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put'), remove = vi.spyOn(IDBObjectStore.prototype, 'delete'), clear = vi.spyOn(IDBObjectStore.prototype, 'clear')
    const write = vi.spyOn(Storage.prototype, 'setItem'), erase = vi.spyOn(Storage.prototype, 'removeItem')
    const prepared = await capture.prepareConversationArchive('c', options())
    const opened = await archive.openWorkspaceBackup(prepared.archive, prepared.recoveryCode, { assertCurrent() {} })
    expect(opened.manifest.version).toBe(2)
    expect(opened.manifest.files[0]).toMatchObject({ id: 'f', name: 'saved.txt', type: 'text/plain', size: 1, recordedSize: 4 })
    expect(opened.manifest.conversations[0]!.messages[0]!.files![0]!.presentation).toEqual({ name: 'original.txt', type: '', size: 999 })
    expect(opened.manifest.conversations[0]!.messages[1]!.files![0]!.presentation).toEqual({ name: 'other.txt', type: 'text/plain', size: 0 })
    expect(opened.manifest.conversations[0]).toMatchObject({ title: source.title, tags: source.tags, euOnly: false })
    expect(opened.manifest.conversations[0]!.messages[0]).toMatchObject({ content: 'Original exact\r\n', pinned: false })
    expect(opened.manifest.conversations[0]!.messages[1]!.factCheck).toEqual(source.messages[1]!.factCheck)
    expect(await opened.object(opened.manifest.files[0]!.objectId).text()).toBe('A')
    expect(prepared.filename).not.toContain('Émile')
    expect((await prepared.verify(prepared.archive.slice(), prepared.recoveryCode)).fingerprint).toBe(prepared.report.fingerprint)
    expect(put).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled(); expect(erase).not.toHaveBeenCalled()
    expect({ ...localStorage }).toEqual(before); expect(await indexedDB.databases()).toEqual(dbs)
  })
  it('does not infer any dependency from a Markdown URI', async () => {
    source.messages[1]!.content = '![fake](arty-img://other-account-id)'; history.saveConversation(source)
    const read = vi.spyOn(IDBObjectStore.prototype, 'get')
    const prepared = await capture.prepareConversationArchive('c', options())
    expect(prepared.report.files).toBe(0)
    expect(read.mock.calls.some(([id]) => id === 'other-account-id')).toBe(false)
    expect(await indexedDB.databases()).toEqual([])
  })
  it('rejects a directly referenced missing file without creating the files DB', async () => {
    source.messages[0]!.files = [{ id: 'missing', name: 'absent.txt', type: 'text/plain' }]; history.saveConversation(source)
    await expect(capture.prepareConversationArchive('c', options())).rejects.toThrow('backup_missing')
    expect(await indexedDB.databases()).toEqual([])
  })
  it.each([undefined, null, ['bad'], ['a', 'a'], new Array(1)])('rejects present malformed galleries before file access: %j', async bad => {
    Object.assign(source.messages[1]!, { generatedImages: bad })
    // Preserve the live undefined/sparse field in cache; save's plain fallback
    // is irrelevant to the strict mapper, which reads the current cache.
    history.saveConversation(source)
    const read = vi.spyOn(IDBObjectStore.prototype, 'get')
    await expect(capture.prepareConversationArchive('c', options())).rejects.toThrow(/^backup_(format|limit)$/)
    expect(read).not.toHaveBeenCalled()
  })
  it('refuses an idle-looking but authoritative busy conversation before any capture', async () => {
    await expect(capture.prepareConversationArchive('c', { ...options(), isBusy: () => true })).rejects.toThrow('backup_busy')
  })
  it('keeps raw records immutable when the same file ID is replaced after the snapshot', async () => {
    await addTextFile()
    const snapshot = await files.readOwnedFileSnapshot(['f'], () => {})
    await files.putFile({ id: 'f', name: 'new.txt', type: 'text/plain', data: 'Qg==' })
    expect(await crypt.decrypt(snapshot.get('f')!.encryptedData)).toBe('QQ==')
    expect((await files.getFile('f'))!.data).toBe('Qg==')
  })
  it('does not confuse ordinary cache reads with mutations, but detects writes with the same timestamp and bootstrap replacement', async () => {
    const ticket = history.captureConversationForBackup('c', structuredClone)
    history.getConversations(); expect(() => ticket.assertUnchanged()).not.toThrow()
    history.saveConversation({ ...source, title: 'changed', updatedAt: source.updatedAt })
    expect(() => ticket.assertUnchanged()).toThrow('backup_changed')
    const next = history.captureConversationForBackup('c', structuredClone)
    await history.bootstrapConversationStorage()
    expect(() => next.assertUnchanged()).toThrow('backup_changed')
    history.resetConversationMemCache()
    expect(() => history.captureConversationForBackup('c', structuredClone)).toThrow('backup_unavailable')
  })
  it('cancels a capture when the source changes while decrypting even without updatedAt changing', async () => {
    await addTextFile()
    const gate = deferred<void>(), real = crypt.decrypt
    vi.spyOn(crypt, 'decrypt').mockImplementationOnce(async value => { const result = await real(value); await gate.promise; return result })
    const run = capture.prepareConversationArchive('c', options())
    const outcome = run.catch(error => error)
    await vi.waitFor(() => expect(crypt.decrypt).toHaveBeenCalled())
    history.saveConversation({ ...source, title: 'updated', updatedAt: source.updatedAt }); gate.resolve()
    expect(await outcome).toMatchObject({ code: 'changed' })
  })
  it('cancels on account A→B→A and never reactivates a prepared artifact', async () => {
    const prepared = await capture.prepareConversationArchive('c', options())
    users.setActiveSession(session('b')); users.setActiveSession(session('a')); await crypt.initCrypto('synthetic-backup-key')
    expect(() => prepared.archive).toThrow()
    await expect(prepared.validate()).rejects.toThrow()
  })
  it('blocks immediately during a server-erasure reservation and remains cancelled after its failed attempt is released', async () => {
    const prepared = await capture.prepareConversationArchive('c', options())
    const release = projects.blockProjectOperations('a')
    expect(() => prepared.archive).toThrow()
    release(); expect(() => prepared.archive).toThrow()
  })
  it.each([false, 0, '', null])('does not normalize an invalid durable erasing marker %j to absence', async value => {
    const scope = projects.captureLocalReadScope()
    await scope.validateReadOnly(); expect(await indexedDB.databases()).toEqual([])
    await projects.beginProjectOperation()
    const db = await openDB('arty-projects', 1); await db.put('meta', value, ['erasing', 'a']); db.close()
    await expect(scope.validateReadOnly()).rejects.toThrow('project_cancelled')
  })
  it('does not normalize a null durable fence', async () => {
    await projects.beginProjectOperation()
    const db = await openDB('arty-projects', 1); await db.put('meta', null, 'erasure-fence'); db.close()
    await expect(projects.captureLocalReadScope().validateReadOnly()).rejects.toThrow('project_corrupt')
  })
  it('reports unreadable rather than guessing whether a key is wrong or the ciphertext was tampered with', async () => {
    await addTextFile()
    const db = await openDB('arty-files', 1), row = await db.get('files', 'f')
    await db.put('files', { ...row, encryptedData: 'tampered' }); db.close()
    await expect(capture.prepareConversationArchive('c', options())).rejects.toThrow('backup_unreadable')
  })
  it('rejects a wrong code, another valid archive and disposed artifacts without writing anything', async () => {
    const first = await capture.prepareConversationArchive('c', options()), second = await capture.prepareConversationArchive('c', options())
    await expect(first.verify(first.archive, second.recoveryCode)).rejects.toThrow('backup_integrity')
    await expect(first.verify(second.archive, second.recoveryCode)).rejects.toThrow('backup_different')
    const blob = first.archive, code = first.recoveryCode
    first.dispose(); expect(() => first.archive).toThrow('backup_cancelled')
    expect((await capture.verifyWorkspaceArchive(blob, code, signal())).conversations).toBe(1)
  })
  it('includes the current project only on explicit selection, with exact sources and extracted text', async () => {
    const operation = await projects.beginProjectOperation()
    let project = await projects.createProject(operation, 'Source project')
    const { prepareProjectDocument } = await import('../../services/projects/documentImport')
    const document = await prepareProjectDocument(operation, new NodeFile(['Original Émile\r\nSecond line'], 'exact.txt', { type: 'text/plain' }) as unknown as File)
    project = await projects.addProjectDocument(operation, project, document)
    source.projectId = project.id; source.hasProjectContext = true; history.saveConversation(source)
    const without = await capture.prepareConversationArchive('c', options())
    expect(without.report.projects).toBe(0); expect(without.report.diagnostics.unavailableAssociatedProjects).toBe(1)
    const withProject = await capture.prepareConversationArchive('c', { ...options(), includeProject: true })
    const opened = await archive.openWorkspaceBackup(withProject.archive, withProject.recoveryCode, { assertCurrent() {} })
    const d = opened.manifest.projects[0]!.documents[0]!
    expect(await opened.object(d.sourceObjectId).text()).toBe('Original Émile\r\nSecond line')
    expect(await opened.object(d.textObjectId).text()).toBe(await projects.readProjectDocumentText(operation, project, project.documents[0]!.id))
  })
})
