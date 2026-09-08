/** Personal facts on this device. No network or server-side memory database.
 * Existing plaintext lists can be read; every new write is awaited ciphertext.
 * The document workspace lock serializes cooperating current clients, not old
 * bundles. Raw-byte checks below detect interference; they are not a Web CAS.
 */
import * as scoped from './scopedStorage'
import { decrypt, encrypt, selfTestCrypto } from './crypto'
import { captureLocalReadScope } from './projects/store'
import { onLocalDataInvalidated } from './localDataInvalidation'
import { documentWorkspaceSignal, documentStorageKey } from './workspaceWriter/runtime'
import { waitForLocalMemory } from './localMemoryWait'

const STORAGE_KEY = 'local-memory-facts'
export const MAX_FACTS = 80
export interface LocalMemoryFact { id: string; content: string; createdAt: number }
export interface LocalMemorySnapshot {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  facts: readonly Readonly<LocalMemoryFact>[]
}
const IDLE: LocalMemorySnapshot = Object.freeze({ status: 'idle', facts: Object.freeze([]) })
const LOADING: LocalMemorySnapshot = Object.freeze({ status: 'loading', facts: Object.freeze([]) })
const UNAVAILABLE: LocalMemorySnapshot = Object.freeze({ status: 'unavailable', facts: Object.freeze([]) })
const listeners = new Set<() => void>()
type Scope = ReturnType<typeof captureLocalReadScope>
type Entry = { scope: Scope; raw: string | null | undefined; snapshot: LocalMemorySnapshot; tail: Promise<unknown>; hydration: Promise<void> | null }
let cache: Entry | null = null
export class LocalMemoryUnavailable extends Error {
  constructor() { super('local_memory_unavailable'); this.name = 'LocalMemoryUnavailable' }
}
function notify(): void {
  for (const listener of [...listeners]) { try { listener() } catch { /* isolate observers */ } }
}
export function subscribeLocalMemory(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener) }
}
export function resetLocalMemoryCache(): void { cache = null; notify() }
onLocalDataInvalidated(resetLocalMemoryCache)
documentWorkspaceSignal.addEventListener('abort', resetLocalMemoryCache)
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  const entry = cache
  try {
    if (entry && (event.key === null || event.key === documentStorageKey(entry.scope.owner, STORAGE_KEY))) resetLocalMemoryCache()
  } catch { resetLocalMemoryCache() }
})
function assertEntry(entry: Entry): void {
  entry.scope.assertCurrent()
  if (cache !== entry) throw new LocalMemoryUnavailable()
}
function getEntry(): Entry {
  if (cache) { try { assertEntry(cache); return cache } catch { cache = null } }
  // Capture BEFORE entering a queue. An A command must not acquire B's scope
  // when an earlier A encryption finally finishes.
  const scope = captureLocalReadScope()
  return cache = { scope, raw: undefined, snapshot: IDLE, tail: Promise.resolve(), hydration: null }
}
export function getLocalMemorySnapshot(): LocalMemorySnapshot {
  const entry = cache
  if (!entry) return IDLE
  try {
    assertEntry(entry)
    if (entry.snapshot.status === 'ready' && scoped.getItem(STORAGE_KEY) !== entry.raw) return IDLE
    return entry.snapshot
  } catch { return UNAVAILABLE }
}
/** Detached reads only. An empty read while not ready never authorizes a write. */
export function getAll(): LocalMemoryFact[] { return structuredClone(getLocalMemorySnapshot().facts) as LocalMemoryFact[] }
function decodeFacts(value: unknown): LocalMemoryFact[] {
  if (!Array.isArray(value)) throw new LocalMemoryUnavailable()
  const ids = new Set<string>()
  for (const fact of value) {
    if (!fact || typeof fact !== 'object' || typeof fact.id !== 'string' || !fact.id || ids.has(fact.id) ||
      typeof fact.content !== 'string' || !Number.isFinite(fact.createdAt)) throw new LocalMemoryUnavailable()
    ids.add(fact.id)
  }
  // Do not truncate historical manual content or discard unknown fact fields.
  return structuredClone(value)
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeDeep(child); Object.freeze(value) }
  return value
}
function ready(entry: Entry, raw: string | null, facts: LocalMemoryFact[]): void {
  entry.raw = raw
  entry.snapshot = freezeDeep({ status: 'ready', facts: structuredClone(facts) })
}
function queue<T>(entry: Entry, run: () => Promise<T>): Promise<T> {
  const result = entry.tail.then(run)
  entry.tail = result.catch(() => {}) // a failed write must not poison retries
  return result
}
function hydrate(entry: Entry): Promise<void> {
  if (entry.hydration) return entry.hydration
  const task = readHydration(entry)
  entry.hydration = task
  void task.finally(() => { if (entry.hydration === task) entry.hydration = null }).catch(() => {})
  return task
}
async function readHydration(entry: Entry): Promise<void> {
  assertEntry(entry)
  const raw = scoped.getItem(STORAGE_KEY)
  await entry.scope.validateReadOnly(); assertEntry(entry)
  if (entry.snapshot.status === 'ready' && scoped.getItem(STORAGE_KEY) === entry.raw) return
  entry.snapshot = LOADING; notify(); assertEntry(entry)
  try {
    // Ready crypto is only a candidate; a wrong key must not encrypt an empty
    // new slot and claim success while the owner's historical key is locked.
    if (!await selfTestCrypto()) throw new LocalMemoryUnavailable()
    assertEntry(entry)
    let facts: LocalMemoryFact[] = []
    if (raw !== null) {
      let value: unknown
      try { value = JSON.parse(raw) } catch { value = JSON.parse(await decrypt(raw)) }
      assertEntry(entry); facts = decodeFacts(value)
    }
    await entry.scope.validateReadOnly(); assertEntry(entry)
    if (scoped.getItem(STORAGE_KEY) !== raw) throw new LocalMemoryUnavailable()
    ready(entry, raw, facts); notify(); assertEntry(entry)
  } catch (error) {
    if (cache === entry) { entry.snapshot = UNAVAILABLE; notify() }
    throw error
  }
}
/** Explicit hydration used at auth, before sending context, and by the UI. */
export async function bootstrapLocalMemory(signal?: AbortSignal): Promise<void> {
  const entry = getEntry()
  // A pending mutation does not make the last DURABLE snapshot unavailable.
  // Share reads, not the mutation queue; raw checks reject stale publication.
  try { await waitForLocalMemory(hydrate(entry), signal) }
  catch (error) {
    if (cache === entry && entry.snapshot.status === 'loading') { entry.snapshot = UNAVAILABLE; notify() }
    throw error
  }
}
/** One logical edit = one durable list write, including eviction + addition.
 * Callback is synchronous on a detached draft. Resolution means persistence,
 * never just an optimistic RAM edit. Callers may add a stricter grant/UI guard.
 */
