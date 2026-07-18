// C4 (CDC veille 2026-07) : PREMIER test du proxy transcription. Deux volets :
// (1) tests runtime de resolveTranscriptionModel (la source de vérité modèle
// est le champ `model` du multipart réellement forwardé, validé par
// allowlist — RÈGLE 6) ; (2) gardes par source sur le câblage (quota et
// coût tracés sous le modèle résolu, remboursement sur échec upstream).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTranscriptionModel } from '../../../functions/api/ai/whisper-proxy'
import {
  computeCostMicroUsd,
  hasKnownPricing,
} from '../../../functions/api/_lib/pricing'

const src = readFileSync(resolve(process.cwd(), 'functions/api/ai/whisper-proxy.ts'), 'utf8')

describe('resolveTranscriptionModel — allowlist (C4, RÈGLE 6)', () => {
  it('accepte les deux modèles de la boucle client', () => {
    expect(resolveTranscriptionModel('gpt-4o-transcribe')).toBe('gpt-4o-transcribe')
    expect(resolveTranscriptionModel('whisper-1')).toBe('whisper-1')
  })

  it('champ absent ou vide → défaut whisper-1 (compat anciens clients)', () => {
    expect(resolveTranscriptionModel(null)).toBe('whisper-1')
    expect(resolveTranscriptionModel(undefined)).toBe('whisper-1')
    expect(resolveTranscriptionModel('')).toBe('whisper-1')
  })

  it('modèle arbitraire → null (400 sans forward — ferme le trou de relais)', () => {
    expect(resolveTranscriptionModel('gpt-4o')).toBeNull()
    expect(resolveTranscriptionModel('gpt-4o-mini-transcribe')).toBeNull()
    expect(resolveTranscriptionModel('davinci-002')).toBeNull()
  })

  it('valeur non-string (File du FormData) → null', () => {
    expect(resolveTranscriptionModel(new Blob(['x']))).toBeNull()
    expect(resolveTranscriptionModel(42)).toBeNull()
  })
})

describe('whisper-proxy — câblage (gardes par source)', () => {
  it('lit le modèle DU BODY forwardé (clone du multipart), pas d’un header', () => {
    expect(src).toMatch(/request\.clone\(\)\.formData\(\)/)
    expect(src).not.toMatch(/x-transcribe-model/)
  })

  it('quota ET coût utilisent le modèle résolu — plus aucun hardcode whisper-1 aux points de traçage', () => {
    expect(src).toMatch(/consumeDailyQuota\(env, email, transcribeModel\)/)
    expect(src).toMatch(/recordUsage\(env, email, transcribeModel, usage\)/)
  })

  it('rembourse le quota sur échec upstream (invariant C3/C4 « consommé ⟺ servi »)', () => {
    expect(src).toMatch(/voidDailyQuota\(env, email, dailyConsumedModel\)/)
  })
})

describe('pricing gpt-4o-transcribe (C4)', () => {
  it('a une entrée connue au même équivalent minute que whisper-1', () => {
    expect(hasKnownPricing('gpt-4o-transcribe')).toBe(true)
    const NO_TOKENS = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      audioSeconds: 60,
    }
    // 1 minute ≈ $0.006 → 6000 micro-USD, identique pour les deux modèles.
    expect(computeCostMicroUsd('gpt-4o-transcribe', NO_TOKENS)).toBe(6000)
    expect(computeCostMicroUsd('whisper-1', NO_TOKENS)).toBe(6000)
  })
})
