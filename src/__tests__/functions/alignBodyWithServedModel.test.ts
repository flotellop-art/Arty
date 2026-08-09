import { describe, expect, it } from 'vitest'
import { alignBodyWithServedModel } from '../../../functions/api/ai/proxy'

// Terrain 9 août 2026 — HTTP 400 sur toute requête où le modèle SERVI diffère
// du modèle DEMANDÉ. Le client construit `thinking`/`output_config` et le tool
// set d'après le modèle demandé (anthropicClient : effortActive = !isHaiku) ;
// quand le proxy substitue Haiku (plan trial, plan verrouillé, wallet), ces
// champs restent dans le corps et Haiku les refuse. Seul le proxy connaît le
// modèle final : c'est lui qui doit aligner le payload.

const SONNET_BODY = JSON.stringify({
  model: 'claude-sonnet-5',
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
    for (const model of ['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8']) {
      expect(alignBodyWithServedModel(SONNET_BODY, model)).toBe(SONNET_BODY)
    }
  })

  it('laisse le corps inchangé s’il est illisible (jamais de crash)', () => {
    expect(alignBodyWithServedModel('not json', 'claude-haiku-4-5-20251001')).toBe('not json')
  })

  it('est idempotent : un corps déjà aligné est renvoyé tel quel', () => {
    const once = alignBodyWithServedModel(SONNET_BODY, 'claude-haiku-4-5-20251001')
    expect(alignBodyWithServedModel(once, 'claude-haiku-4-5-20251001')).toBe(once)
  })
})
