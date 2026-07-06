import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleFetch } from '../../../functions/api/_lib/googleFetch'

// C13 — timeout serveur→Google. Le helper ne doit jamais écraser un signal
// fourni, et doit en ajouter un (AbortSignal.timeout) quand il n'y en a pas.
describe('googleFetch (C13)', () => {
  let spy: ReturnType<typeof vi.fn>
  beforeEach(() => { spy = vi.fn(async () => new Response('ok')); vi.stubGlobal('fetch', spy) })
  afterEach(() => vi.unstubAllGlobals())

  it('ajoute un AbortSignal de timeout quand aucun signal fourni', async () => {
    await googleFetch('https://gmail.googleapis.com/x')
    const init = spy.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('ne remplace PAS un signal déjà fourni, et préserve les autres options', async () => {
    const ctrl = new AbortController()
    await googleFetch('https://x', { signal: ctrl.signal, method: 'POST' })
    const init = spy.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBe(ctrl.signal)
    expect(init.method).toBe('POST')
  })

  it('retourne la réponse de fetch', async () => {
    const r = await googleFetch('https://x')
    expect(await r.text()).toBe('ok')
  })
})
