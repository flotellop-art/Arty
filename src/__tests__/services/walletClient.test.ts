import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Isole walletClient de ses deps lourdes (réseau/Capacitor) — on ne teste que
// la logique d'éligibilité premium, qui dépend du cache solde + du compteur essai.
let trialRemaining: number | null = null
const context = vi.hoisted(() => ({ epoch: 0 }))
vi.mock('../../services/billingContext', () => ({
  onBillingContextInvalidated: () => () => {},
  captureBillingContext: () => {
    const epoch = context.epoch
    return { isCurrent: () => context.epoch === epoch, getAccessToken: async () => 'synthetic-token' }
  },
}))
vi.mock('../../services/trialClient', () => ({ getTrialRemaining: () => trialRemaining }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: async () => null }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))

import { creditsCoverPremium, getCachedWalletAvailableMicro, fetchWalletBalance, clearWalletCache, hasWalletCached, getWalletSnapshot, onWalletBalanceChanged } from '../../services/walletClient'

async function setWallet(micro: number | null, trialState: string | undefined = 'outside-trial') {
  if (micro === null) { clearWalletCache(); return }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ trialState, hasWallet: true, balanceMicro: micro, reservedMicro: 0, availableMicro: micro, reversalPending: false })))
  await fetchWalletBalance()
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); clearWalletCache() })

