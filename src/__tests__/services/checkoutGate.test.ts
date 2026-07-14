// Play Store — le masquage des achats sur natif repose sur `canPurchase`
// (checkout.ts). Ce test verrouille la coupe TECHNIQUE : même si un bouton
// d'achat réapparaissait par erreur dans l'UI, openCheckout/openCreemCheckout
// doivent rester des no-op sur Capacitor natif.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/native/platform', () => ({
  isNative: true,
  platform: 'android',
}))

describe('checkout — gating natif (Play Store)', () => {
  it('canPurchase est false sur natif', async () => {
    const { canPurchase } = await import('../../services/checkout')
    expect(canPurchase).toBe(false)
  })

  it("openCheckout est un no-op sur natif (n'ouvre rien)", async () => {
    const { openCheckout } = await import('../../services/checkout')
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const onReturn = vi.fn()
    await openCheckout('subscription', 'user@example.com', { onReturn })
    expect(openSpy).not.toHaveBeenCalled()
    expect(onReturn).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('openCreemCheckout retourne false sur natif SANS appel réseau', async () => {
    const { openCreemCheckout } = await import('../../services/checkout')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(openCreemCheckout('credits_10')).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('utilise le portail client du store Arty, jamais la facturation du compte marchand', async () => {
    const { SUBSCRIPTION_PORTAL_URL } = await import('../../services/checkout')
    const portal = new URL(SUBSCRIPTION_PORTAL_URL)

    expect(portal.hostname).toBe('tryarty.lemonsqueezy.com')
    expect(portal.pathname).toBe('/billing')
    expect(SUBSCRIPTION_PORTAL_URL).not.toContain('app.lemonsqueezy.com')
  })
})
