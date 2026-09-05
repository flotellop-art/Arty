import type { IDBPDatabase, IDBPTransaction } from 'idb'

type IndexShape = readonly [name: string, path: string | readonly string[]]
export type StoreShape = readonly [name: string, path: string | null, indexes: readonly IndexShape[]]
export const CONTROL_SHAPE: readonly StoreShape[] = [['meta', null, []]]
export const FILE_SHAPE: readonly StoreShape[] = [['files', 'fileId', [['ownerKey', 'ownerKey']]]]
export const PROJECT_SHAPE: readonly StoreShape[] = [
  ['projects', 'key', [['owner', 'owner'], ['owner-state', ['owner', 'state']]]],
  ['documents', 'key', [['owner', 'owner'], ['owner-project', ['owner', 'projectId']], ['owner-state-kind', ['owner', 'state', 'kind']], ['owner-state-kind-bytes', ['owner', 'state', 'kind', 'sourceBytes']]]],
  ['usage', 'owner', []], ['meta', null, []],
]
export const MIGRATION_JOURNAL_SHAPE: readonly StoreShape[] = [
  ['journal', null, []], ['files', null, []], ['projects', null, []], ['documents', null, []], ['usage', null, []], ['meta', null, []],
]

/** Exact known physical schema, shared by admission and the cold migrator. */
export function assertDatabaseShape(db: IDBPDatabase, shape: readonly StoreShape[], tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite' | 'versionchange'>) {
  if ([...db.objectStoreNames].sort().join() !== shape.map(s => s[0]).sort().join()) throw new Error('workspace_schema_invalid')
  for (const [name, path, indexes] of shape) {
    const store = tx.objectStore(name)
    if (store.keyPath !== path || store.autoIncrement || [...store.indexNames].sort().join() !== indexes.map(i => i[0]).sort().join()) throw new Error('workspace_schema_invalid')
    for (const [indexName, indexPath] of indexes) {
      const index = store.index(indexName)
      if (JSON.stringify(index.keyPath) !== JSON.stringify(indexPath) || index.unique || index.multiEntry) throw new Error('workspace_schema_invalid')
    }
  }
}

export function createDatabaseShape(db: IDBPDatabase, shape: readonly StoreShape[]) {
  for (const [name, keyPath, indexes] of shape) {
    const store = db.createObjectStore(name, keyPath === null ? undefined : { keyPath })
    for (const [index, path] of indexes) store.createIndex(index, typeof path === 'string' ? path : [...path])
  }
}
