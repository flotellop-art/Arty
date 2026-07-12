// Refonte routage (étape 5) — getRouteExplanationKey : raison exacte quand le
// ReasonCode est valide, fallback générique sinon (historique, appels sans
// décision, code inconnu d'une future version). Jamais de clé i18n brute.
import { describe, expect, it } from 'vitest'
import { getModelExplanationKey, getRouteExplanationKey } from '../../services/modelLabels'
import { ALL_REASON_CODES } from '../../services/router/types'

describe('getRouteExplanationKey', () => {
  it('code valide → clé routeReason exacte', () => {
    expect(getRouteExplanationKey('claude-sonnet-5', 'private_data'))
      .toBe('chat.routeReason.private_data')
    expect(getRouteExplanationKey('gemini-2.5-flash', 'default_capable'))
      .toBe('chat.routeReason.default_capable')
  })

  it('tous les ReasonCodes sont acceptés', () => {
    for (const code of ALL_REASON_CODES) {
      expect(getRouteExplanationKey('claude-sonnet-5', code)).toBe(`chat.routeReason.${code}`)
    }
  })

  it('code absent → fallback générique par modèle', () => {
    expect(getRouteExplanationKey('mistral-medium-latest', null))
      .toBe(getModelExplanationKey('mistral-medium-latest'))
    expect(getRouteExplanationKey('claude-sonnet-5', undefined))
      .toBe(getModelExplanationKey('claude-sonnet-5'))
  })

  it('code inconnu (future version, données corrompues) → fallback générique', () => {
    expect(getRouteExplanationKey('claude-sonnet-5', 'code_qui_nexiste_pas'))
      .toBe(getModelExplanationKey('claude-sonnet-5'))
  })
})
