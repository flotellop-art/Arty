import { describe, expect, it } from 'vitest'
import { alignBodyWithServedModel } from '../../../functions/api/ai/proxy'

// Terrain 9 août 2026 — HTTP 400 sur toute requête où le modèle SERVI diffère
// du modèle DEMANDÉ. Le client construit `thinking`/`output_config` et le tool
// set d'après le modèle demandé (anthropicClient : effortActive = !isHaiku) ;
// quand le proxy substitue Haiku (plan trial, plan verrouillé, wallet), ces
// champs restent dans le corps et Haiku les refuse. Seul le proxy connaît le
// modèle final : c'est lui qui doit aligner le payload.

const SONNET_BODY = JSON.stringify({
  model: 'claude-sonnet-5-5',
  max_tokens: 120000,
  thinking: { type: 'adaptive' },
  output_config: { effort: 'high' },
  tools: [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    { type: 'web_fetch_20260209', name: 'web_fetch' },
    { name: 'get_recent_mail', description: 'x', input_schema: { type: 'object', properties: {} } },
  ],
  messages: [{ role: 'user', content: 'Mes derniers mails' }],
})

describe('alignBodyWithServedModel — payload compatible avec le modèle servi', () => {
  it('keeps 5.5 reasoning and web tools, removes sampling and bounds output', () => {
    const out = JSON.parse(alignBodyWithServedModel(JSON.stringify({
      ...JSON.parse(SONNET_BODY), max_tokens: 200000, temperature: 0.7, top_p: 1, top_k: 20,
    }), 'claude-haiku-5-5'))
    expect(out.thinking).toEqual({ type: 'adaptive' })
    expect(out.output_config).toEqual({ effort: 'high' })
    expect(out.tools).toEqual(JSON.parse(SONNET_BODY).tools)
    expect(out.max_tokens).toBe(128000)
    for (const key of ['temperature', 'top_p', 'top_k']) expect(out).not.toHaveProperty(key)
  })
  it('sets 5.5 low explicitly, preserves disabled and bills only 5m cache writes', () => {
    const source = { model: 'claude-haiku-5-5', thinking: { type: 'disabled' },
      system: [{ type: 'text', text: 'System', cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'unchanged' }] }],
    }
    const once = alignBodyWithServedModel(JSON.stringify(source), source.model)
    const out = JSON.parse(once)
    expect(out.thinking).toEqual({ type: 'disabled' }); expect(out.output_config).toEqual({ effort: 'low' })
    expect(out.system[0].cache_control.ttl).toBe('5m')
    expect(out.messages).toEqual(source.messages)
    expect(alignBodyWithServedModel(once, source.model)).toBe(once)
  })
  it('normalizes nested tool result/document cache TTL without rewriting tool input', () => {
    const cache_control = { type: 'ephemeral', ttl: '1h' }
    const body = { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't',
      content: [{ type: 'text', text: 'Tool result', cache_control },
        { type: 'document', source: { type: 'content', content: [{ type: 'text', text: 'Doc', cache_control }] } }] }] }],
      tools: [{ name: 'test', input_schema: { properties: { cache_control } } }],
    }
    const out = JSON.parse(alignBodyWithServedModel(JSON.stringify(body), 'claude-haiku-5-5'))
    expect(out.messages[0].content[0].content[0].cache_control.ttl).toBe('5m')
    expect(out.messages[0].content[0].content[1].source.content[0].cache_control.ttl).toBe('5m')
    expect(out.tools).toEqual(body.tools)
  })
  it('retire thinking et output_config quand Haiku est servi', () => {
    const out = JSON.parse(alignBodyWithServedModel(SONNET_BODY, 'claude-haiku-4-5-20251001'))
    expect(out.thinking).toBeUndefined()
    expect(out.output_config).toBeUndefined()
  })

  it('retire le server tool web_fetch non supporté par Haiku, garde web_search', () => {
    const out = JSON.parse(alignBodyWithServedModel(SONNET_BODY, 'claude-haiku-4-5-20251001'))
    const types = out.tools.map((t: { type?: string }) => t.type)
    expect(types).not.toContain('web_fetch_20260209')
    expect(types).toContain('web_search_20250305')
  })

  it('conserve les outils applicatifs, dont les outils mail', () => {
    const out = JSON.parse(alignBodyWithServedModel(SONNET_BODY, 'claude-haiku-4-5-20251001'))
    expect(out.tools.some((t: { name?: string }) => t.name === 'get_recent_mail')).toBe(true)
  })

  it('cape max_tokens à la limite Haiku', () => {
    const out = JSON.parse(alignBodyWithServedModel(SONNET_BODY, 'claude-haiku-4-5-20251001'))
    expect(out.max_tokens).toBe(64000)
  })

  it('préserve les messages intacts', () => {
    const out = JSON.parse(alignBodyWithServedModel(SONNET_BODY, 'claude-haiku-4-5-20251001'))
    expect(out.messages).toEqual([{ role: 'user', content: 'Mes derniers mails' }])
  })

  it('ne touche à RIEN quand le modèle servi n’est pas Haiku', () => {
    for (const model of ['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-opus-4-8']) {
      expect(alignBodyWithServedModel(SONNET_BODY, model)).toBe(SONNET_BODY)
    }
  })

  it('laisse le corps inchangé s’il est illisible (jamais de crash)', () => {
    expect(alignBodyWithServedModel('not json', 'claude-haiku-4-5-20251001')).toBe('not json')
  })

  it('also strips Sonnet 5.5 between_tools when trial serves Haiku', () => {
    const body = JSON.stringify({ ...JSON.parse(SONNET_BODY), thinking: { type: 'between_tools' }, output_config: { effort: 'medium' } })
    const out = JSON.parse(alignBodyWithServedModel(body, 'claude-haiku-4-5-20251001'))
    expect(out.thinking).toBeUndefined(); expect(out.output_config).toBeUndefined()
  })

  it('est idempotent : un corps déjà aligné est renvoyé tel quel', () => {
    const once = alignBodyWithServedModel(SONNET_BODY, 'claude-haiku-4-5-20251001')
    expect(alignBodyWithServedModel(once, 'claude-haiku-4-5-20251001')).toBe(once)
  })
})
