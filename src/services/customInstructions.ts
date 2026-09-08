/** Personal instructions, stored locally in the existing encrypted slot.
 * Hydrate before synchronous prompt reads. Absence is not a decryption error.
 * Every edit is an awaited ciphertext write, never a plaintext intermediate.
 */
import * as scoped from './scopedStorage'
import { decrypt, encrypt, selfTestCrypto } from './crypto'
import { captureLocalReadScope } from './projects/store'
import { onLocalDataInvalidated } from './localDataInvalidation'
import { documentWorkspaceSignal, documentStorageKey } from './workspaceWriter/runtime'
import { waitForLocalMemory } from './localMemoryWait'

const STORAGE_KEY = 'custom-instructions'
export const MAX_CUSTOM_INSTRUCTIONS_CHARS = 500
export interface CustomInstructionsSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'
  readonly value: string
}
const IDLE: CustomInstructionsSnapshot = Object.freeze({ status: 'idle', value: '' })
const LOADING: CustomInstructionsSnapshot = Object.freeze({ status: 'loading', value: '' })
const UNAVAILABLE: CustomInstructionsSnapshot = Object.freeze({ status: 'unavailable', value: '' })
type Entry = {
  scope: ReturnType<typeof captureLocalReadScope>
  raw: string | null | undefined
  snapshot: CustomInstructionsSnapshot
  tail: Promise<unknown>
  hydration: Promise<void> | null
  writeEpoch: number
  needsRead: boolean
}
let cache: Entry | null = null
const listeners = new Set<() => void>()
export class CustomInstructionsUnavailable extends Error {
  constructor() { super('custom_instructions_unavailable'); this.name = 'CustomInstructionsUnavailable' }
}
function notify(): void {
  for (const listener of [...listeners]) { try { listener() } catch { /* isolate observers */ } }
}
export function subscribeCustomInstructions(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener) }
}
export function resetCustomInstructionsCache(): void { cache = null; notify() }
onLocalDataInvalidated(resetCustomInstructionsCache)
documentWorkspaceSignal.addEventListener('abort', resetCustomInstructionsCache)
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  const entry = cache
  try {
    if (entry && (event.key === null || event.key === documentStorageKey(entry.scope.owner, STORAGE_KEY))) resetCustomInstructionsCache()
  } catch { resetCustomInstructionsCache() }
})
function assertEntry(entry: Entry): void {
  entry.scope.assertCurrent()
  if (cache !== entry) throw new CustomInstructionsUnavailable()
}
function getEntry(): Entry {
  if (cache) { try { assertEntry(cache); return cache } catch { cache = null } }
  const scope = captureLocalReadScope() // capture before entering any queue
  return cache = { scope, raw: undefined, snapshot: IDLE, tail: Promise.resolve(), hydration: null, writeEpoch: 0, needsRead: false }
}
export function getCustomInstructionsSnapshot(): CustomInstructionsSnapshot {
  if (!cache) return IDLE
  try {
    assertEntry(cache)
    if (cache.snapshot.status === 'ready' && scoped.getItem(STORAGE_KEY) !== cache.raw) return IDLE
    return cache.snapshot
  } catch { return UNAVAILABLE }
}
/** Empty here never grants permission to overwrite unreadable stored data. */
export function getCustomInstructions(): string { return getCustomInstructionsSnapshot().value }
function ready(entry: Entry, raw: string | null, value: string): void {
  entry.raw = raw; entry.snapshot = Object.freeze({ status: 'ready', value })
}
async function readHydration(entry: Entry): Promise<void> {
  try {
    assertEntry(entry)
    const raw = scoped.getItem(STORAGE_KEY)
    await entry.scope.validateReadOnly(); assertEntry(entry)
    if (entry.snapshot.status === 'ready' && scoped.getItem(STORAGE_KEY) === entry.raw) return
    entry.snapshot = LOADING; notify(); assertEntry(entry)
    if (!await selfTestCrypto()) throw new CustomInstructionsUnavailable()
    assertEntry(entry)
    let value: unknown = ''
    if (raw !== null) {
      try { value = JSON.parse(raw) } catch { value = JSON.parse(await decrypt(raw)) }
    }
    assertEntry(entry)
    if (typeof value !== 'string') throw new CustomInstructionsUnavailable()
    // Preserve historical text exactly; the edit cap is not a read-time purge.
    await entry.scope.validateReadOnly(); assertEntry(entry)
    if (scoped.getItem(STORAGE_KEY) !== raw) throw new CustomInstructionsUnavailable()
    ready(entry, raw, value); notify(); assertEntry(entry)
  } catch (error) {
    if (cache === entry) { entry.snapshot = UNAVAILABLE; notify() }
    throw error
  }
}
function hydrate(entry: Entry): Promise<void> {
  if (entry.hydration) return entry.hydration
  const task = readHydration(entry)
  entry.hydration = task
  void task.finally(() => { if (entry.hydration === task) entry.hydration = null }).catch(() => {})
  return task
}
export async function bootstrapCustomInstructions(signal?: AbortSignal): Promise<void> {
  const entry = getEntry(), writeEpoch = entry.writeEpoch
  // Reuse the bounded local-context wait; do not wait on pending edits.
  try {
    await waitForLocalMemory(hydrate(entry), signal); assertEntry(entry)
    if (entry.writeEpoch !== writeEpoch || getCustomInstructionsSnapshot().status !== 'ready') throw new CustomInstructionsUnavailable()
    entry.needsRead = false
  }
  catch (error) {
    if (cache === entry && entry.snapshot.status === 'loading') { entry.snapshot = UNAVAILABLE; notify() }
    throw error
  }
}
/** UI supplies its exact loaded snapshot and owner guard: a stale whole-text
 * editor must not overwrite a newer edit, even within the same account.
 * The document lock serializes current clients; raw checks are not a Web CAS.
 */
export async function setCustomInstructions(value: string, assertCurrent: () => void = () => {}, base?: CustomInstructionsSnapshot): Promise<void> {
  const entry = getEntry(); assertCurrent()
  const next = value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS), writeEpoch = entry.writeEpoch
  const guard = () => {
    assertEntry(entry); assertCurrent()
    if (entry.needsRead || entry.writeEpoch !== writeEpoch) throw new CustomInstructionsUnavailable()
  }
  const task = entry.tail.then(async () => {
    guard(); await hydrate(entry); guard()
    if (base && base !== entry.snapshot) throw new CustomInstructionsUnavailable()
    const raw = entry.raw
    if (entry.snapshot.value === next) return
    const cipher = await encrypt(JSON.stringify(next))
    guard(); await entry.scope.validateReadOnly(); guard()
    if (scoped.getItem(STORAGE_KEY) !== raw) throw new CustomInstructionsUnavailable()
    scoped.setItem(STORAGE_KEY, cipher)
    if (scoped.getItem(STORAGE_KEY) !== cipher) throw new CustomInstructionsUnavailable()
    ready(entry, cipher, next); notify(); guard()
  }).catch(error => {
    // Retire commands already queued before a failure, including lost ACKs.
    // Only an explicit bootstrap can enable a newly requested write again.
    if (cache === entry && entry.writeEpoch === writeEpoch) { entry.needsRead = true; entry.writeEpoch++ }
    throw error
  })
  entry.tail = task.catch(() => {})
  return task
}
