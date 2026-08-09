import { describe, expect, it } from 'vitest'
import { safeUpstreamRequestError } from '../../../functions/api/ai/proxy'

// Frontière de sécurité (audit F-6, affinée le 9 août 2026) : un 400 Anthropic
// peut décrire NOTRE requête (bug applicatif — exposable, indispensable au
// diagnostic) ou l'état de FACTURATION de la clé du propriétaire (jamais
// exposable). Ces tests verrouillent la séparation.

const invalidRequest = (message: string) =>
  JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } })

describe('safeUpstreamRequestError — expose le bug, jamais l’état de la clé', () => {
  it('expose une erreur de payload (schéma d’outil)', () => {
    const out = safeUpstreamRequestError(
      invalidRequest('tools.12.custom.name: String should match pattern')
    )
    expect(out).toContain('tools.12.custom.name')
  })

  it('expose une erreur de bloc de message', () => {
    expect(safeUpstreamRequestError(invalidRequest('messages.0.content.0.type: Field required')))
      .toContain('Field required')
  })

  // Les messages qui ont réellement coûté le diagnostic du 9 août : ils
  // DOIVENT rester visibles, c'est toute la raison d'être de cette exposition.
  it.each([
    'thinking is not supported for this model',
    'output_config.effort is not supported on claude-haiku-4-5',
    'tools.1: web_fetch_20260209 is not supported by this model',
    'max_tokens: must be less than or equal to 64000',
  ])('expose les incompatibilités de modèle : %s', (message) => {
    expect(safeUpstreamRequestError(invalidRequest(message))).toContain(message)
  })

  it.each([
    'Your credit balance is too low to access the Claude API',
    'This request would exceed your organization plan limit',
    'Please upgrade your plan or purchase additional credits',
    'Billing issue: payment method declined',
    'You have exceeded your monthly quota',
  ])('masque tout message de facturation : %s', (message) => {
    expect(safeUpstreamRequestError(invalidRequest(message))).toBeNull()
  })

  it('masque les erreurs qui ne sont pas des invalid_request_error', () => {
    const authError = JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    expect(safeUpstreamRequestError(authError)).toBeNull()
    const rateLimit = JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } })
    expect(safeUpstreamRequestError(rateLimit)).toBeNull()
  })

  it('résiste à un corps non JSON, vide ou malformé', () => {
    for (const body of ['', 'not json', '{', '{"error":{}}', '{"error":{"type":"invalid_request_error"}}']) {
      expect(safeUpstreamRequestError(body)).toBeNull()
    }
  })

  it('borne la longueur du message exposé', () => {
    const out = safeUpstreamRequestError(invalidRequest('x'.repeat(2000)))
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThan(360)
  })
})
