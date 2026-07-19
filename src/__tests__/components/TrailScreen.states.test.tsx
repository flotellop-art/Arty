// États non-nominaux de la page /trail/:routeId — conformité BUG 61 : aucun
// état stable ne doit rendre un écran vide ; chaque échec a un message et une
// action (retour / réessayer). Le chemin nominal (carte Leaflet) n'est pas
// testable en jsdom — couvert par le test terrain APK/PWA (checklist PR).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../services/trailsClient', () => ({
  fetchTrailGeometry: vi.fn(),
}))
vi.mock('../../services/native/shareFile', () => ({ downloadOrShareFile: vi.fn() }))
vi.mock('../../services/native/location', () => ({
  getUserLocation: vi.fn(async () => null),
}))

import { TrailScreen } from '../../screens/trail'
import { fetchTrailGeometry } from '../../services/trailsClient'

const mockFetch = vi.mocked(fetchTrailGeometry)

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/trail/:routeId" element={<TrailScreen />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('TrailScreen — états d\'échec actionnables (BUG 61)', () => {
  it('id non numérique → « introuvable » + retour, sans appel réseau', async () => {
    renderAt('/trail/pas-un-id')
    expect(await screen.findByText('trailPage.notFound')).toBeInTheDocument()
    expect(screen.getByText('trailPage.notFoundHint')).toBeInTheDocument()
    expect(screen.getByText('trailPage.back')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('quota atteint (429) → message dédié + retour', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 'quota' })
    renderAt('/trail/18675656')
    expect(await screen.findByText('trailPage.quota')).toBeInTheDocument()
    expect(screen.getByText('trailPage.back')).toBeInTheDocument()
  })

  it('erreur réseau → message + bouton réessayer', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 'network' })
    renderAt('/trail/18675656')
    expect(await screen.findByText('trailPage.error')).toBeInTheDocument()
    expect(screen.getByText('trailPage.retry')).toBeInTheDocument()
  })

  it('géométrie vide → traité comme introuvable (pas de carte fantôme)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: { id: 42, name: 'X', kind: 'horse', distanceKm: 0, segments: [] },
    })
    renderAt('/trail/42')
    expect(await screen.findByText('trailPage.notFound')).toBeInTheDocument()
  })
})
