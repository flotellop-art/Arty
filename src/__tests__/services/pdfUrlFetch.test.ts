// Tests de fetchUrlMarkdowns (fix paywall/natif du 11 juin 2026). Vérifie
// que : (1) l'URL appelée passe par apiUrl, (2) un 502 « Empty document »
// (paywall) remonte dans `unreadable` sans casser, (3) un succès produit le
// bloc inliné.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: () => Promise.resolve('tok'),
}))
// apiUrl renvoie le chemin tel quel en web (API_BASE = '') — on l'utilise
// pour vérifier que fetchOne passe bien par lui (pas un fetch nu).
vi.mock('../../services/apiBase', () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
}))

import { fetchUrlMarkdowns } from '../../services/pdfUrlFetch'

describe('fetchUrlMarkdowns', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('appelle /api/fetch/url via apiUrl (host absolu)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ markdown: 'Contenu article' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { block } = await fetchUrlMarkdowns(['https://ex.fr/a'])
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/fetch/url', expect.anything())
    expect(block).toContain('Contenu article')
    expect(block).toContain('https://ex.fr/a')
  })

  it('502 (paywall/empty) → bloc null + URL dans unreadable, pas de crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))
    const { block, unreadable } = await fetchUrlMarkdowns(['https://lefigaro.fr/x'])
    expect(block).toBeNull()
    expect(unreadable).toEqual(['https://lefigaro.fr/x'])
  })

  it('panne réseau → error (pas unreadable), bloc null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { block, unreadable } = await fetchUrlMarkdowns(['https://ex.fr/a'])
    expect(block).toBeNull()
    expect(unreadable).toEqual([]) // panne technique ≠ paywall
  })

  it('mix : une page lue, une paywall', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ markdown: 'ok' }) })
      .mockResolvedValueOnce({ ok: false, status: 502 })
    vi.stubGlobal('fetch', fetchMock)
    const { block, unreadable } = await fetchUrlMarkdowns(['https://a.fr/1', 'https://b.fr/2'])
    expect(block).toContain('ok')
    expect(unreadable).toEqual(['https://b.fr/2'])
  })
})
