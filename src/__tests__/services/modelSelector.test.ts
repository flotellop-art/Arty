import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS } from '../../services/modelSelector'

describe('modelSelector', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('retourne auto par défaut', () => {
    expect(getSelectedModel()).toBe('auto')
  })

  it('persiste et relit le modèle sélectionné', () => {
    setSelectedModel('mistral')
    expect(getSelectedModel()).toBe('mistral')
  })

  it('retombe sur auto si la valeur stockée est inconnue', () => {
    localStorage.setItem('arty-ai-model', 'modele-disparu')
    expect(getSelectedModel()).toBe('auto')
  })

  // BUG 54 — toute écriture dans un store partagé doit notifier via
  // CustomEvent. Sans cet event, TopBar (Home) et ChatTopBar affichent
  // des modèles différents après un changement dans l'autre vue.
  it("dispatche 'model-changed' avec le modèle en detail", () => {
    const listener = vi.fn()
    window.addEventListener('model-changed', listener)
    try {
      setSelectedModel('gemini')
      expect(listener).toHaveBeenCalledTimes(1)
      const event = listener.mock.calls[0]![0] as CustomEvent
      expect(event.detail).toBe('gemini')
    } finally {
      window.removeEventListener('model-changed', listener)
    }
  })

  it('accepte tous les modèles déclarés dans MODEL_OPTIONS', () => {
    for (const opt of MODEL_OPTIONS) {
      setSelectedModel(opt.id)
      expect(getSelectedModel()).toBe(opt.id)
    }
  })
})
