// États non-nominaux de /trail/:trailId : aucun échec stable ne doit rendre
// un écran vide. La référence URL est un UUID opaque résolu localement avant
// tout appel réseau.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../services/trailsClient', () => ({
  fetchTrailGeometry: vi.fn(),
  isTrailGeometry: (value: unknown) => !!value && typeof value === 'object' && 'provenance' in value,
}))
vi.mock('../../services/trailSnapshots', () => ({
  getTrailSnapshot: vi.fn(),
  saveTrailGeometry: vi.fn(),
}))
vi.mock('../../services/native/shareFile', () => ({ downloadOrShareFile: vi.fn() }))
vi.mock('../../services/toast', () => ({ toast: vi.fn() }))
vi.mock('leaflet', () => {
  const layer = () => ({ on: vi.fn(), addTo: vi.fn(), redraw: vi.fn() })
  return { default: { map: () => ({ fitBounds: vi.fn(), remove: vi.fn(), invalidateSize: vi.fn() }), tileLayer: layer, polyline: layer,
    control: { layers: layer, scale: layer }, latLngBounds: () => ({}) } }
})
vi.mock('../../services/native/location', () => ({
  getUserLocation: vi.fn(async () => null),
}))

import { TrailScreen } from '../../screens/trail'
import { fetchTrailGeometry } from '../../services/trailsClient'
import { getTrailSnapshot } from '../../services/trailSnapshots'
import { downloadOrShareFile } from '../../services/native/shareFile'
import { toast } from '../../services/toast'

const TRAIL_ID = '1f6e8d42-73c4-4f01-9d58-2a6f8c35e920'
const mockFetch = vi.mocked(fetchTrailGeometry)
const mockSnapshot = vi.mocked(getTrailSnapshot)

const snapshot = {
  id: TRAIL_ID,
  version: 3 as const,
  ownerId: 'device-local',
  routeId: 42,
  name: 'X',
  kind: 'horse',
  network: null,
  distanceInAreaKm: 2,
  radiusKm: 10,
  createdAt: Date.now(),
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/trail/:trailId" element={<TrailScreen />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.mocked(toast).mockClear(); vi.mocked(downloadOrShareFile).mockReset()
  mockFetch.mockReset()
  mockSnapshot.mockReset()
  mockSnapshot.mockResolvedValue(snapshot)
})

describe('TrailScreen — états d’échec actionnables (BUG 61)', () => {
  it.each(['capacity', 'Share canceled'])('export GPX : erreur %s distinguée de l’annulation', async error => {
    mockFetch.mockResolvedValue({ ok: true, data: { id: 42, name: 'X', kind: 'horse', distanceKm: 2, distanceMeters: 2000,
      sourceSegments: [[[45, 5], [45.1, 5.1]]], sourceSegmentDirectionLocked: [false], displaySegments: [[[45, 5], [45.1, 5.1]]],
      integrity: { hasNestedRelations: false, unsupportedWayRoles: [], displaySafe: true }, provenance: { provider: 'OpenStreetMap', relationId: 42, fetchedAt: Date.now() } } })
    vi.mocked(downloadOrShareFile).mockRejectedValue(new Error(error))
    renderAt(`/trail/${TRAIL_ID}`)
    fireEvent.click(await screen.findByText('trailPage.downloadGpx'))
    await waitFor(() => expect(downloadOrShareFile).toHaveBeenCalled())
    if (error === 'capacity') await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Export GPX impossible'), 'error'))
    else expect(toast).not.toHaveBeenCalled()
  })
  it('id non opaque → « introuvable » + retour, sans lookup ni réseau', async () => {
    renderAt('/trail/pas-un-id')
    expect(await screen.findByText('trailPage.notFound')).toBeInTheDocument()
    expect(screen.getByText('trailPage.notFoundHint')).toBeInTheDocument()
    expect(screen.getByText('trailPage.back')).toBeInTheDocument()
    expect(mockSnapshot).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('snapshot local absent → introuvable sans exposer un id OSM', async () => {
    mockSnapshot.mockResolvedValue(null)
    renderAt(`/trail/${TRAIL_ID}`)
    expect(await screen.findByText('trailPage.notFound')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('quota atteint (429) → message dédié + retour', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 'quota' })
    renderAt(`/trail/${TRAIL_ID}`)
    expect(await screen.findByText('trailPage.quota')).toBeInTheDocument()
    expect(screen.getByText('trailPage.back')).toBeInTheDocument()
  })

  it('erreur réseau → message + bouton réessayer', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 'network' })
    renderAt(`/trail/${TRAIL_ID}`)
    expect(await screen.findByText('trailPage.error')).toBeInTheDocument()
    expect(screen.getByText('trailPage.retry')).toBeInTheDocument()
  })

  it('géométrie source vide → introuvable, jamais de carte fantôme', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: { id: 42, name: 'X', kind: 'horse', distanceKm: 0, sourceSegments: [], displaySegments: [] },
    })
    renderAt(`/trail/${TRAIL_ID}`)
    expect(await screen.findByText('trailPage.notFound')).toBeInTheDocument()
  })
})
