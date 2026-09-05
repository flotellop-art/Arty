import type { IDBPDatabase } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { HISTORY_SLOTS, LEGACY_WORKSPACE_LAYOUT, workspaceDataKey, type IsolatedWorkspaceLayout } from './layout'
import { assertDocumentWorkspace, documentWorkspaceSignal, getDocumentStorageLayout } from './runtime'
import { getActiveUserId, getActiveSessionEpoch, getSessionProjectFence, PROJECT_ERASURE_FENCE_KEY } from '../userSession'
import { captureOwnerErasureGuard } from '../projects/localErasureGuard'
import { parseOwnedLocalKey } from './localOwnership'

export class LocalCryptoRecoveryRequired extends Error {
  constructor() {
    super('Le stockage local nécessite une récupération. Les données et les accès existants ont été conservés.')
    this.name = 'LocalCryptoRecoveryRequired'
  }
}
const refuse = (): never => { throw new LocalCryptoRecoveryRequired() }

/** Not exported as a boolean/capability. The proof is consumed by the sole
 * salt write in this same attempt, after a last synchronous scope/fence check.
 * Null/previously inventoried owners require the future migration/recovery
 * protocol; absence alone must not turn them into a new identity. */
export async function provisionIsolatedSalt(layout: IsolatedWorkspaceLayout, owner: string | null,
  guard: { assertCurrent(): void; signal: AbortSignal; fence: string }, timeoutMs = 8_000): Promise<Uint8Array> {
  assertDocumentWorkspace()
  const epoch = getActiveSessionEpoch(), sessionFence = getSessionProjectFence(), assertNotErasing = captureOwnerErasureGuard(owner)
  const retired = new AbortController()
  const assertCurrent = () => {
    assertDocumentWorkspace()
    assertNotErasing()
    if (layout !== getDocumentStorageLayout() || owner !== getActiveUserId() || epoch !== getActiveSessionEpoch() ||
      sessionFence === null || guard.fence !== sessionFence || sessionFence !== (localStorage.getItem(PROJECT_ERASURE_FENCE_KEY) ?? 'initial') ||
      retired.signal.aborted || guard.signal.aborted) refuse()
    guard.assertCurrent()
  }
  const assertEmptyLocal = () => {
    assertCurrent()
    if (!owner || layout.requiredOwners.includes(owner)) refuse()
    // ALL scoped settings, including empty strings and ciphertext with no -enc
    // suffix (reports/memory/instructions). Storage access errors propagate.
    const prefix = `arty-${owner}-`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const parsed = parseOwnedLocalKey(key)
      if (parsed?.owner === owner || (!parsed && key.startsWith(prefix))) refuse()
    }
    for (const slot of [...HISTORY_SLOTS, 'crypto-salt', 'crypto-check', 'crypto-version'] as const) {
      if (localStorage.getItem(workspaceDataKey(layout, owner, slot)) !== null) refuse()
    }
  }
  const cancel = () => retired.abort()
  guard.signal.addEventListener('abort', cancel, { once: true })
  documentWorkspaceSignal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, timeoutMs)
  let rejectStop!: (error: Error) => void
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject })
  const stop = () => rejectStop(new LocalCryptoRecoveryRequired())
  retired.signal.addEventListener('abort', stop, { once: true })
  const inspect = async (family: 'files' | 'projects', legacy = false) => {
    assertCurrent()
    const declared = legacy ? { name: LEGACY_WORKSPACE_LAYOUT[family].name, version: 2 } : layout[family]
    const db = await openExistingDB(declared.name, declared.version, assertCurrent, retired.signal)
    try {
      assertCurrent()
      if (!db) throw new LocalCryptoRecoveryRequired()
      await inspectOwner(db, family, owner!, legacy ? null : guard.fence, assertCurrent, retired.signal)
      assertCurrent()
    } finally { db?.close() }
  }
  try {
    assertEmptyLocal()
    const reading = (async () => {
      // Defence against an incomplete source inventory: a legacy asset alone
      // must not turn into a new isolated key. Legacy fences are historical;
      // their owner erasure records still refuse provisioning, never repair.
      await inspect('files', true); await inspect('projects', true)
      await inspect('files'); await inspect('projects'); assertCurrent()
    })()
    await Promise.race([reading, stopped])
    assertEmptyLocal()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    // No await between the final proof and write. A failed later KDF/commit
    // retains this salt, so a retry can never strand already encrypted bytes.
    localStorage.setItem(workspaceDataKey(layout, owner, 'crypto-salt'), JSON.stringify([...salt]))
    return salt
  } finally {
    clearTimeout(timer)
    guard.signal.removeEventListener('abort', cancel)
    documentWorkspaceSignal.removeEventListener('abort', cancel)
    retired.signal.removeEventListener('abort', stop)
    retired.abort()
  }
}

async function inspectOwner(db: IDBPDatabase, family: 'files' | 'projects', owner: string, fence: string | null,
  assertCurrent: () => void, signal: AbortSignal) {
  const tx = db.transaction(family === 'files' ? ['files'] : ['projects', 'documents', 'usage', 'meta'], 'readonly')
  const abort = () => { try { tx.abort() } catch { /* settled */ } }
  signal.addEventListener('abort', abort, { once: true })
  void tx.done.catch(() => {})
  try {
    assertCurrent()
    if (family === 'files') {
      if (await tx.objectStore('files').index('ownerKey').count(`arty-${owner}`)) refuse()
    } else {
      const [projects, documents, usage, erasing, storedFence] = await Promise.all([
        tx.objectStore('projects').index('owner').count(owner),
        tx.objectStore('documents').index('owner').count(owner),
        tx.objectStore('usage').get(owner), tx.objectStore('meta').get(['erasing', owner]),
        tx.objectStore('meta').get('erasure-fence'),
      ])
      if (projects || documents || usage !== undefined || erasing !== undefined ||
        (fence !== null && (storedFence === undefined ? 'initial' : storedFence) !== fence)) refuse()
    }
    await tx.done; assertCurrent()
  } catch (error) { abort(); await tx.done.catch(() => {}); throw error }
  finally { signal.removeEventListener('abort', abort) }
}