describe('creditsCoverPremium — débloque le premium seulement APRÈS l\'essai gratuit', () => {
  beforeEach(() => {
    trialRemaining = null
    context.epoch += 1; clearWalletCache()
    localStorage.clear()
  })

  it('false sans crédits', async () => {
    await setWallet(0)
    expect(creditsCoverPremium()).toBe(false)
  })

  // Cœur de la priorité "essai gratuit d'abord" : pendant l'essai, pas de premium
  // via crédits (le serveur force Haiku de toute façon).
  it('false avec crédits MAIS essai encore actif (restant > 0)', async () => {
    await setWallet(40_000_000)
    trialRemaining = 12
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed'))
    expect(creditsCoverPremium()).toBe(false)
  })

  it('true avec crédits + essai épuisé (restant 0)', async () => {
    await setWallet(40_000_000)
    trialRemaining = 0
    expect(creditsCoverPremium()).toBe(true)
  })

  it('true avec crédits + jamais d\'essai (null = vrai free)', async () => {
    await setWallet(40_000_000)
    trialRemaining = null
    expect(creditsCoverPremium()).toBe(true)
  })

  it('an older server with no trial classification cannot unlock credits from a missing display cache', async () => {
    trialRemaining = null
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hasWallet: true, balanceMicro: 9000, reservedMicro: 0, availableMicro: 9000, reversalPending: false })))
    await fetchWalletBalance()
    expect(getWalletSnapshot()?.trialState).toBe('unknown')
    expect(creditsCoverPremium()).toBe(false)
  })
  it.each(['unknown', 'active', undefined, 'invalid'])('never opens premium on unverified/active classification %s', async state => {
    await setWallet(9000, state === undefined ? 'unknown' : state)
    trialRemaining = null
    expect(creditsCoverPremium()).toBe(false)
  })
  it.each(['exhausted', 'outside-trial'])('fresh %s supersedes an old positive display from another channel', async state => {
    trialRemaining = 20
    await setWallet(9000, state)
    expect(creditsCoverPremium()).toBe(true)
  })
  it('new unknown quota after a wallet receipt closes it until refreshed', async () => {
    await setWallet(9000)
    trialRemaining = null
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed'))
    expect(creditsCoverPremium()).toBe(false)
    await setWallet(9000)
    expect(creditsCoverPremium()).toBe(true)
  })
  it('a quota update during a held wallet read cannot be erased by its late response', async () => {
    let release!: (r: Response) => void
    const http = vi.fn(() => new Promise<Response>(resolve => { release = resolve }))
    vi.stubGlobal('fetch', http)
    const reading = fetchWalletBalance()
    await vi.waitFor(() => expect(http).toHaveBeenCalledOnce())
    trialRemaining = 20
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed'))
    release(Response.json({ trialState: 'outside-trial', hasWallet: true, balanceMicro: 9000, reservedMicro: 0, availableMicro: 9000, reversalPending: false }))
    await reading
    expect(creditsCoverPremium()).toBe(false)
  })
  it('reads only the verified current in-memory snapshot', async () => {
    localStorage.setItem('arty-wallet-available', '9000000')
    expect(getCachedWalletAvailableMicro()).toBe(0)
    await setWallet(123_456)
    expect(getCachedWalletAvailableMicro()).toBe(123_456)
    await setWallet(null)
    expect(getCachedWalletAvailableMicro()).toBe(0)
  })
  it('remains closed when blocked status arrives and localStorage writes/removals both fail', async () => {
    await setWallet(9000000)
    expect(creditsCoverPremium()).toBe(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic quota') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('synthetic storage failure') })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hasWallet: true, balanceMicro: 9000000, reservedMicro: 0, availableMicro: 9000000, reversalPending: true })))
    expect(await fetchWalletBalance()).toMatchObject({ availableMicro: 0, balanceMicro: 9000000, reversalPending: true })
    expect(localStorage.getItem('arty-wallet-available')).toBe('9000000')
    expect(creditsCoverPremium()).toBe(false)
    expect(hasWalletCached()).toBe(true)
    clearWalletCache()
    expect(getCachedWalletAvailableMicro()).toBe(0)
    expect(hasWalletCached()).toBe(false)
  })
  it.each([
    { reversalPending: undefined }, { reversalPending: 'false' }, { balanceMicro: -1 },
    { availableMicro: '9000' }, { availableMicro: 11 }, { reservedMicro: NaN },
    { hasWallet: false },
  ])('does not grant from an unverified wallet DTO (%j)', async patch => {
    await setWallet(9000)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hasWallet: true, balanceMicro: 10, reservedMicro: 0, availableMicro: 10, reversalPending: false, ...patch })))
    expect(await fetchWalletBalance()).toBeNull()
    expect(creditsCoverPremium()).toBe(false)
  })
  it('a changed context closes a warm snapshot even if persisted values remain', async () => {
    await setWallet(9000)
    context.epoch += 1
    expect(getWalletSnapshot()).toBeNull()
    expect(creditsCoverPremium()).toBe(false)
  })
  it('does not return a receipt revoked by a synchronous publication subscriber', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hasWallet: true, balanceMicro: 9000, reservedMicro: 0, availableMicro: 9000, reversalPending: false })))
    const off = onWalletBalanceChanged(() => { if (getWalletSnapshot()) clearWalletCache() })
    try { expect(await fetchWalletBalance()).toBeNull(); expect(creditsCoverPremium()).toBe(false) }
    finally { off() }
  })
  it.each(['positive', 'pending', 'failure'])('discards a late old-account %s response without changing the new snapshot', async kind => {
    let release!: (value: Response) => void
    const old = new Promise<Response>(resolve => { release = resolve })
    const http = vi.fn().mockImplementationOnce(() => old)
    vi.stubGlobal('fetch', http)
    const reading = fetchWalletBalance()
    await vi.waitFor(() => expect(http).toHaveBeenCalledOnce())
    context.epoch += 1
    http.mockImplementation(async () => Response.json({ hasWallet: true, balanceMicro: 50000, reservedMicro: 0, availableMicro: 50000, reversalPending: false }))
    expect(await fetchWalletBalance()).toMatchObject({ availableMicro: 50000 })
    release(kind === 'failure' ? new Response(null, { status: 503 }) : Response.json({ hasWallet: true,
      balanceMicro: 900000, reservedMicro: 0, availableMicro: kind === 'pending' ? 0 : 900000, reversalPending: kind === 'pending' }))
    expect(await reading).toBeNull()
    expect(getWalletSnapshot()).toMatchObject({ availableMicro: 50000, reversalPending: false })
  })
})
