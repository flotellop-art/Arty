// Frontière « bug applicatif » / « état de la clé du propriétaire ».
//
// BUG 64 (9 août) : crédits Anthropic épuisés → 400 → motif masqué → quatre
// correctifs de payload à côté de la plaque. Le correctif n'avait été posé que
// sur le proxy Anthropic ; le 10 août, « Erreur OpenAI (400) » sur un simple
// « Salut » a reproduit la même cécité un provider plus loin. Ces tests
// verrouillent la règle : le DÉTAIL reste masqué, la CATÉGORIE remonte.
import { describe, expect, it } from 'vitest'
import { classifyUpstreamBilling, isBillingMessage } from '../../../functions/api/_lib/upstreamBilling'

describe('classifyUpstreamBilling — compte à sec', () => {
  it('reconnaît le code structuré OpenAI insufficient_quota (servi en 429)', () => {
    const body = JSON.stringify({
      error: {
        message: 'You exceeded your current quota, please check your plan and billing details.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    })
    expect(classifyUpstreamBilling(body)).toBe('upstream_billing')
  })

  it('reconnaît un plafond de facturation dur', () => {
    const body = JSON.stringify({ error: { code: 'billing_hard_limit_reached', message: 'Billing hard limit has been reached' } })
    expect(classifyUpstreamBilling(body)).toBe('upstream_billing')
  })

  it('reconnaît la formulation Anthropic historique (message libre, sans code)', () => {
    const body = JSON.stringify({
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API' },
    })
    expect(classifyUpstreamBilling(body)).toBe('upstream_billing')
  })

  it('se rabat sur le texte quand le corps n\'est pas du JSON', () => {
    expect(classifyUpstreamBilling('402 Payment Required — please check your billing')).toBe('upstream_billing')
  })
})

describe('classifyUpstreamBilling — ce qui ne doit PAS être classé', () => {
  it('un rate limit transitoire n\'est pas un compte à sec', () => {
    // Le confondre remplacerait une erreur illisible par une erreur FAUSSE :
    // « préviens l'administrateur » sur un simple pic de trafic.
    const body = JSON.stringify({ error: { code: 'rate_limit_exceeded', type: 'requests', message: 'Too many requests' } })
    expect(classifyUpstreamBilling(body)).toBeNull()
  })

  it('le RESOURCE_EXHAUSTED de Gemini (quota par minute) n\'est pas classé', () => {
    const body = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per minute' } })
    expect(classifyUpstreamBilling(body)).toBeNull()
  })

  it('un vrai bug de payload reste non classé (masquage générique conservé)', () => {
    const body = JSON.stringify({
      error: { type: 'invalid_request_error', code: 'invalid_value', message: "Invalid value for 'tools[0].function.name'" },
    })
    expect(classifyUpstreamBilling(body)).toBeNull()
  })

  it('corps vide ou illisible → null', () => {
    expect(classifyUpstreamBilling('')).toBeNull()
    expect(classifyUpstreamBilling('<html>502 Bad Gateway</html>')).toBeNull()
    expect(classifyUpstreamBilling(JSON.stringify({ error: null }))).toBeNull()
  })
})

describe('isBillingMessage', () => {
  it('ne classe ni le vide ni le non-texte', () => {
    expect(isBillingMessage('')).toBe(false)
    expect(isBillingMessage('   ')).toBe(false)
    expect(isBillingMessage(undefined)).toBe(false)
    expect(isBillingMessage(42)).toBe(false)
  })
})
