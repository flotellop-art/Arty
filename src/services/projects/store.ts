import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { captureCryptoGuard, encrypt, decrypt, isCryptoReady, isCryptoContextChanged } from '../crypto'
import { getActiveUserId, getActiveSessionEpoch, getKnownSessions, getSessionProjectFence, PROJECT_ERASURE_FENCE_KEY } from '../userSession'
import { assertPreparedForOperation, consumePreparedDocument } from './documentImport'
import { generateId } from '../../utils/generateId'
import { assertDocumentWorkspace, guardDocumentTransaction, getDocumentStorageLayout } from '../workspaceWriter/runtime'
import { openExistingDB } from '../readOnlyExistingDB'
import { openDeclaredDatabase } from '../workspaceWriter/declaredDatabase'
import { captureOwnerErasureGuard } from './localErasureGuard'
import { parseRemoteErasure, type RemoteErasureIntent } from '../accountErasureProtocol'
import { parseAccountErasureRecord } from '../accountErasureJournal'
export { blockProjectOperations } from './localErasureGuard'
import { PROJECT_LIMITS, ProjectError, boundedInteger, validProject, validProjectId, validDescriptor,
  type PreparedProjectDocument, type ProjectDocument, type Project, type ProjectSummary } from './types'

const STORES = ['projects', 'documents', 'usage', 'meta'] as const
type Transaction = IDBPTransaction<unknown, string[], 'readwrite'>
type ProjectRow = {
  key: [string, string]; owner: string; id: string; revision: number; state: 'live' | 'deleted'
  euOnly: boolean; createdAt: number; updatedAt: number; cipher: string | null
}
type DocumentRow = {
  key: [string, string, string, 'source' | 'text' | 'tombstone']; owner: string; projectId: string; id: string
  kind: 'source' | 'text' | 'tombstone'; state: 'live' | 'deleted'; sourceBytes: number; textChars: number
  updatedAt: number; cipher: string | null
}
type Usage = { owner: string; projects: number; documents: number; sourceBytes: number }
let dbPromise: Promise<IDBPDatabase> | null = null

function getDB(): Promise<IDBPDatabase> {
  assertDocumentWorkspace()
  const layout = getDocumentStorageLayout(), { name, version } = layout.projects
  if (!dbPromise) {
  const closed = () => { if (dbPromise === opening) dbPromise = null }
  const opening: Promise<IDBPDatabase> = (layout.kind === 'isolated-v1' ? openDeclaredDatabase(layout.projects, closed) : openDB(name, version, {
    upgrade(db) {
      assertDocumentWorkspace()
      const projects = db.createObjectStore('projects', { keyPath: 'key' })
      projects.createIndex('owner', 'owner')
      projects.createIndex('owner-state', ['owner', 'state'])
      const documents = db.createObjectStore('documents', { keyPath: 'key' })
      documents.createIndex('owner', 'owner')
      documents.createIndex('owner-project', ['owner', 'projectId'])
      documents.createIndex('owner-state-kind', ['owner', 'state', 'kind'])
      documents.createIndex('owner-state-kind-bytes', ['owner', 'state', 'kind', 'sourceBytes'])
      db.createObjectStore('usage', { keyPath: 'owner' })
      db.createObjectStore('meta')
    },
    blocking() { void opening.then(db => db.close(), () => {}); closed() },
    terminated: closed,
  })).catch(error => { closed(); throw error })
  dbPromise = opening
  }
  return dbPromise
}
const OPERATION = Symbol('project-operation')
const readDatabases = new WeakMap<ProjectOperation, IDBPDatabase>()
const operationDB = (operation: ProjectOperation): Promise<IDBPDatabase> => {
  // Check BEFORE any fallback: a closed readonly callback may still have a
  // detached async read finishing. It must never reopen a creator connection.
  checkOperation(operation)
  return readDatabases.has(operation) ? Promise.resolve(readDatabases.get(operation)!) : getDB()
}
export interface ProjectOperation {
  readonly owner: string
  readonly epoch: number
  readonly fence: string
  readonly [OPERATION]: true
  assertCurrent(): void
}
/** Capture BEFORE reading an import file or preparing any project request.
 * The global, ownerless IDB fence cancels work in other windows on erasure.
 * It contains no identity/content and survives erasure of all owner records.
 */
/** Shared synchronous admission, including erasure BEFORE its server request.
 * Capture/export uses this without creating or repairing any database. */
