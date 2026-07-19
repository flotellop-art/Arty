import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { isTrailGeometry, type TrailGeometry, type TrailSummary } from './trailsClient'
import { getActiveUserId } from './userSession'

// Snapshot local canonique d'un résultat de recherche de sentier.
//
// L'identifiant opaque est le seul élément placé dans le HTML produit par le
// modèle et dans l'URL /trail/:trailId. La relation OSM, le contexte local et
// la géométrie restent dans IndexedDB sur l'appareil. Une référence inventée
// par le LLM ne résout donc vers aucune donnée et ne peut pas charger une
// relation arbitraire.

export const TRAIL_SNAPSHOT_VERSION = 3
const DB_NAME = 'arty-trails'
const DB_VERSION = 3
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const GEOMETRY_REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_SNAPSHOTS_PER_OWNER = 60

export interface TrailSnapshot {
  id: string
  version: typeof TRAIL_SNAPSHOT_VERSION
  ownerId: string
  routeId: number
  name: string
  kind: string
  network: string | null
  distanceInAreaKm: number
  radiusKm: number
  /** Centre volontairement arrondi (~110 m), uniquement pour cadrer le
   * tronçon local d'une longue relation sans conserver l'adresse exacte. */
  nearbyCenter?: { lat: number; lon: number }
  createdAt: number
  geometry?: TrailGeometry
}

interface TrailDb extends DBSchema {
  snapshots: {
    key: string
    value: TrailSnapshot
    indexes: { 'by-created-at': number; 'by-route-id': number }
  }
}

let dbPromise: Promise<IDBPDatabase<TrailDb> | null> | null = null
const memoryFallback = new Map<string, TrailSnapshot>()

function currentOwnerId(): string {
  return getActiveUserId() ?? 'device-local'
}

function createOpaqueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    // Anciens WebView uniquement. L'id n'est pas un secret d'authentification :
    // son opacité sert à empêcher le modèle de fabriquer un id OSM arbitraire.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function trailDb(): Promise<IDBPDatabase<TrailDb> | null> {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    dbPromise = openDB<TrailDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('snapshots', { keyPath: 'id' })
          store.createIndex('by-created-at', 'createdAt')
          store.createIndex('by-route-id', 'routeId')
        } else if (oldVersion < 3) {
          const store = transaction.objectStore('snapshots')
          // Les versions précédentes n'avaient pas les verrous de direction
          // OSM nécessaires à un export fiable : invalider plutôt qu'inverser
          // silencieusement un membre forward/backward.
          store.clear()
          if (oldVersion < 2) store.createIndex('by-route-id', 'routeId')
        }
      },
    }).catch(() => null)
  }
  return dbPromise
}

async function putSnapshot(snapshot: TrailSnapshot): Promise<void> {
  memoryFallback.set(snapshot.id, snapshot)
  const db = await trailDb()
  if (db) {
    try { await db.put('snapshots', snapshot) } catch { /* copie mémoire conservée */ }
  }
}

async function cleanupExpired(now: number): Promise<void> {
  const threshold = now - MAX_AGE_MS
  for (const [id, snapshot] of memoryFallback) {
    if (snapshot.createdAt < threshold) memoryFallback.delete(id)
  }
  const db = await trailDb()
  if (!db) return
  try {
    const tx = db.transaction('snapshots', 'readwrite')
    let cursor = await tx.store.index('by-created-at').openCursor(IDBKeyRange.upperBound(threshold, true))
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  } catch { /* le caller décidera si une écriture durable reste possible */ }
}