export async function mutateLocalMemory<T>(edit: (draft: LocalMemoryFact[]) => T, assertCurrent: () => void = () => {}): Promise<T> {
  const entry = getEntry(); assertCurrent()
  return queue(entry, async () => {
    assertEntry(entry); assertCurrent()
    await hydrate(entry); assertEntry(entry); assertCurrent()
    const raw = entry.raw, before = JSON.stringify(entry.snapshot.facts)
    const draft = structuredClone(entry.snapshot.facts) as LocalMemoryFact[]
    const result = edit(draft)
    assertEntry(entry); assertCurrent()
    const facts = decodeFacts(draft), next = JSON.stringify(facts)
    if (next === before) return result
    const cipher = await encrypt(next)
    assertEntry(entry); assertCurrent()
    await entry.scope.validateReadOnly(); assertEntry(entry); assertCurrent()
    if (scoped.getItem(STORAGE_KEY) !== raw) throw new LocalMemoryUnavailable()
    // No await between the final scope/source checks and this single write.
    // A quota failure leaves the previous bytes and ready cache untouched.
    scoped.setItem(STORAGE_KEY, cipher)
    if (scoped.getItem(STORAGE_KEY) !== cipher) throw new LocalMemoryUnavailable()
    ready(entry, cipher, facts); notify()
    // No event detail with mutable/private data. Subscribers reread their scope.
    assertEntry(entry); assertCurrent()
    window.dispatchEvent(new Event('arty-local-memory-updated'))
    assertEntry(entry); assertCurrent()
    return result
  })
}
export function createLocalMemoryFact(content: string): LocalMemoryFact {
  return { id: `lm-${crypto.randomUUID()}`, content: content.trim(), createdAt: Date.now() }
}
export async function addFact(content: string, assertCurrent?: () => void): Promise<LocalMemoryFact | null> {
  return mutateLocalMemory(all => {
    if (!content.trim() || all.length >= MAX_FACTS) return null
    const fact = createLocalMemoryFact(content); all.push(fact); return { ...fact }
  }, assertCurrent)
}
export async function updateFact(id: string, content: string, assertCurrent?: () => void): Promise<boolean> {
  return mutateLocalMemory(all => {
    const fact = all.find(f => f.id === id)
    if (!fact || !content.trim()) return false
    fact.content = content.trim(); return true
  }, assertCurrent)
}
export async function deleteFact(id: string, assertCurrent?: () => void): Promise<boolean> {
  return mutateLocalMemory(all => { const index = all.findIndex(f => f.id === id); if (index < 0) return false; all.splice(index, 1); return true }, assertCurrent)
}
export async function clearLocalMemory(assertCurrent?: () => void): Promise<void> { await mutateLocalMemory(all => { all.splice(0) }, assertCurrent) }
/** Synchronous by contract: callers hydrate before the prompt-rebuild event. */
export function buildLocalMemoryPrompt(): string {
  const facts = getAll()
  if (!facts.length) return ''
  return `Faits mémorisés sur l'utilisateur (retenus localement, à utiliser pour personnaliser les réponses sans les divulguer tels quels) :\n${facts.map(f => `- ${f.content}`).join('\n')}\n\n`
}