export function captureLocalReadScope(signal?: AbortSignal) {
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
  if (!owner || owner.length > 128 || !isCryptoReady()) throw new ProjectError('unavailable')
  const assertNotErasing = captureOwnerErasureGuard(owner), cryptoCurrent = captureCryptoGuard(), sessionFence = getSessionProjectFence()
  if (sessionFence === null) throw new ProjectError('cancelled')
  const assertCurrent = () => {
    assertDocumentWorkspace()
    assertNotErasing()
    if (signal?.aborted || !cryptoCurrent() || owner !== getActiveUserId() || epoch !== getActiveSessionEpoch() ||
      sessionFence !== (localStorage.getItem(PROJECT_ERASURE_FENCE_KEY) ?? 'initial') ||
      !getKnownSessions().some(session => session.userId === owner)) throw new ProjectError('cancelled')
  }
  assertCurrent()
  return { owner, epoch, fence: sessionFence, signal, assertCurrent, async validateReadOnly() {
    assertCurrent()
    const { name, version } = getDocumentStorageLayout().projects
    const db = await openExistingDB(name, version, assertCurrent, signal)
    try {
      if (!db) {
        if (getDocumentStorageLayout().kind === 'isolated-v1') throw new ProjectError('unavailable')
        if (sessionFence !== 'initial') throw new ProjectError('cancelled')
        assertCurrent(); return
      }
      await validateReadFence(db, { owner, fence: sessionFence, assertCurrent })
    } finally { db?.close() }
  } }
}
type LocalReadScope = ReturnType<typeof captureLocalReadScope>
async function validateReadFence(db: IDBPDatabase, scope: Pick<LocalReadScope, 'owner' | 'fence' | 'assertCurrent'>) {
  scope.assertCurrent()
  if (!db.objectStoreNames.contains('meta')) throw new ProjectError('corrupt')
  const tx = db.transaction('meta', 'readonly')
  try {
  const [fence, erasing] = await Promise.all([tx.store.get('erasure-fence'), tx.store.get(['erasing', scope.owner])])
  await tx.done; scope.assertCurrent()
  if (fence !== undefined && typeof fence !== 'string') throw new ProjectError('corrupt')
  if ((fence === undefined ? 'initial' : fence) !== scope.fence || erasing !== undefined) throw new ProjectError('cancelled')
  } catch (error) { try { tx.abort() } catch { /* complete */ }; await tx.done.catch(() => {}); throw error }
}
export async function beginProjectOperation(): Promise<ProjectOperation> {
  const { owner, epoch, fence: sessionFence, assertCurrent } = captureLocalReadScope()
  const db = await getDB(); assertCurrent()
  const fence = await db.get('meta', 'erasure-fence') ?? 'initial'; assertCurrent()
  if (await db.get('meta', ['erasing', owner])) throw new ProjectError('unavailable')
  assertCurrent()
  if (typeof fence !== 'string') throw new ProjectError('corrupt')
  if (fence !== sessionFence) throw new ProjectError('cancelled')
  return { owner, epoch, fence, assertCurrent, [OPERATION]: true }
}
function checkOperation(operation: ProjectOperation): void {
  if (operation[OPERATION] !== true) throw new ProjectError('cancelled')
  operation.assertCurrent()
}
/** Recheck the durable fence before publishing an async read or sending context. */
export async function assertProjectOperation(operation: ProjectOperation): Promise<void> {
  checkOperation(operation)
  const db = await operationDB(operation); checkOperation(operation)
  if ((await db.get('meta', 'erasure-fence') ?? 'initial') !== operation.fence) throw new ProjectError('cancelled')
  if (await db.get('meta', ['erasing', operation.owner])) throw new ProjectError('cancelled')
  checkOperation(operation)
}
async function checkFence(tx: Transaction, operation: ProjectOperation): Promise<void> {
  checkOperation(operation)
  if ((await tx.objectStore('meta').get('erasure-fence') ?? 'initial') !== operation.fence) throw new ProjectError('cancelled')
  if (await tx.objectStore('meta').get(['erasing', operation.owner])) throw new ProjectError('cancelled')
  checkOperation(operation)
}
function validRow(row: ProjectRow, owner: string, id: string): boolean {
  return row.owner === owner && row.id === id && Array.isArray(row.key) && row.key.length === 2 && row.key[0] === owner && row.key[1] === id &&
    validProjectId(id) && boundedInteger(row.revision) && row.revision > 0 && typeof row.euOnly === 'boolean' &&
    boundedInteger(row.createdAt) && boundedInteger(row.updatedAt) && ['live', 'deleted'].includes(row.state)
}
async function decodeProject(operation: ProjectOperation, row: ProjectRow): Promise<Project> {
  checkOperation(operation)
  if (!validRow(row, operation.owner, row.id)) throw new ProjectError('corrupt')
  if (row.state === 'deleted') throw new ProjectError('deleted')
  if (typeof row.cipher !== 'string' || row.cipher.length > 100_000) throw new ProjectError('locked')
  try {
    const payload = JSON.parse(await decrypt(row.cipher)) as Project
    await assertProjectOperation(operation)
    if (!validProject(payload) || payload.owner !== operation.owner || payload.id !== row.id || payload.revision !== row.revision ||
      payload.euOnly !== row.euOnly || payload.createdAt !== row.createdAt || payload.updatedAt !== row.updatedAt) throw new ProjectError('locked')
    const current = await (await operationDB(operation)).get('projects', [operation.owner, row.id]) as ProjectRow | undefined
    checkOperation(operation)
    if (!current || current.state === 'deleted') throw new ProjectError('deleted')
    if (current.revision !== row.revision || current.cipher !== row.cipher) throw new ProjectError('conflict')
    return payload
  } catch (error) {
    checkOperation(operation)
    if (isCryptoContextChanged(error)) throw new ProjectError('cancelled')
    if (error instanceof ProjectError) throw error
    throw new ProjectError('locked')
  }
}
export async function getProject(operation: ProjectOperation, id: string): Promise<ProjectSummary | null> {
  checkOperation(operation)
  if (!validProjectId(id)) throw new ProjectError('corrupt')
  const db = await operationDB(operation); checkOperation(operation)
  const row = await db.get('projects', [operation.owner, id]) as ProjectRow | undefined
  checkOperation(operation)
  if (!row) return null
  if (!validRow(row, operation.owner, id)) throw new ProjectError('corrupt')
  if (row.state === 'deleted') return { id, revision: row.revision, euOnly: row.euOnly, status: 'deleted' }
  try { return { id, revision: row.revision, euOnly: row.euOnly, status: 'ready', project: await decodeProject(operation, row) } }
  catch (error) {
    if (error instanceof ProjectError && error.code === 'locked') return { id, revision: row.revision, euOnly: row.euOnly, status: 'locked' }
    throw error
  }
}
export async function listProjects(operation: ProjectOperation): Promise<ProjectSummary[]> {
  checkOperation(operation)
  const db = await operationDB(operation); checkOperation(operation)
  const rows = await db.getAllFromIndex('projects', 'owner-state', [operation.owner, 'live'], PROJECT_LIMITS.projects + 1) as ProjectRow[]
  checkOperation(operation)
  if (rows.length > PROJECT_LIMITS.projects) throw new ProjectError('limit')
  const result: ProjectSummary[] = []
  for (const row of rows) {
    checkOperation(operation)
    if (!validRow(row, operation.owner, row.id)) throw new ProjectError('corrupt')
    try { result.push({ id: row.id, revision: row.revision, euOnly: row.euOnly, status: 'ready', project: await decodeProject(operation, row) }) }
    catch (error) {
      if (!(error instanceof ProjectError) || error.code !== 'locked') throw error
      result.push({ id: row.id, revision: row.revision, euOnly: row.euOnly, status: 'locked' })
    }
  }
  return result.sort((a, b) => (b.project?.updatedAt ?? 0) - (a.project?.updatedAt ?? 0))
}

