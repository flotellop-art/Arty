import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enhancePrompt } from '../../services/promptEnhancer'
vi.mock('../../services/activeApiKey', () => ({ getAnthropicKey: () => 'synthetic-byok', getMistralKey: () => null,
  hasAnthropicKey: () => true, hasMistralKey: () => false }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: async () => null }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/promptEnhancerSettings', () => ({ getEnhancerModel: () => 'haiku' }))
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())
describe('Haiku 5.5 prompt enhancer contract', () => {
  it('uses disabled low within the bounded text budget and selects text after thinking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ stop_reason: 'end_turn',
      content: [{type:'thinking',thinking:'',signature:'synthetic'}, {type:'text',text:'Prompt amélioré.'}] })))
    expect(await enhancePrompt('texte brut')).toBe('Prompt amélioré.')
    const body=JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body).toMatchObject({model:'claude-haiku-5-5',max_tokens:650,thinking:{type:'disabled'},output_config:{effort:'low'}})
    expect(body).not.toHaveProperty('temperature')
  })
  it.each(['max_tokens','refusal','pause_turn','model_context_window_exceeded'])('rejects partial text on %s', async stop_reason => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({stop_reason,content:[{type:'text',text:'Partiel'}]})))
    await expect(enhancePrompt('texte brut')).rejects.toThrow()
  })
})
