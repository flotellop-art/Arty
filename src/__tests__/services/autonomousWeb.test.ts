import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownedAnthropicTools, ownedUrlContext } from '../../services/autonomousWeb'
vi.mock('../../services/pdfUrlFetch', () => ({ fetchUrlMarkdowns: vi.fn() }))
import { fetchUrlMarkdowns } from '../../services/pdfUrlFetch'
afterEach(() => vi.clearAllMocks())
describe('owned client context', () => {
  it('replaces hosted Claude tools, preserving custom tools and private mode', () => {
    const tools = [{ name: 'utility', input_schema: {} }, { type: 'web_search_20250305', name: 'web_search' }, { type: 'web_fetch_20260209', name: 'web_fetch' }]
    const publicTools = ownedAnthropicTools(tools, true)
    expect(publicTools.map(t => t.name)).toEqual(['utility', 'web_search', 'fetch_url'])
    expect(publicTools[1].type).toBeUndefined()
    expect(ownedAnthropicTools(tools, false)).toEqual([tools[0]])
  })
  it('refuses incomplete URL reads before the model, and passes Stop / EU policy', async () => {
    const ctrl = new AbortController()
    vi.mocked(fetchUrlMarkdowns).mockResolvedValue({ block: 'a readable document', unreadable: ['https://example.com/missing'] })
    await expect(ownedUrlContext('Lis https://example.com/missing', ctrl.signal, true)).rejects.toThrow('index Arty')
    expect(fetchUrlMarkdowns).toHaveBeenCalledWith(['https://example.com/missing'], ctrl.signal, 'eu-only')
    vi.mocked(fetchUrlMarkdowns).mockResolvedValue({ block: 'partial batch', unreadable: [], unavailable: ['https://example.com/503'] })
    await expect(ownedUrlContext('Lis https://example.com/503', ctrl.signal)).rejects.toThrow('index Arty')
    ctrl.abort()
    vi.mocked(fetchUrlMarkdowns).mockResolvedValue({ block: 'text', unreadable: [] })
    await expect(ownedUrlContext('https://example.com/missing', ctrl.signal)).rejects.toThrow()
  })
})
