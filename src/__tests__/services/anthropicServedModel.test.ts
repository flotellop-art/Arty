// Test PR C-A (CDC visibilité modèle) — le parser SSE Anthropic extrait le
// modèle CONFIRMÉ par l'API depuis message_start.message.model (F-1/F-2).
// C'est ce champ qui révèle la substitution serveur trial (Sonnet demandé →
// Haiku servi, proxy.ts:131-148) : sans cette lecture, aucun signal ne peut
// jamais corriger le badge ni le cost tracking local. La lecture doit rester
// ADDITIVE : tous les blocs sont poussés tels quels (BUG 52 — aucun filtrage).
import { describe, expect, it } from 'vitest'
import {
  filterAnthropicToolsForRoute,
  parseSSEStream,
  resolveServedSubModelReason,
} from '../../services/anthropicClient'
import { TOOLS } from '../../services/toolDefinitions'

function sseResponse(lines: string[]): Response {
  return new Response(lines.join('\n') + '\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('parseSSEStream — modèle servi (message_start)', () => {
  it('remonte servedModel quand le serveur a substitué le modèle (trial swap)', async () => {
    const response = sseResponse([
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":12,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"salut"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ])

    const tokens: string[] = []
    const result = await parseSSEStream(response, (t) => tokens.push(t))

    expect(result.servedModel).toBe('claude-haiku-4-5-20251001')
    expect(result.inputTokens).toBe(12)
    // BUG 52 — la lecture du modèle est additive : les blocs restent intacts.
    expect(result.contentBlocks).toEqual([{ type: 'text', text: 'salut' }])
    expect(tokens.join('')).toBe('salut')
  })

  it('servedModel reste absent si message_start ne porte pas de modèle', async () => {
    const response = sseResponse([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ])

    const result = await parseSSEStream(response, () => {})
    expect(result.servedModel).toBeUndefined()
  })
})

describe('raison du sous-modèle Claude confirmé', () => {
  it('remplace la raison Sonnet quand le serveur sert réellement Haiku', () => {
    expect(resolveServedSubModelReason(
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
      { code: 'submodel_sonnet_default' },
    )).toEqual({ code: 'server_model_substitution' })
  })

  it('conserve la raison pour un alias daté de la même famille', () => {
    expect(resolveServedSubModelReason(
      'claude-sonnet-5',
      'claude-sonnet-5-20260929',
      { code: 'submodel_sonnet_default' },
    )).toEqual({ code: 'submodel_sonnet_default' })
  })
})

describe('outils Anthropic selon la décision centrale', () => {
  it('retire web_search quand la recherche publique est interdite', () => {
    const filtered = filterAnthropicToolsForRoute(TOOLS, { webSearch: false })
    expect(filtered.some((tool) => tool.name === 'web_search')).toBe(false)
    expect(filtered).toHaveLength(TOOLS.length - 1)
  })

  it('conserve web_search quand le routeur l’autorise', () => {
    expect(filterAnthropicToolsForRoute(TOOLS, { webSearch: true })
      .some((tool) => tool.name === 'web_search')).toBe(true)
  })
})