export async function createTrailSnapshotRefs(
  entries: Array<{ route: TrailSummary; geometry: TrailGeometry }>,
  context: { radiusKm: number; center?: { lat: number; lon: number } }
): Promise<{ refs: Array<{ route: TrailSummary; trailId: string }>; persistent: boolean }> {
  const now = Date.now()
  await cleanupExpired(now)
  const ownerId = currentOwnerId()
  const snapshots = entries.map(({ route, geometry }): TrailSnapshot => ({
      id: createOpaqueId(),
      version: TRAIL_SNAPSHOT_VERSION,
      ownerId,
      routeId: route.id,
      name: route.name,
      kind: route.kind,
      network: route.network,
      distanceInAreaKm: route.distanceKm,
      radiusKm: context.radiusKm,
      nearbyCenter: context.center ? {
        lat: Number(context.center.lat.toFixed(3)),
        lon: Number(context.center.lon.toFixed(3)),
      } : undefined,
      createdAt: now,
      geometry,
  }))

  // Une seule transaction : aucun bouton ne doit pointer vers un snapshot
  // partiellement écrit. Le fallback mémoire reste utile pendant la session,
  // mais il est signalé comme non persistant au caller.
  const db = await trailDb()
  let persistent = false
  if (db) {
    try {
      const tx = db.transaction('snapshots', 'readwrite')
      for (const snapshot of snapshots) await tx.store.put(snapshot)
      const owned = (await tx.store.getAll())
        .filter((snapshot) => snapshot.ownerId === ownerId)
        .sort((a, b) => b.createdAt - a.createdAt)
      for (const stale of owned.slice(MAX_SNAPSHOTS_PER_OWNER)) await tx.store.delete(stale.id)
      await tx.done
      persistent = true
    } catch { /* quota/IndexedDB indisponible → fallback mémoire explicite */ }
  }
  for (const snapshot of snapshots) memoryFallback.set(snapshot.id, snapshot)
  const memoryOwned = [...memoryFallback.values()]
    .filter((snapshot) => snapshot.ownerId === ownerId)
    .sort((a, b) => b.createdAt - a.createdAt)
  for (const stale of memoryOwned.slice(MAX_SNAPSHOTS_PER_OWNER)) memoryFallback.delete(stale.id)
  const refs = snapshots.map((snapshot, index) => ({ route: entries[index]!.route, trailId: snapshot.id }))
  return { refs, persistent }
}

export async function getTrailSnapshot(id: string): Promise<TrailSnapshot | null> {
  const memory = memoryFallback.get(id)
  if (memory) return memory.ownerId === currentOwnerId() ? memory : null
  const db = await trailDb()
  let snapshot: TrailSnapshot | undefined
  try { snapshot = db ? await db.get('snapshots', id) : undefined } catch { return null }
  if (!snapshot || snapshot.version !== TRAIL_SNAPSHOT_VERSION || snapshot.ownerId !== currentOwnerId()) return null
  if (snapshot.createdAt < Date.now() - MAX_AGE_MS) {
    await db?.delete('snapshots', id)
    return null
  }
  memoryFallback.set(id, snapshot)
  return snapshot
}

/** Réutilise une géométrie déjà vérifiée par le même compte, sans nouvel
 * appel Overpass. Les snapshots d'un autre compte de l'appareil sont ignorés. */
export async function getCachedTrailGeometry(routeId: number): Promise<TrailGeometry | null> {
  const ownerId = currentOwnerId()
  // Un ancien bouton reste ouvrable 30 jours, mais une nouvelle recherche ne
  // réemploie une géométrie que 24 h afin de refléter les corrections OSM.
  const threshold = Date.now() - GEOMETRY_REUSE_MAX_AGE_MS
  for (const snapshot of memoryFallback.values()) {
    if (snapshot.ownerId === ownerId && snapshot.routeId === routeId && snapshot.geometry &&
      isTrailGeometry(snapshot.geometry) && snapshot.geometry.provenance.fetchedAt >= threshold) {
      return snapshot.geometry
    }
  }
  const db = await trailDb()
  let snapshots: TrailSnapshot[] = []
  try { snapshots = db ? await db.getAllFromIndex('snapshots', 'by-route-id', routeId) : [] } catch { return null }
  const match = snapshots.find((snapshot) =>
    snapshot.version === TRAIL_SNAPSHOT_VERSION && snapshot.ownerId === ownerId &&
    !!snapshot.geometry && isTrailGeometry(snapshot.geometry) && snapshot.geometry.provenance.fetchedAt >= threshold
  )
  if (match) {
    memoryFallback.set(match.id, match)
    return match.geometry ?? null
  }
  return null
}

export async function saveTrailGeometry(id: string, geometry: TrailGeometry): Promise<TrailSnapshot | null> {
  const snapshot = await getTrailSnapshot(id)
  if (!snapshot || snapshot.routeId !== geometry.id || !isTrailGeometry(geometry)) return null
  const next: TrailSnapshot = { ...snapshot, geometry }
  await putSnapshot(next)
  return next
}