/** Technical, non-content counters are intentionally clear and atomic. */
async function readUsage(tx: Transaction, owner: string): Promise<Usage> {
  const usage = await tx.objectStore('usage').get(owner) as Usage | undefined
  const projects = await tx.objectStore('projects').index('owner-state').count([owner, 'live'])
  const documents = await tx.objectStore('documents').index('owner-state-kind').count([owner, 'live', 'source'])
  let sourceBytes = 0, indexedDocuments = 0
  const range = IDBKeyRange.bound([owner, 'live', 'source'], [owner, 'live', 'source', []])
  let cursor = await tx.objectStore('documents').index('owner-state-kind-bytes').openKeyCursor(range)
  while (cursor) {
    const bytes = (cursor.key as IDBValidKey[])[3]
    if (!boundedInteger(bytes, PROJECT_LIMITS.sourceBytes) || bytes === 0) throw new ProjectError('corrupt')
    sourceBytes += bytes; indexedDocuments++
    if (sourceBytes > PROJECT_LIMITS.ownerSourceBytes || indexedDocuments > PROJECT_LIMITS.documentsPerOwner) throw new ProjectError('corrupt')
    cursor = await cursor.continue()
  }
  if (indexedDocuments !== documents) throw new ProjectError('corrupt')
  if (!usage) {
    if (projects || documents) throw new ProjectError('corrupt')
    return { owner, projects: 0, documents: 0, sourceBytes: 0 }
  }
  if (usage.owner !== owner || !boundedInteger(usage.projects, PROJECT_LIMITS.projects) || usage.projects !== projects ||
    !boundedInteger(usage.documents, PROJECT_LIMITS.documentsPerOwner) || usage.documents !== documents ||
    !boundedInteger(usage.sourceBytes, PROJECT_LIMITS.ownerSourceBytes) || usage.sourceBytes !== sourceBytes) throw new ProjectError('corrupt')
  return usage
}
function updateUsage(usage: Usage, delta: Omit<Usage, 'owner'>): Usage {
  const next = { owner: usage.owner, projects: usage.projects + delta.projects, documents: usage.documents + delta.documents, sourceBytes: usage.sourceBytes + delta.sourceBytes }
  if (!boundedInteger(next.projects) || !boundedInteger(next.documents) || !boundedInteger(next.sourceBytes)) throw new ProjectError('corrupt')
  if (next.projects > PROJECT_LIMITS.projects || next.documents > PROJECT_LIMITS.documentsPerOwner || next.sourceBytes > PROJECT_LIMITS.ownerSourceBytes) throw new ProjectError('limit')
  return next
}
async function encryptPayload(operation: ProjectOperation, payload: unknown): Promise<string> {
  checkOperation(operation)
  try { const result = await encrypt(JSON.stringify(payload)); checkOperation(operation); return result }
  catch (error) { if (isCryptoContextChanged(error)) throw new ProjectError('cancelled'); throw error }
}
async function writeProject(
  operation: ProjectOperation, expectedRevision: number, project: Project,
  documentWrites: DocumentRow[] = [], documentDeletes: IDBValidKey[] = [], delta: Omit<Usage, 'owner'> = { projects: 0, documents: 0, sourceBytes: 0 },
): Promise<Project> {
  checkOperation(operation)
  if (!validProject(project) || project.owner !== operation.owner || project.revision !== expectedRevision + 1) throw new ProjectError('corrupt')
  const cipher = await encryptPayload(operation, project); checkOperation(operation)
  const db = await getDB(); checkOperation(operation)
  const tx = guardDocumentTransaction(db.transaction([...STORES], 'readwrite'))
  try {
    await checkFence(tx, operation)
    const previous = await tx.objectStore('projects').get([operation.owner, project.id]) as ProjectRow | undefined
    checkOperation(operation)
    if ((previous?.revision ?? 0) !== expectedRevision || previous?.state === 'deleted') throw new ProjectError('conflict')
    if (previous && (!validRow(previous, operation.owner, project.id) || previous.euOnly !== project.euOnly)) throw new ProjectError('corrupt')
    const usage = updateUsage(await readUsage(tx, operation.owner), delta)
    checkOperation(operation)
    for (const row of documentWrites) {
      if (await tx.objectStore('documents').get(row.key)) throw new ProjectError('conflict')
      if (row.kind !== 'tombstone' && await tx.objectStore('documents').get([row.owner, row.projectId, row.id, 'tombstone'])) throw new ProjectError('deleted')
      checkOperation(operation)
      await tx.objectStore('documents').add(row)
    }
    for (const key of documentDeletes) { checkOperation(operation); await tx.objectStore('documents').delete(key) }
    await tx.objectStore('projects').put({ key: [operation.owner, project.id], owner: operation.owner, id: project.id, revision: project.revision,
      euOnly: project.euOnly, state: 'live', createdAt: project.createdAt, updatedAt: project.updatedAt, cipher } satisfies ProjectRow)
    checkOperation(operation)
    await tx.objectStore('usage').put(usage)
    await pruneTombstones(tx, operation.owner); checkOperation(operation)
    await tx.done
    checkOperation(operation)
    return project
  } catch (error) {
    try { tx.abort() } catch { /* already completed/aborted */ }
    await tx.done.catch(() => {})
    throw error
  }
}
export async function createProject(operation: ProjectOperation, name: string, euOnly = false): Promise<Project> {
  checkOperation(operation)
  const now = Date.now()
  return writeProject(operation, 0, { schema: 1, owner: operation.owner, id: generateId(), revision: 1, name: name.trim(),
    instructions: '', euOnly, documents: [], createdAt: now, updatedAt: now }, [], [], { projects: 1, documents: 0, sourceBytes: 0 })
}
export async function updateProject(operation: ProjectOperation, project: Project, changes: { name?: string; instructions?: string }): Promise<Project> {
  checkOperation(operation)
  const current = await requireProject(operation, project.id, project.revision)
  return writeProject(operation, current.revision, { ...current, name: changes.name?.trim() ?? current.name,
    instructions: changes.instructions ?? current.instructions, revision: current.revision + 1, updatedAt: Date.now() })
}

