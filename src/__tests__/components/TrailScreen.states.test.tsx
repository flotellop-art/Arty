// États non-nominaux de /trail/:trailId : aucun échec stable ne doit rendre
// un écran vide. La référence URL est un UUID opaque résolu localement avant
// tout appel réseau.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
vi.mock('../../services/native/location', () => ({
  getUserLocation: vi.fn(async () => null),
}))

import { TrailScreen } from '../../screens/trail'
import { fetchTrailGeometry } from '../../services/trailsClient'
import { getTrailSnapshot } from '../../services/trailSnapshots'

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
  mockFetch.mockReset()
  mockSnapshot.mockReset()
  mockSnapshot.mockResolvedValue(snapshot)
})

describe('TrailScreen — états d’échec actionnables (BUG 61)', () => {
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
