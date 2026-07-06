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
})