async function requireProject(operation: ProjectOperation, id: string, revision: number): Promise<Project> {
  const summary = await getProject(operation, id)
  if (!summary || summary.status === 'deleted') throw new ProjectError('deleted')
  if (summary.status === 'locked' || !summary.project) throw new ProjectError('locked')
  if (summary.revision !== revision) throw new ProjectError('conflict')
  return summary.project
}

type DocumentPayload = {
  schema: 1; owner: string; projectId: string; kind: 'source' | 'text'; descriptor: ProjectDocument; content: string
}
function snapshotDescriptor(d: ProjectDocument): ProjectDocument {
  if (!validDescriptor(d)) throw new ProjectError('corrupt')
  return { id: d.id, name: d.name, originalName: d.originalName, format: d.format, revision: d.revision,
    sourceHash: d.sourceHash, sourceBytes: d.sourceBytes, textChars: d.textChars, extractorVersion: d.extractorVersion, createdAt: d.createdAt }
}
function sameDescriptor(a: ProjectDocument, b: ProjectDocument): boolean {
  return JSON.stringify(snapshotDescriptor(a)) === JSON.stringify(snapshotDescriptor(b))
}
async function verifyOriginal(base64: string, descriptor: ProjectDocument): Promise<void> {
  if (base64.length !== 4 * Math.ceil(descriptor.sourceBytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ProjectError('corrupt')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)) } catch { throw new ProjectError('corrupt') }
  if (bytes.length !== descriptor.sourceBytes) throw new ProjectError('corrupt')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== descriptor.sourceHash) throw new ProjectError('corrupt')
}
export async function addProjectDocument(operation: ProjectOperation, project: Project, prepared: PreparedProjectDocument): Promise<Project> {
  checkOperation(operation)
  assertPreparedForOperation(prepared, operation)
  // Copy the caller's mutable descriptor before any await; never trust its catalogue.
  const descriptor = snapshotDescriptor(prepared.descriptor), base64 = prepared.base64, text = prepared.text
  if (typeof base64 !== 'string' || typeof text !== 'string' || text.length !== descriptor.textChars || !text.trim()) throw new ProjectError('corrupt')
  const current = await requireProject(operation, project.id, project.revision)
  const next = { ...current, documents: [...current.documents, descriptor], revision: current.revision + 1, updatedAt: Date.now() }
  if (!validProject(next)) throw new ProjectError('limit')
  await verifyOriginal(base64, descriptor); checkOperation(operation)
  const rows: DocumentRow[] = []
  for (const kind of ['source', 'text'] as const) {
    const payload: DocumentPayload = { schema: 1, owner: operation.owner, projectId: current.id, kind, descriptor, content: kind === 'source' ? base64 : text }
    const cipher = await encryptPayload(operation, payload); checkOperation(operation)
    rows.push({ key: [operation.owner, current.id, descriptor.id, kind], owner: operation.owner, projectId: current.id, id: descriptor.id,
      kind, state: 'live', sourceBytes: descriptor.sourceBytes, textChars: descriptor.textChars, updatedAt: next.updatedAt, cipher })
  }
  const saved = await writeProject(operation, current.revision, next, rows, [], { projects: 0, documents: 1, sourceBytes: descriptor.sourceBytes })
  consumePreparedDocument(prepared)
  return saved
}
async function readDocument(operation: ProjectOperation, project: Project, documentId: string, kind: 'source' | 'text'): Promise<string> {
  checkOperation(operation)
  const current = await requireProject(operation, project.id, project.revision)
  const descriptor = current.documents.find(d => d.id === documentId)
  if (!descriptor) throw new ProjectError('deleted')
  const db = await operationDB(operation); checkOperation(operation)
  // A text read MUST NOT clone/fetch the original source record.
  const key = [operation.owner, current.id, documentId, kind]
  const row = await db.get('documents', key) as DocumentRow | undefined
  checkOperation(operation)
  const maxPlainChars = (kind === 'source' ? 4 * Math.ceil(descriptor.sourceBytes / 3) : descriptor.textChars * 6) + 5000
  if (!row || row.owner !== operation.owner || row.projectId !== current.id || row.id !== documentId || row.kind !== kind || row.state !== 'live' ||
    JSON.stringify(row.key) !== JSON.stringify(key) || row.sourceBytes !== descriptor.sourceBytes || row.textChars !== descriptor.textChars ||
    typeof row.cipher !== 'string' || row.cipher.length > maxPlainChars * 2) throw new ProjectError('locked')
  try {
    const plain = await decrypt(row.cipher); checkOperation(operation)
    if (plain.length > maxPlainChars) throw new ProjectError('locked')
    const payload = JSON.parse(plain) as DocumentPayload
    if (payload.schema !== 1 || payload.owner !== operation.owner || payload.projectId !== current.id || payload.kind !== kind ||
      !sameDescriptor(payload.descriptor, descriptor) || typeof payload.content !== 'string') throw new ProjectError('locked')
    if (kind === 'text' && payload.content.length !== descriptor.textChars) throw new ProjectError('locked')
    if (kind === 'source') await verifyOriginal(payload.content, descriptor)
    await assertProjectOperation(operation)
    // A project/document deleted or replaced during decryption is not published.
    await requireProject(operation, current.id, current.revision)
    return payload.content
  } catch (error) {
    checkOperation(operation)
    if (isCryptoContextChanged(error)) throw new ProjectError('cancelled')
    if (error instanceof ProjectError) throw error
    throw new ProjectError('locked')
  }
}
export const readProjectDocumentText = (operation: ProjectOperation, project: Project, id: string): Promise<string> => readDocument(operation, project, id, 'text')
export const readProjectDocumentSource = (operation: ProjectOperation, project: Project, id: string): Promise<string> => readDocument(operation, project, id, 'source')

