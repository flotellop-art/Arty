import { beforeEach, describe, expect, it } from 'vitest'
import { isVision4kFoundationEnabled, isVisionTerraAutoRoutingEnabled } from '../../services/visionFeature'

describe('vision 4K foundation feature flag', () => {
  beforeEach(() => localStorage.clear())

  it('reste désactivé par défaut', () => {
    expect(isVision4kFoundationEnabled()).toBe(false)
  })

  it("ne s'active que sur la valeur explicite 1", () => {
    localStorage.setItem('arty-vision-terra-4k-foundation', '1')
    expect(isVision4kFoundationEnabled()).toBe(true)
    localStorage.setItem('arty-vision-terra-4k-foundation', '0')
    expect(isVision4kFoundationEnabled()).toBe(false)
  })

  it('le routage Auto exige son flag ET la fondation', () => {
    localStorage.setItem('arty-vision-terra-auto-routing', '1')
    expect(isVisionTerraAutoRoutingEnabled()).toBe(false)
    localStorage.setItem('arty-vision-terra-4k-foundation', '1')
    expect(isVisionTerraAutoRoutingEnabled()).toBe(true)
    localStorage.setItem('arty-vision-terra-auto-routing', '0')
    expect(isVisionTerraAutoRoutingEnabled()).toBe(false)
  })
})
