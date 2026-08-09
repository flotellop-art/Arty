import { describe, expect, it } from 'vitest'
import { PRIVATE_DATA_TOOL_NAMES } from '../../hooks/useConversation'
import { mailToolDefinitions } from '../../services/tools/mailTools'

// Parité (revue d'agent, 9 août 2026) — PRIVATE_DATA_TOOL_NAMES est ce qui
// marque une conversation comme contenant des données privées. Ce flag a DEUX
// effets : il verrouille les tours de SUIVI sur Claude (hasPrivateHistory,
// BUG 12) et déclenche l'avertissement renforcé avant un partage public.
// Un outil mail absent de ce Set rouvrait le bug une conversation plus tard :
// « et le mail précédent ? » repartait sur Gemini, sans outil mail.
describe('PRIVATE_DATA_TOOL_NAMES — parité avec les outils mail', () => {
  it('contient TOUS les outils mail déclarés au modèle', () => {
    const missing = mailToolDefinitions
      .map((t) => t.name)
      .filter((name) => !PRIVATE_DATA_TOOL_NAMES.has(name))
    expect(
      missing,
      `Outils mail non marqués comme données privées : ${missing.join(', ')}. ` +
        'Sans ça, les tours de suivi repartent sur un provider sans outil mail ' +
        'et le partage public perd son avertissement renforcé.'
    ).toEqual([])
  })

  it('conserve les outils Google historiques qui font entrer du contenu privé', () => {
    for (const name of ['read_drive_file', 'search_drive', 'list_calendar', 'search_contacts']) {
      expect(PRIVATE_DATA_TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it('ne marque pas les outils publics (web, sentiers, mémoire)', () => {
    for (const name of ['web_search', 'find_trails', 'update_memory', 'get_weather']) {
      expect(PRIVATE_DATA_TOOL_NAMES.has(name)).toBe(false)
    }
  })
})