/** Read adapters are scoped to this callback; they never expose a write token.
 * Every existing reader uses this connection, not the bootstrapping getDB. */
export async function withReadOnlyProjectLibrary<T>(scope: LocalReadScope, read: (reader: {
  get(id: string): Promise<ProjectSummary | null>
  source(project: Project, id: string): Promise<string>
  text(project: Project, id: string): Promise<string>
}) => Promise<T>): Promise<T> {
  scope.assertCurrent()
  const { name, version } = getDocumentStorageLayout().projects
  const db = await openExistingDB(name, version, scope.assertCurrent, scope.signal)
  if (!db) throw new ProjectError('unavailable')
  let closed = false
  const assertCurrent = () => { if (closed) throw new ProjectError('cancelled'); scope.assertCurrent() }
  const operation: ProjectOperation = { owner: scope.owner, epoch: scope.epoch, fence: scope.fence, assertCurrent, [OPERATION]: true }
  readDatabases.set(operation, db)
  try {
    await validateReadFence(db, operation)
    const result = await read({ get: id => getProject(operation, id),
      source: (project, id) => readProjectDocumentSource(operation, project, id),
      text: (project, id) => readProjectDocumentText(operation, project, id) })
    await validateReadFence(db, operation)
    return result
  } finally { closed = true; readDatabases.delete(operation); db.close() }
}

