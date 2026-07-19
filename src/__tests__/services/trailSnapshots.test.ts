// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ ownerId: 'account-a' }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => session.ownerId }))
import { createTrailSnapshotRefs, getCachedTrailGeometry, getTrailSnapshot, saveTrailGeometry } from '../../services/trailSnapshots'
import type { TrailGeometry, TrailSummary } from '../../services/trailsClient'

const route: TrailSummary = {
  id: 42,
  name: 'Boucle test',
  kind: 'horse',
  network: 'lwn',
  longDistance: false,
  distanceKm: 3.2,
  colour: null,
  symbol: null,
  website: null,
  note: null,
}

const geometry: TrailGeometry = {
  id: 42,
  name: 'Boucle test',
  kind: 'horse',
  distanceKm: 8.4,
  distanceMeters: 8400,
  sourceSegments: [[[45.3, 5.2], [45.31, 5.21]]],
  sourceSegmentDirectionLocked: [false],
  displaySegments: [[[45.3, 5.2], [45.31, 5.21]]],
  integrity: { hasNestedRelations: false, unsupportedWayRoles: [], displaySafe: true },
  provenance: { provider: 'OpenStreetMap', relationId: 42, fetchedAt: Date.now() },
}

beforeEach(() => { session.ownerId = 'account-a' })
afterEach(() => vi.useRealTimers())

describe('trailSnapshots — source locale canonique', () => {
  it('crée un UUID opaque et conserve séparément distance locale et totale', async () => {
    const created = await createTrailSnapshotRefs([{ route, geometry }], { radiusKm: 10 })
    const [ref] = created.refs
    expect(created.persistent).toBe(false) // environnement node : fallback mémoire explicite
    expect(ref?.trailId).toMatch(/^[0-9a-f-]{36}$/)
    const before = await getTrailSnapshot(ref!.trailId)
    expect(before?.routeId).toBe(42)
    expect(before?.distanceInAreaKm).toBe(3.2)
    expect(before?.geometry?.distanceKm).toBe(8.4)
    expect(before?.geometry?.sourceSegments).toEqual(geometry.sourceSegments)
  })

  it('refuse d’attacher la géométrie d’une autre relation', async () => {
    const { refs: [ref] } = await createTrailSnapshotRefs([{ route, geometry }], { radiusKm: 10 })
    expect(await saveTrailGeometry(ref!.trailId, { ...geometry, id: 99 })).toBeNull()
    expect((await getTrailSnapshot(ref!.trailId))?.geometry?.id).toBe(42)
  })

  it('isole un snapshot lors d’un changement de compte sur le même appareil', async () => {
    const { refs: [ref] } = await createTrailSnapshotRefs([{ route, geometry }], { radiusKm: 10 })
    session.ownerId = 'account-b'
    expect(await getTrailSnapshot(ref!.trailId)).toBeNull()
    expect(await getCachedTrailGeometry(42)).toBeNull()
    session.ownerId = 'account-a'
    expect((await getTrailSnapshot(ref!.trailId))?.routeId).toBe(42)
    expect((await getCachedTrailGeometry(42))?.distanceKm).toBe(8.4)
  })

  it('ne renouvelle pas artificiellement la fraîcheur OSM en recréant un bouton', async () => {
    const fetchedAt = Date.UTC(2026, 6, 19, 8)
    const ttlRoute = { ...route, id: 4242 }
    vi.useFakeTimers()
    vi.setSystemTime(fetchedAt)
    const original = {
      ...geometry,
      id: 4242,
      provenance: { ...geometry.provenance, relationId: 4242, fetchedAt },
    }
    await createTrailSnapshotRefs([{ route: ttlRoute, geometry: original }], { radiusKm: 10 })

    vi.setSystemTime(fetchedAt + 23 * 60 * 60 * 1000)
    const cached = await getCachedTrailGeometry(4242)
    expect(cached).not.toBeNull()
    await createTrailSnapshotRefs([{ route: ttlRoute, geometry: cached! }], { radiusKm: 10 })

    vi.setSystemTime(fetchedAt + 25 * 60 * 60 * 1000)
    expect(await getCachedTrailGeometry(4242)).toBeNull()
  })
})
