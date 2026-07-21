import { describe, it, expect } from 'vitest'
import { TRIAL_ALLOWED_MODELS, isModelAllowedInTrial } from '../../../functions/api/_lib/checkAllowedUser'

// C-E / F-16 (audit visibilité modèle) — la liste DÉCLARÉE et l'ENFORCEMENT
// avaient divergé : TRIAL_ALLOWED_MODELS affichait `mistral-medium` (Small
// déprécié mai 2026) mais isModelAllowedInTrial exigeait encore `small` — la
// cible du swap trial de mistral-proxy échouait elle-même le test. Ces tests
// de parité ferment la classe de bug : toute évolution de l'un DOIT suivre
// dans l'autre, sinon CI rouge.
describe('parité TRIAL_ALLOWED_MODELS ↔ isModelAllowedInTrial', () => {
  it.each([...TRIAL_ALLOWED_MODELS])('la famille déclarée %s est acceptée par l\'enforcement', (family) => {
    expect(isModelAllowedInTrial(family)).toBe(true)
  })

  // Les ids RÉELLEMENT envoyés/servis en essai — dont les cibles des swaps
  // serveur (proxy.ts → Haiku daté ; mistral-proxy.ts → medium-latest).
  it.each([
    'claude-haiku-4-5-20251001',
    'mistral-medium-latest',
    'gemini-2.5-flash',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gpt-5-mini',
  ])('id réel %s → autorisé en essai', (id) => {
    expect(isModelAllowedInTrial(id)).toBe(true)
  })

  it.each([
    'claude-sonnet-5',
    'claude-opus-4-8',
    'gpt-5.5',
    // Décision vision A5 : un essai sur clé serveur reste chez Claude pour
    // les photos. Seule une clé OpenAI personnelle peut contourner ce verrou.
    'gpt-5.6-terra',
    'gpt-5',
    'gemini-2.5-pro',
    'mistral-large-latest',
    'modele-inconnu',
  ])('id premium/inconnu %s → refusé en essai', (id) => {
    expect(isModelAllowedInTrial(id)).toBe(false)
  })
})