/** Local-only history: W06 sync MUST replace this GC with acknowledgement-aware GC. */
async function pruneTombstones(tx: Transaction, owner: string): Promise<void> {
  const projects = await tx.objectStore('projects').index('owner-state').getAll([owner, 'deleted']) as ProjectRow[]
  const documents = await tx.objectStore('documents').index('owner-state-kind').getAll([owner, 'deleted', 'tombstone']) as DocumentRow[]
  const rows = [...projects.map(row => ({ store: 'projects', row })), ...documents.map(row => ({ store: 'documents', row }))]
    .sort((a, b) => a.row.updatedAt - b.row.updatedAt)
  for (const { store, row } of rows.slice(0, Math.max(0, rows.length - PROJECT_LIMITS.localTombstones))) await tx.objectStore(store).delete(row.key)
}
export async function removeProjectDocument(operation: ProjectOperation, project: Project, documentId: string): Promise<Project> {
  const current = await requireProject(operation, project.id, project.revision)
  const descriptor = current.documents.find(d => d.id === documentId)
  if (!descriptor) throw new ProjectError('deleted')
  const now = Date.now()
  const tombstone: DocumentRow = { key: [operation.owner, current.id, descriptor.id, 'tombstone'], owner: operation.owner,
    projectId: current.id, id: descriptor.id, kind: 'tombstone', state: 'deleted', sourceBytes: 0, textChars: 0, updatedAt: now, cipher: null }
  return writeProject(operation, current.revision, { ...current, documents: current.documents.filter(d => d.id !== documentId), revision: current.revision + 1, updatedAt: now },
    [tombstone], ['source', 'text'].map(kind => [operation.owner, current.id, documentId, kind]),
    { projects: 0, documents: -1, sourceBytes: -descriptor.sourceBytes })
}

/** Also deletes a locked project, without decrypting its catalogue or sources. */
export async function deleteProject(operation: ProjectOperation, id: string, expectedRevision: number): Promise<void> {
  checkOperation(operation)
  if (!validProjectId(id)) throw new ProjectError('corrupt')
  const db = await getDB(); checkOperation(operation)
  const tx = guardDocumentTransaction(db.transaction([...STORES], 'readwrite'))
  try {
    await checkFence(tx, operation)
    const row = await tx.objectStore('projects').get([operation.owner, id]) as ProjectRow | undefined
    if (!row || row.state === 'deleted') throw new ProjectError('deleted')
    if (!validRow(row, operation.owner, id)) throw new ProjectError('corrupt')
    if (row.revision !== expectedRevision) throw new ProjectError('conflict')
    const usage = await readUsage(tx, operation.owner)
    let count = 0, bytes = 0
    let cursor = await tx.objectStore('documents').index('owner-project').openCursor([operation.owner, id])
    while (cursor) {
      checkOperation(operation)
      const doc = cursor.value as DocumentRow
      if (doc.state === 'live' && doc.kind === 'source') {
        if (!boundedInteger(doc.sourceBytes, PROJECT_LIMITS.sourceBytes)) throw new ProjectError('corrupt')
        count++; bytes += doc.sourceBytes
      }
      await cursor.delete(); cursor = await cursor.continue()
    }
    checkOperation(operation)
    await tx.objectStore('projects').put({ ...row, state: 'deleted', revision: row.revision + 1, updatedAt: Date.now(), cipher: null })
    await tx.objectStore('usage').put(updateUsage(usage, { projects: -1, documents: -count, sourceBytes: -bytes }))
    await pruneTombstones(tx, operation.owner); checkOperation(operation)
    await tx.done; checkOperation(operation)
  } catch (error) {
    try { tx.abort() } catch { /* completed */ }
    await tx.done.catch(() => {}); throw error
  }
}

