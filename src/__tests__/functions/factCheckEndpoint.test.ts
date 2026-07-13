// Test de garde PR C-F (CDC visibilité modèle, décision D5) — « aucun appel
// de fond ne consomme le bucket premium ». Le commentaire d'avertissement de
// memory-extract n'a pas suffi (le piège s'est reproduit 3 fois : brief
// proactif, fact-checker, compresseur) : on verrouille par test source, même
// pattern que computerUseSafety.test.ts.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(process.cwd(), 'functions/api/ai/fact-check.ts'), 'utf8')

describe('endpoint fact-check — hors quotas utilisateur (C-F/D5)', () => {
  it('ne touche NI le cap premium NI le quota journalier utilisateur', () => {
    expect(src).not.toMatch(/checkPremiumCap/)
    expect(src).not.toMatch(/consumeDailyQuota/)
    expect(src).not.toMatch(/enforceDailyQuota/)
  })

  it('résout le plan via checkAllowedUserPeek (inclut le bypass whitelist VIP — revue Opus)', () => {
    // resolveUserPlan seul ignore ALLOWED_EMAILS → faux-blocage 403 des
    // bêta-testeurs VIP à chaque fact-check.
    expect(src).toMatch(/checkAllowedUserPeek\(/)
  })

  it('a son propre plafond de fond atomique par palier', () => {
    expect(src).toMatch(/consumeCapAtomic/)
    expect(src).toMatch(/fact-check-haiku/)
    expect(src).toMatch(/fact-check-sonnet/)
  })

  it('fixe le prompt système côté serveur (pas de proxy Claude générique)', () => {
    expect(src).toMatch(/const SYSTEM_PROMPT = /)
  })

  // Le bump maxTokens/max_uses de juillet 2026 (fiabilité + audace) a doublé
  // le coût worst-case PAR VÉRIFICATION — les caps journaliers par palier
  // sont donc devenus LE contrôle de coût. Les remonter exige une décision
  // écrite de Florent (RÈGLE 6, abus infra).
  it('garde les plafonds journaliers 60 Haiku / 15 Sonnet (le vrai contrôle de coût)', () => {
    expect(src).toMatch(/dailyCap: 60/)
    expect(src).toMatch(/dailyCap: 15/)
  })

  it('masque les erreurs upstream (pattern V-4) — y compris sur le chemin retry', () => {
    // Le corps d'erreur Anthropic ne doit jamais être relayé au client.
    expect(src).toMatch(/fact_check_failed/)
    expect(src).not.toMatch(/err\.message/)
  })

  it('le retry vit côté serveur, APRÈS la consommation du quota (jamais côté client)', () => {
    // Un retry client re-consommerait bg_quota à chaque tentative.
    expect(src).toMatch(/fetchAnthropicWithRetry/)
  })
})
