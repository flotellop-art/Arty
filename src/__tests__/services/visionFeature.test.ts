import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isVision4kFoundationEnabled, isVisionTerraAutoRoutingEnabled } from '../../services/visionFeature'

describe('vision 4K foundation feature flag', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('ouvre Terra manuel et le routage Auto par défaut en production', () => {
    expect(isVision4kFoundationEnabled()).toBe(true)
    expect(isVisionTerraAutoRoutingEnabled()).toBe(true)
  })

  it("garde 0 comme coupe-circuit explicite de la fondation", () => {
    localStorage.setItem('arty-vision-terra-4k-foundation', '0')
    expect(isVision4kFoundationEnabled()).toBe(false)
    expect(isVisionTerraAutoRoutingEnabled()).toBe(false)
    localStorage.setItem('arty-vision-terra-4k-foundation', '1')
    expect(isVision4kFoundationEnabled()).toBe(true)
  })

  it('permet de couper Auto sans désactiver Terra manuel', () => {
    expect(isVision4kFoundationEnabled()).toBe(true)
    localStorage.setItem('arty-vision-terra-auto-routing', '0')
    expect(isVisionTerraAutoRoutingEnabled()).toBe(false)
    expect(isVision4kFoundationEnabled()).toBe(true)
    localStorage.setItem('arty-vision-terra-auto-routing', '1')
    expect(isVisionTerraAutoRoutingEnabled()).toBe(true)
  })

  it('garde Terra manuel et Auto ouverts si le stockage local est indisponible', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(isVision4kFoundationEnabled()).toBe(true)
    expect(isVisionTerraAutoRoutingEnabled()).toBe(true)
  })
})