/** Account erasure only: caller has removed the captured owner from known sessions
 * BEFORE this call, so old windows cannot start fresh project operations either.
 */
export async function purgeProjectsForAccount(owner: string, assertCurrent: () => void): Promise<void> {
  assertCurrent()
  if (!owner || getKnownSessions().some(session => session.userId === owner)) throw new ProjectError('unavailable')
  const db = await getDB(); assertCurrent()
  // Sync half first: a crash before the IDB commit fails closed until erasure
  // is retried. Never silently repair this mismatch by adopting a new lease.
  const fence = generateId()
  const tx = guardDocumentTransaction(db.transaction([...STORES], 'readwrite'))
  try {
    await tx.objectStore('meta').put(fence, 'erasure-fence')
    // Serialized by the same IDB writer: two successful erasures cannot leave
    // LS and IDB with different final fences by reversing their commit order.
    assertDocumentWorkspace(); localStorage.setItem(PROJECT_ERASURE_FENCE_KEY, fence)
    for (const name of ['projects', 'documents'] as const) {
      let cursor = await tx.objectStore(name).index('owner').openKeyCursor(owner)
      while (cursor) {
        assertCurrent()
        await tx.objectStore(name).delete(cursor.primaryKey)
        cursor = await cursor.continue()
      }
    }
    await tx.objectStore('usage').delete(owner); assertCurrent()
    await tx.done; assertCurrent()
  } catch (error) {
    try { tx.abort() } catch { /* completed */ }
    await tx.done.catch(() => {}); throw error
  }
}

export interface ProjectErasure {
  readonly owner: string; readonly nonce: string; readonly operationId: string; readonly serverConfirmed: boolean
  readonly remote?: RemoteErasureIntent; readonly localOnly?: true
}
type ErasureRecord = ProjectErasure & { pending: string[] }
function validErasureRecord(v: unknown, owner: string): v is ErasureRecord {
  return parseAccountErasureRecord(v)?.owner === owner
}
export type ProjectErasureState = 'none' | 'not-sent' | 'uncertain' | 'confirmed' | 'local-only' | 'legacy-unknown'
/** Settings inspection never creates a database or starts network work. */
export async function readProjectErasureState(owner: string, guard: () => void): Promise<ProjectErasureState> {
  const check = () => { assertDocumentWorkspace(); guard() }
  check()
  const { name, version } = getDocumentStorageLayout().projects
  const db = await openExistingDB(name, version, check)
  if (!db) return 'none'
  try {
    const raw: unknown = await db.get('meta', ['erasing', owner]); check()
    if (raw === undefined) return 'none'
    if (!validErasureRecord(raw, owner)) throw new ProjectError('unavailable')
    return raw.serverConfirmed ? 'confirmed' : raw.localOnly ? 'local-only' : raw.remote?.state ?? 'legacy-unknown'
  } finally { db.close() }
}
/** Durable only while erasure is in progress. Explicit retry takes over a
 * crashed erasure; success removes this identity-bearing marker completely. */
