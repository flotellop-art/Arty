// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/native/location', () => ({
  getUserLocation: vi.fn(),
  isLocationConsentEnabled: vi.fn(() => false),
}))
vi.mock('../../services/trailsClient', () => ({
  searchTrails: vi.fn(),
  fetchTrailGeometries: vi.fn(),
  fetchTrailGeometry: vi.fn(),
  isTrailGeometry: (value: unknown) => !!value && typeof value === 'object' && 'provenance' in value,
}))
vi.mock('../../services/trailSnapshots', () => ({
  createTrailSnapshotRefs: vi.fn(),
  getCachedTrailGeometry: vi.fn(async () => null),
  getTrailSnapshot: vi.fn(),
  saveTrailGeometry: vi.fn(),
}))
vi.mock('../../services/native/shareFile', () => ({ downloadOrShareFile: vi.fn() }))
vi.mock('../../services/tools/untrustedContent', () => ({
  markUntrustedThirdPartyData: vi.fn((_source: string, content: string) => content),
}))

import { createTrailHandlers, trailToolDefinitions } from '../../services/tools/trailTools'
import { fetchTrailGeometries, searchTrails } from '../../services/trailsClient'
import { createTrailSnapshotRefs, saveTrailGeometry } from '../../services/trailSnapshots'

const routes = [
  { id: 1, name: 'Courte', kind: 'horse', network: null, longDistance: false, distanceKm: 2, colour: null, symbol: null, website: null, note: null },
  { id: 2, name: 'Longue', kind: 'horse', network: null, longDistance: false, distanceKm: 3, colour: null, symbol: null, website: null, note: null },
]
const geometry = (id: number, distanceKm: number) => ({
  id,
  name: id === 1 ? 'Courte' : 'Longue',
  kind: 'horse',
  distanceKm,
  distanceMeters: Math.round(distanceKm * 1000),
  sourceSegments: [[[45.3, 5.2], [45.31, 5.21]]] as [[number, number][]],
  sourceSegmentDirectionLocked: [false],
  displaySegments: [[[45.3, 5.2], [45.31, 5.21]]] as [[number, number][]],
  integrity: { hasNestedRelations: false, unsupportedWayRoles: [], displaySafe: true },
  provenance: { provider: 'OpenStreetMap' as const, relationId: id, fetchedAt: Date.now() },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(searchTrails).mockResolvedValue({
    ok: true,
    data: { center: { lat: 45.3, lon: 5.2, label: 'Viriville' }, radiusKm: 10, kind: 'horse', routes, totalFound: 2, nearbyPathCount: 20 },
  })
  vi.mocked(fetchTrailGeometries).mockResolvedValue({ ok: true, data: [geometry(1, 8), geometry(2, 14)] })
  vi.mocked(createTrailSnapshotRefs).mockImplementation(async (selected) => ({
    persistent: true,
    refs: selected.map(({ route }, index) => ({
      route,
      trailId: `1f6e8d4${index}-73c4-4f01-9d58-2a6f8c35e92${index}`,
    })),
  }))
  vi.mocked(saveTrailGeometry).mockResolvedValue(null)
})

describe('find_trails — distances vérifiées et filtres utilisateur', () => {
  it('n’a aucun maximum de circuit par défaut', async () => {
    const out = await createTrailHandlers().find_trails({ location: 'Viriville', kind: 'horse' })
    expect(out.result).toContain('8 km calculés sur le tracé complet')
    expect(out.result).toContain('14 km calculés sur le tracé complet')
    expect(createTrailSnapshotRefs).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ route: routes[0] }), expect.objectContaining({ route: routes[1] })]),
      expect.anything()
    )
  })

  it('applique le maximum uniquement lorsqu’il vient de la demande utilisateur', async () => {
    const out = await createTrailHandlers().find_trails({ location: 'Viriville', kind: 'horse', max_distance_km: 10 })
    expect(out.result).toContain('8 km calculés sur le tracé complet')
    expect(out.result).not.toContain('14 km calculés sur le tracé complet')
    expect(createTrailSnapshotRefs).toHaveBeenCalledWith(
      [expect.objectContaining({ route: routes[0] })],
      expect.anything()
    )
  })

  it('filtre sur les mètres non arrondis à la frontière du maximum', async () => {
    vi.mocked(fetchTrailGeometries).mockResolvedValueOnce({
      ok: true,
      data: [{ ...geometry(1, 13), distanceMeters: 13_040 }],
    })
    const out = await createTrailHandlers().find_trails({ location: 'Viriville', max_distance_km: 13 })
    expect(out.result).toContain('Aucun circuit')
    expect(createTrailSnapshotRefs).not.toHaveBeenCalled()
  })

  it('ne crée que cinq boutons persistants par recherche', async () => {
    const manyRoutes = Array.from({ length: 7 }, (_, index) => ({
      ...routes[0]!, id: index + 1, name: `Circuit ${index + 1}`,
    }))
    vi.mocked(searchTrails).mockResolvedValueOnce({
      ok: true,
      data: {
        center: { lat: 45.3, lon: 5.2, label: 'Viriville' }, radiusKm: 10, kind: 'horse',
        routes: manyRoutes, totalFound: 7, nearbyPathCount: 20,
      },
    })
    vi.mocked(fetchTrailGeometries).mockResolvedValueOnce({
      ok: true,
      data: manyRoutes.map((route) => ({ ...geometry(route.id, 8), name: route.name })),
    })

    await createTrailHandlers().find_trails({ location: 'Viriville', kind: 'horse' })
    expect(vi.mocked(createTrailSnapshotRefs).mock.calls[0]?.[0]).toHaveLength(5)
  })

  it('déclare les filtres de distance optionnels sans valeur produit par défaut', () => {
    const find = trailToolDefinitions.find((tool) => tool.name === 'find_trails')!
    expect(find.input_schema.properties).toHaveProperty('min_distance_km')
    expect(find.input_schema.properties).toHaveProperty('max_distance_km')
    expect(find.input_schema.properties).toHaveProperty('loop_only')
    expect(find.input_schema).not.toHaveProperty('required')
  })
})
