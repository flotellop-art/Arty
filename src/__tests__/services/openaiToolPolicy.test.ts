// Périmètre d'outils OpenAI (10 août 2026) — test de PARITÉ, pattern F-16.
//
// `buildOpenAIToolList` est une allowlist FAIL-CLOSED : un outil non classé
// n'est simplement pas envoyé. Le risque n'est donc pas la fuite accidentelle,
// c'est l'oubli silencieux (« pourquoi ChatGPT ne sait pas faire ça ? ») et,
// à l'inverse, l'élargissement inconscient de la surface US. Ce test force à
// CLASSER chaque outil déclaré au LLM : exposé (avec sa raison d'innocuité)
// ou bloqué (avec le motif). Ajouter un tool dans toolDefinitions.ts sans le
// classer ici FAIT ÉCHOUER LA CI.
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../services/toolDefinitions'
import {
  buildOpenAIToolList,
  OPENAI_ALLOWED_TOOLS,
  OPENAI_BLOCKED_TOOLS,
} from '../../services/tools/openaiToolPolicy'

// Les server tools Anthropic (web_search/web_fetch natifs) n'ont ni
// description ni input_schema : ils sont filtrés par convertToolsToOpenAI et
// ne concernent pas cette politique.
const CUSTOM_TOOL_NAMES = (TOOLS as Array<{ name: string; description?: string; input_schema?: unknown }>)
  .filter((t) => t.description && t.input_schema)
  .map((t) => t.name)

describe('politique d\'outils OpenAI — parité', () => {
  it('chaque outil déclaré au LLM est classé exposé OU bloqué, jamais les deux', () => {
    for (const name of CUSTOM_TOOL_NAMES) {
      const allowed = Object.prototype.hasOwnProperty.call(OPENAI_ALLOWED_TOOLS, name)
      const blocked = Object.prototype.hasOwnProperty.call(OPENAI_BLOCKED_TOOLS, name)
      expect(
        allowed || blocked,
        `Outil « ${name} » non classé pour OpenAI : ajoute-le à OPENAI_ALLOWED_TOOLS (avec sa raison d'innocuité) ou à OPENAI_BLOCKED_TOOLS (avec le motif du refus) dans openaiToolPolicy.ts`,
      ).toBe(true)
      expect(allowed && blocked, `Outil « ${name} » classé deux fois`).toBe(false)
    }
  })

  it('chaque classement porte une justification écrite non vide', () => {
    for (const [name, reason] of [...Object.entries(OPENAI_ALLOWED_TOOLS), ...Object.entries(OPENAI_BLOCKED_TOOLS)]) {
      expect(reason.trim().length, `Justification vide pour « ${name} »`).toBeGreaterThan(10)
    }
  })

  it('les outils sensibles restent hors de portée d\'OpenAI (US)', () => {
    const names = buildOpenAIToolList({ webSearch: true }).map((t) => t.function.name)
    for (const forbidden of [
      // Données Google privées (BUG 12)
      'list_calendar', 'create_calendar_event', 'update_calendar_event', 'delete_calendar_event',
      // Appareil de l'utilisateur
      'list_local_files', 'read_local_file', 'save_local_file', 'delete_local_file', 'share',
      // Contrôle machine
      'open_app', 'screenshot_pc', 'create_app',
      // Publication sur le site de l'utilisateur
      'wp_create_post', 'wp_update_post', 'wp_delete_post', 'wp_list_posts',
      // Mémoire persistante + position GPS
      'update_memory', 'get_weather', 'calculate_distance',
    ]) {
      expect(names, `« ${forbidden} » ne doit pas être exposé à OpenAI`).not.toContain(forbidden)
    }
  })

  it('expose bien les outils web qui corrigent le bug « Ouvre le lien »', () => {
    const names = buildOpenAIToolList({ webSearch: true }).map((t) => t.function.name)
    expect(names).toContain('fetch_url')
    expect(names).toContain('web_search')
  })

  it('webSearch:false retire la recherche publique mais garde fetch_url', () => {
    const names = buildOpenAIToolList({ webSearch: false }).map((t) => t.function.name)
    expect(names).not.toContain('web_search')
    expect(names).toContain('fetch_url')
  })

  it('aucun nom de tool en double (un doublon = 400 sur toute la route)', () => {
    const names = buildOpenAIToolList({ webSearch: true }).map((t) => t.function.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('tout outil exposé porte bien un schéma de paramètres exploitable', () => {
    for (const tool of buildOpenAIToolList({ webSearch: true })) {
      expect(tool.type).toBe('function')
      expect(tool.function.description.length).toBeGreaterThan(10)
      expect(tool.function.parameters).toBeTruthy()
    }
  })
})