export async function beginProjectErasure(owner: string, assertCurrent: () => void, localOnly = false, remote?: RemoteErasureIntent): Promise<ProjectErasure> {
  assertCurrent()
  const db = await getDB(); assertCurrent()
  const nonce = generateId()
  const tx = guardDocumentTransaction(db.transaction('meta', 'readwrite'))
  const previous = await tx.store.get(['erasing', owner]) as ErasureRecord | undefined
  if ((previous !== undefined && !validErasureRecord(previous, owner)) ||
    (remote && !parseRemoteErasure(remote)) || (previous && !localOnly && !previous.serverConfirmed && !previous.remote &&
      (remote || previous.pending.length >= 32))) {
    tx.abort(); await tx.done.catch(() => {}); throw new ProjectError('unavailable')
  }
  const intent = previous?.remote ?? (previous ? undefined : remote)
  const lease: ProjectErasure = { owner, nonce, operationId: previous?.operationId ?? generateId(), serverConfirmed: previous?.serverConfirmed === true,
    ...(intent ? { remote: intent } : {}), ...((localOnly || previous?.localOnly) ? { localOnly: true as const } : {}) }
  // Remote v1 confirmation binds op/capability/subject, not a growing list of
  // verification nonces. Legacy callers retain their original bounded ledger.
  const pending = lease.serverConfirmed || intent ? [] : localOnly ? (previous?.pending ?? []) : [...(previous?.pending ?? []), nonce]
  try {
    assertCurrent(); await tx.store.put({ ...lease, pending }, ['erasing', owner]); await tx.done; assertCurrent()
    return lease
  } catch (error) {
    try { tx.abort() } catch { /* may have committed before the last guard */ }
    await tx.done.catch(() => {})
    // No caller received this nonce, therefore no server request can own it.
    await releaseFailedProjectErasure(lease).catch(() => {})
    throw error
  }
}
export async function assertProjectErasure(lease: ProjectErasure, assertCurrent: () => void): Promise<void> {
  assertCurrent()
  if ((await (await getDB()).get('meta', ['erasing', lease.owner]))?.nonce !== lease.nonce) throw new ProjectError('cancelled')
  assertCurrent()
}
export async function finishProjectErasure(lease: ProjectErasure): Promise<void> {
  const db = await getDB(), tx = guardDocumentTransaction(db.transaction('meta', 'readwrite'))
  if ((await tx.store.get(['erasing', lease.owner]))?.nonce !== lease.nonce) { tx.abort(); await tx.done.catch(() => {}); throw new ProjectError('cancelled') }
  await tx.store.delete(['erasing', lease.owner])
  await tx.done
}
/** Called only after a successful authenticated server response. Durable receipt
 * lets email sessions resume local erasure after their server token is revoked. */
export async function confirmServerProjectErasure(lease: ProjectErasure): Promise<void> {
  const db = await getDB(), tx = guardDocumentTransaction(db.transaction('meta', 'readwrite'))
  const current = await tx.store.get(['erasing', lease.owner]) as ErasureRecord | undefined
  // A second window may take over local cleanup, but must not lose the first
  // window's authenticated success for this SAME erasure operation.
  const bound = lease.remote ? current?.remote?.state === 'uncertain' && current.remote.capability === lease.remote.capability && current.remote.subjectHash === lease.remote.subjectHash : current?.pending.includes(lease.nonce)
  if (!current || current.operationId !== lease.operationId || (!current.serverConfirmed && !bound)) { tx.abort(); await tx.done.catch(() => {}); throw new ProjectError('cancelled') }
  // Only a validated wire response reaches here for v1. Atomically replace it
  // with the historical EXACT confirmed format; do not strip fields on reads.
  await tx.store.put({ owner: current.owner, operationId: current.operationId, nonce: current.nonce,
    serverConfirmed: true, pending: lease.remote ? [] : current.pending }, ['erasing', lease.owner]); await tx.done
}
/** Claim the one permitted POST before fetch. Any outcome after this commit is
 * uncertain until a validated receipt. A concurrent claimant may only GET. */
export async function markProjectErasureSent(lease: ProjectErasure, guard: () => void): Promise<boolean> {
  guard()
  const db = await getDB(), tx = guardDocumentTransaction(db.transaction('meta', 'readwrite'))
  try {
    const raw: unknown = await tx.store.get(['erasing', lease.owner])
    if (!validErasureRecord(raw, lease.owner) || raw.operationId !== lease.operationId || !raw.remote ||
      raw.remote.capability !== lease.remote?.capability || raw.remote.subjectHash !== lease.remote.subjectHash || raw.localOnly) throw new ProjectError('cancelled')
    const send = raw.remote.state === 'not-sent'
    guard()
    if (send) await tx.store.put({ ...raw, remote: { ...raw.remote, state: 'uncertain' } }, ['erasing', lease.owner])
    await tx.done; guard(); return send
  } catch (error) { try { tx.abort() } catch { /* committed */ }; await tx.done.catch(() => {}); throw error }
}
export async function releaseFailedProjectErasure(lease: ProjectErasure): Promise<void> {
  const db = await getDB(), tx = guardDocumentTransaction(db.transaction('meta', 'readwrite'))
  const current = await tx.store.get(['erasing', lease.owner]) as ErasureRecord | undefined
  if (current?.operationId === lease.operationId) {
    const pending = current.pending.filter(nonce => nonce !== lease.nonce)
    if (!current.serverConfirmed && !current.localOnly && current.remote?.state !== 'uncertain' && pending.length === 0) await tx.store.delete(['erasing', lease.owner])
    else await tx.store.put({ ...current, pending }, ['erasing', lease.owner])
  }
  await tx.done
}
