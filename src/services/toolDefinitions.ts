import { computerToolDefinitions } from './tools/computerTools'
import { calendarToolDefinitions } from './tools/calendarTools'
import { wordpressToolDefinitions } from './tools/wordpressTools'
import { utilityToolDefinitions } from './tools/utilityTools'
import { nativeToolDefinitions } from './tools/nativeTools'
import { trailToolDefinitions } from './tools/trailTools'

export function buildToolDefinitions() {
  return [
  ...utilityToolDefinitions,
  ...trailToolDefinitions,
  ...computerToolDefinitions,
  ...calendarToolDefinitions,
  ...wordpressToolDefinitions,
  ...nativeToolDefinitions,
  // Server-side tools (handled by Anthropic API, no local executor)
  {
    // Variante directe compatible avec Haiku 4.5 comme avec Sonnet. Le
    // fact-check Sonnet utilise séparément la variante dynamique 20260318.
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  } as any,
  {
    // ⚠️ NE PAS ajouter `allowed_callers` ici. Ce champ appartient au
    // programmatic tool calling des outils CUSTOM (seule valeur valide :
    // ['code_execution_20260120']) et n'existe PAS dans le contrat de
    // web_fetch. Envoyé quand même, Anthropic répond 400 sur TOUT appel
    // Claude — bug latent du 14 juillet (#344) resté invisible parce que le
    // routeur envoie par défaut sur Gemini ; il a fait surface le 9 août dès
    // que les requêtes mail ont été correctement routées vers Claude.
    // Le `as any` ci-dessous neutralise le typecheck : c'est
    // serverToolContract.test.ts qui garde ce contrat, pas le compilateur.
    type: 'web_fetch_20260209',
    name: 'web_fetch',
  } as any,
  ]
}

export const TOOLS = buildToolDefinitions()
