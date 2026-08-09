import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../services/toolDefinitions'

// ─────────────────────────────────────────────────────────────────────────────
// Contrat des SERVER TOOLS Anthropic (terrain 9 août 2026).
//
// Les outils serveur sont déclarés avec `as any` — le compilateur ne voit donc
// RIEN. Un champ inventé y survit silencieusement jusqu'à ce qu'Anthropic
// réponde 400 sur tous les appels Claude. C'est exactement ce qui s'est
// produit avec `allowed_callers: ['direct']` sur web_fetch, posé le 14 juillet
// (#344) et resté invisible trois semaines parce que le routeur envoie par
// défaut sur Gemini : seules les requêtes réellement routées vers Claude
// touchaient le bug.
//
// Ce test remplace le typecheck absent : allowlist EXACTE des champs par type
// d'outil. Ajouter un champ non listé = CI rouge, décision consciente exigée.
// ─────────────────────────────────────────────────────────────────────────────

// Champs communs à tout server tool + champs propres à chaque type.
const COMMON_FIELDS = ['type', 'name', 'cache_control']

const ALLOWED_FIELDS_BY_TYPE: Record<string, string[]> = {
  web_search_20250305: [
    ...COMMON_FIELDS,
    'max_uses',
    'allowed_domains',
    'blocked_domains',
    'user_location',
  ],
  web_fetch_20260209: [
    ...COMMON_FIELDS,
    'max_uses',
    'allowed_domains',
    'blocked_domains',
    'citations',
    'max_content_tokens',
  ],
}

const serverTools = TOOLS.filter((t): t is { type: string; name: string } =>
  typeof (t as { type?: unknown }).type === 'string'
)

describe('contrat des server tools Anthropic', () => {
  it('déclare au moins un server tool (sinon le test ne garde rien)', () => {
    expect(serverTools.length).toBeGreaterThan(0)
  })

  it('chaque type de server tool est connu et documenté ici', () => {
    for (const tool of serverTools) {
      expect(
        ALLOWED_FIELDS_BY_TYPE[tool.type],
        `Type de server tool inconnu : ${tool.type}. Ajoute son allowlist de champs ` +
          "d'après la documentation Anthropic avant de le déclarer."
      ).toBeDefined()
    }
  })

  it('aucun champ hors contrat (le compilateur ne peut pas le voir — as any)', () => {
    for (const tool of serverTools) {
      const allowed = ALLOWED_FIELDS_BY_TYPE[tool.type] ?? []
      const unexpected = Object.keys(tool).filter((key) => !allowed.includes(key))
      expect(
        unexpected,
        `${tool.name} (${tool.type}) porte des champs hors contrat : ${unexpected.join(', ')}. ` +
          'Anthropic répond 400 sur TOUS les appels Claude si un champ inconnu est envoyé.'
      ).toEqual([])
    }
  })

  it('web_fetch ne porte JAMAIS allowed_callers (régression du 9 août)', () => {
    const webFetch = serverTools.find((t) => t.name === 'web_fetch')
    expect(webFetch).toBeDefined()
    expect(
      'allowed_callers' in (webFetch as object),
      "allowed_callers appartient au programmatic tool calling des outils custom " +
        "(valeur valide : ['code_execution_20260120']), jamais à web_fetch."
    ).toBe(false)
  })

  it('les server tools ne portent pas de champs d’outil custom', () => {
    for (const tool of serverTools) {
      for (const customField of ['input_schema', 'description', 'allowed_callers']) {
        expect(customField in (tool as object), `${tool.name} ne doit pas porter ${customField}`).toBe(false)
      }
    }
  })
})
