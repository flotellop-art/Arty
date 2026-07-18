// C1 (CDC veille 2026-07) : PREMIER test du client Gemini — la cartographie
// avait relevé qu'aucun test ne gardait ni le modèle par défaut ni le
// killswitch. Pattern « garde par source » (comme factCheckEndpoint.test.ts) :
// geminiChatModel() n'est pas exporté, et c'est la présence des bons littéraux
// qui protège contre les régressions silencieuses.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const client = readFileSync(resolve(process.cwd(), 'src/services/geminiClient.ts'), 'utf8')
const catalog = readFileSync(
  resolve(process.cwd(), 'src/services/comparator/providerCatalog.ts'),
  'utf8'
)

describe('geminiClient — modèles et killswitch (C1)', () => {
  it('le chat par défaut est gemini-3.5-flash (famille 2.5 arrêtée par Google le 16/10/2026)', () => {
    expect(client).toMatch(/const GEMINI_CHAT_MODEL = 'gemini-3\.5-flash'/)
    expect(client).toMatch(/const GEMINI_RESEARCH_MODEL = 'gemini-3\.5-flash'/)
  })

  it("aucun modèle de la famille 2.5 n'est routable par le client", () => {
    // Les entrées 2.5 survivent dans pricing/costTracker (coûts historiques)
    // mais le CLIENT ne doit plus jamais en demander un.
    expect(client).not.toMatch(/'gemini-2\.5[^']*'/)
  })

  it('le killswitch arty-gemini-cheap-disabled reste câblé (rollback du futur downgrade éco)', () => {
    // Inerte aujourd'hui (chat == recherche) mais le câblage doit survivre :
    // c'est le mécanisme de rollback sans redéploiement du prochain downgrade
    // (pattern P1.4). Sa suppression exige une décision écrite.
    expect(client).toMatch(/arty-gemini-cheap-disabled/)
    expect(client).toMatch(/function geminiChatModel\(\)/)
  })

  it('le comparateur ne propose plus aucun modèle 2.5 (404 garantis après le 16/10/2026)', () => {
    expect(catalog).not.toMatch(/modelId: 'gemini-2\.5[^']*'/)
    // Les deux survivants GA restent proposés.
    expect(catalog).toMatch(/modelId: 'gemini-3\.5-flash'/)
    expect(catalog).toMatch(/modelId: 'gemini-3\.1-flash-lite'/)
  })

  it("aucun ID preview Gemini n'est exposé au comparateur (anti-objectif)", () => {
    expect(catalog).not.toMatch(/modelId: 'gemini[^']*preview[^']*'/)
  })
})
