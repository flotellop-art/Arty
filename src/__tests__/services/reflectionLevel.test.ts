// Tests du réglage global « niveau de réflexion » : persistance, event de
// synchro (BUG 54), gate Pro sur Max, et masquage pour les modèles sans
// réflexion (Mistral/ChatGPT) ou les conversations EU.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getReflectionLevel,
  setReflectionLevel,
  isReflectionLevelLocked,
  reflectionSupported,
  REFLECTION_OPTIONS,
} from '../../services/reflectionLevel'

describe('reflectionLevel — persistance', () => {
  beforeEach(() => {
    try { localStorage.clear() } catch { /* jsdom */ }
  })

  it('défaut = auto', () => {
    expect(getReflectionLevel()).toBe('auto')
  })

  it('set/get round-trip', () => {
    setReflectionLevel('approfondi')
    expect(getReflectionLevel()).toBe('approfondi')
  })

  it('valeur corrompue en storage → retombe sur auto', () => {
    localStorage.setItem('arty-reflection-level', 'n_importe_quoi')
    expect(getReflectionLevel()).toBe('auto')
  })

  it('setReflectionLevel dispatche reflection-level-changed (BUG 54)', () => {
    const spy = vi.fn()
    window.addEventListener('reflection-level-changed', spy)
    setReflectionLevel('max')
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0]![0] as CustomEvent).detail).toBe('max')
    window.removeEventListener('reflection-level-changed', spy)
  })
})

describe('isReflectionLevelLocked — gate Pro sur Max', () => {
  it('Max verrouillé hors Pro', () => {
    expect(isReflectionLevelLocked('max', false)).toBe(true)
  })

  it('Max ouvert pour Pro', () => {
    expect(isReflectionLevelLocked('max', true)).toBe(false)
  })

  it('les autres niveaux ne sont jamais verrouillés', () => {
    for (const id of ['auto', 'rapide', 'approfondi'] as const) {
      expect(isReflectionLevelLocked(id, false)).toBe(false)
    }
  })

  it('seul Max est proOnly dans les options', () => {
    expect(REFLECTION_OPTIONS.filter((o) => o.proOnly).map((o) => o.id)).toEqual(['max'])
  })

  it('ordre du sélecteur = Auto → Rapide → Approfondi → Max', () => {
    expect(REFLECTION_OPTIONS.map((o) => o.id)).toEqual(['auto', 'rapide', 'approfondi', 'max'])
  })
})

describe('reflectionSupported — masquage modèles sans réflexion', () => {
  it('Claude / Gemini / Auto supportent la réflexion', () => {
    expect(reflectionSupported('auto')).toBe(true)
    expect(reflectionSupported('claude')).toBe(true)
    expect(reflectionSupported('gemini')).toBe(true)
  })

  it('Mistral / ChatGPT ne la supportent pas (contrôle masqué)', () => {
    expect(reflectionSupported('mistral')).toBe(false)
    expect(reflectionSupported('openai')).toBe(false)
  })

  it('conversation EU → masqué quel que soit le modèle', () => {
    expect(reflectionSupported('claude', true)).toBe(false)
    expect(reflectionSupported('gemini', true)).toBe(false)
    expect(reflectionSupported('auto', true)).toBe(false)
  })
})
