import type { IDBPObjectStore } from 'idb'
import { assertSyncPair, parseSyncStorageKey, parseSyncStorageRow, type SyncStateRow, type SyncOperationRow, type SyncStorageContext } from './localFormat'
import { envelopeFail } from './envelopeFormat'

/** Key-first bounded inventory. Never getAll() ciphertexts. Keep only small
 * pair identities in RAM, and do not equate an orphan with a fresh owner.
 * Erasure uses individual row ownership instead, so a valid orphan is purged. */
export async function inspectSyncInventory<Names extends string[], Name extends Names[number], Mode extends 'readonly' | 'readwrite'>(store: IDBPObjectStore<unknown, Names, Name, Mode>,
  context: SyncStorageContext | undefined, assertCurrent: () => void, requirePairs = true) {
  const pairs = new Map<string, { state: Omit<SyncStateRow, 'ciphertext'> | null; operation: Omit<SyncOperationRow, 'ciphertext'> | null }>()
  let cursor = await store.openKeyCursor(), count = 0
  while (cursor) {
    assertCurrent()
    if (++count > 20_001) envelopeFail('limit')
    const key = parseSyncStorageKey(cursor.key)
    if (key) {
      const row = parseSyncStorageRow(cursor.key, await store.get(cursor.key), context)
      const pair = pairs.get(key.owner) ?? { state: null, operation: null }
      const { ciphertext: _ciphertext, ...identity } = row
      if (identity.format === 'arty-sync-local-state') {
        if (pair.state) envelopeFail('format')
        pair.state = identity
      } else {
        if (pair.operation) envelopeFail('format')
        pair.operation = identity
      }
      pairs.set(key.owner, pair)
    } else if (context && cursor.key !== 'erasure-fence' &&
      !(Array.isArray(cursor.key) && cursor.key.length === 2 && cursor.key[0] === 'erasing')) envelopeFail('format')
    cursor = await cursor.continue()
  }
  if (requirePairs) for (const pair of pairs.values()) assertSyncPair(pair.state, pair.operation)
  assertCurrent()
  return pairs
}
