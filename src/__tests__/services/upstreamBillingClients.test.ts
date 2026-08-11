// Le sentinel `upstream_billing` doit devenir un message LISIBLE sur chaque
// client, pas retomber dans le générique « Erreur X (400) ». C'est la moitié
// client de la leçon BUG 64 : le proxy expose la catégorie, encore faut-il que
// quelqu'un la traduise.
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { sendMessageStream } from '../../services/openaiClient'
import { streamMistralMessage } from '../../services/mistralClient'

const ORIGINAL_FETCH = global.fetch
const BILLING_MESSAGE = i18n.t('errors.apiUpstreamBilling')

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

function billingResponse(status: number): Response {
  return new Response(JSON.stringify({ error: 'upstream_billing' }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('crédits serveur épuisés — message lisible côté client', () => {
  it('openaiClient traduit upstream_billing au lieu de « Erreur OpenAI (400) »', async () => {
    global.fetch = vi.fn(async () => billingResponse(400)) as typeof fetch

    const error = await new Promise<Error>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('timeout')), 3000)
      sendMessageStream(
        [{ role: 'user', content: 'Salut' }],
        'sk-user',
        () => undefined,
        () => { window.clearTimeout(timeout); reject(new Error('should not complete')) },
        (e) => { window.clearTimeout(timeout); resolve(e) },
      )
    })

    expect(error.message).toBe(BILLING_MESSAGE)
    expect(error.message).not.toMatch(/\(400\)/)
  })

  it('mistralClient le traduit même sur un 429 (sinon « réessaie » trompeur)', async () => {
    global.fetch = vi.fn(async () => billingResponse(429)) as typeof fetch

    const error = await new Promise<Error>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('timeout')), 5000)
      streamMistralMessage(
        [{ role: 'user', content: 'Salut' }],
        () => undefined,
        () => { window.clearTimeout(timeout); reject(new Error('should not complete')) },
        (e) => { window.clearTimeout(timeout); resolve(e) },
        undefined,
        'sk-mistral',
      )
    })

    expect(error.message).toBe(BILLING_MESSAGE)
  })

  it('le message ne mentionne aucun fournisseur (clé i18n partagée)', () => {
    expect(BILLING_MESSAGE).not.toMatch(/anthropic|openai|mistral|gemini/i)
    expect(BILLING_MESSAGE.length).toBeGreaterThan(20)
  })
})

describe('autres motifs de 400 — lisibles au lieu de « Erreur OpenAI (400) »', () => {
  function runOpenAI(body: object, status = 400): Promise<Error> {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('timeout')), 3000)
      sendMessageStream(
        [{ role: 'user', content: 'Salut' }],
        'sk-user',
        () => undefined,
        () => { window.clearTimeout(timeout); reject(new Error('should not complete')) },
        (e) => { window.clearTimeout(timeout); resolve(e) },
      )
    })
  }

  it('modèle hors de portée du compte : message actionnable, pas un code brut', async () => {
    // Le repli Terra → gpt-5 a déjà eu lieu en amont ; arriver ici signifie
    // que même le modèle de repli est refusé (palier de compte insuffisant).
    const error = await runOpenAI({ error: { message: 'model_not_supported', code: 'model_not_supported' } })
    expect(error.message).toBe(i18n.t('errors.openaiModelUnavailable'))
    expect(error.message).not.toMatch(/model_not_supported/)
  })

  it('requête invalide : le motif upstream est affiché, pas masqué', async () => {
    const error = await runOpenAI({ error: "upstream_invalid_request: Unsupported parameter: 'tools'" })
    expect(error.message).toContain("Unsupported parameter: 'tools'")
  })
})
