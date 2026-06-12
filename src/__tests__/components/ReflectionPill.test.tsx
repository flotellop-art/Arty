// Tests de la pastille Réflexion (au-dessus de la barre de saisie).
// Rendu statique react-dom/server — useState fonctionne, useEffect est
// ignoré (pas besoin : on teste le rendu initial et le masquage).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReflectionPill } from '../../components/chat/ReflectionPill'
import { setSelectedModel } from '../../services/modelSelector'
import { setReflectionLevel } from '../../services/reflectionLevel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
})

describe('ReflectionPill — visibilité', () => {
  it('visible par défaut (modèle auto) avec le niveau courant', () => {
    const html = renderToStaticMarkup(<ReflectionPill />)
    expect(html).toContain('chat.reflection.label')
    expect(html).toContain('chat.reflection.auto')
  })

  it('affiche le niveau persisté', () => {
    setReflectionLevel('approfondi')
    const html = renderToStaticMarkup(<ReflectionPill />)
    expect(html).toContain('chat.reflection.approfondi')
  })

  it('MASQUÉE en conversation euOnly', () => {
    expect(renderToStaticMarkup(<ReflectionPill euOnly />)).toBe('')
  })

  it('MASQUÉE quand le modèle sélectionné ne supporte pas la réflexion', () => {
    setSelectedModel('mistral')
    expect(renderToStaticMarkup(<ReflectionPill />)).toBe('')
    setSelectedModel('openai')
    expect(renderToStaticMarkup(<ReflectionPill />)).toBe('')
  })

  it('visible pour Claude et Gemini', () => {
    setSelectedModel('claude')
    expect(renderToStaticMarkup(<ReflectionPill />)).toContain('chat.reflection.label')
    setSelectedModel('gemini')
    expect(renderToStaticMarkup(<ReflectionPill />)).toContain('chat.reflection.label')
  })
})
