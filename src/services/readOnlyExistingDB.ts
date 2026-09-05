import { openDB, type IDBPDatabase } from 'idb'

/** Never bootstrap a missing database during an export/read. Aborting the
 * initial versionchange rolls creation back. All other failures remain errors.
 * The caller owns and must close a successful connection. */
export async function openExistingDB(name: string, version: number | undefined, assertCurrent: () => void, signal?: AbortSignal, onClosed?: () => void): Promise<IDBPDatabase | null> {
  assertCurrent()
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  let absent = false, retired = false
  let rejectStop!: (error: Error) => void
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject })
  const stop = () => { retired = true; rejectStop(new DOMException('Read cancelled', 'AbortError')) }
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const opening = openDB(name, version, {
      upgrade(_db, oldVersion, _newVersion, transaction) {
        absent = oldVersion === 0
        // idb exposes the upgrade transaction's separate completion promise.
        // Its intentional abort must be consumed as well as the open request.
        void transaction.done.catch(() => {})
        transaction.abort()
      },
      blocked() { retired = true; rejectStop(new DOMException('Database opening blocked', 'InvalidStateError')) },
      blocking() { void opening.then(db => db.close(), () => {}); onClosed?.() },
      terminated() { onClosed?.() },
    })
    const admitted = opening.then(db => {
      try { assertCurrent(); if (retired) throw new DOMException('Read cancelled', 'AbortError'); return db }
      catch (error) { db.close(); throw error }
    }, error => {
      assertCurrent()
      if (!retired && absent && error instanceof DOMException && error.name === 'AbortError') return null
      throw error
    })
    // Race installs handlers on the late result as well: a cancelled open closes
    // on eventual success, without an unhandled rejection or forced takeover.
    return await Promise.race([admitted, stopped])
  } finally { signal?.removeEventListener('abort', stop) }
}
