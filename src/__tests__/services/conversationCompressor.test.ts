import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest'

// apiBase importe @capacitor/core ; on le neutralise pour un import propre.
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))
// aiHttp importe googleAuth/emailTrialClient — mêmes mocks qu'aiHttp.test.ts.
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn() }))
vi.mock('../../services/emailTrialClient', () => ({ getTrialToken: vi.fn() }))

import { compressIfNeeded, estimateMessagesTokens, COMPRESSION_THRESHOLD } from '../../services/conversationCompressor'
import { getValidAccessToken } from '../../services/googleAuth'
import { getTrialToken } from '../../services/emailTrialClient'

const mockGoogle = getValidAccessToken as unknown as Mock
const mockTrial = getTrialToken as unknown as Mock

describe('estimateMessagesTokens', () => {
  it('estimates a plain string message ~ length / 3.8 (+ overhead)', () => {
    const content = 'a'.repeat(380) // ~100 tokens
    const tokens = estimateMessagesTokens([{ role: 'user', content }])
    // 380 / 3.8 = 100, plus 10 overhead.
    expect(tokens).toBe(110)
  })

  it('REGRESSION: counts the real text of a tool_result block (not ~4 tokens)', () => {
    // Avant le fix : un tool_result non-string était écrasé en
    // '[contenu multimédia]' (~5 tokens) → context rot. Un corps d'email de
    // 8000 chars doit maintenant peser ~2100 tokens.
    const emailBody = 'mot '.repeat(2000) // 8000 chars
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x', content: emailBody },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    expect(tokens).toBeGreaterThan(1500)
  })

  it('counts text inside tool_result sub-blocks (array form)', () => {
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'x',
            content: [
              { type: 'text', text: 'z'.repeat(3800) }, // ~1000 tokens
            ],
          },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    expect(tokens).toBeGreaterThan(900)
    expect(tokens).toBeLessThan(1100)
  })

  it('ANTI-THRASH: counts a base64 document block at a small nominal, NOT its full size', () => {
    // Un PDF de 5 Mo en base64 = ~5M chars. Le compter en entier
    // (~1,3M tokens) déclencherait une compression Sonnet à chaque tour.
    const hugeBase64 = 'A'.repeat(5_000_000)
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'x',
            content: [
              { type: 'text', text: 'Voici le PDF' },
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: hugeBase64 } },
            ],
          },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    // Doit rester petit (poids nominal ~2000), très loin des centaines de
    // milliers qu'un comptage base64 produirait.
    expect(tokens).toBeLessThan(5000)
  })

  it('counts a top-level document block (user attachment) at nominal weight', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyse ce doc' },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'A'.repeat(1_000_000) } },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    expect(tokens).toBeLessThan(5000)
  })

  it('exposes a sane threshold constant', () => {
    expect(COMPRESSION_THRESHOLD).toBe(80000)
  })
})

// ── compressIfNeeded — headers d'auth vers le proxy (fix garde BUG 25) ────────
//
// Avant le fix, le résumeur envoyait `x-api-key: apiKey` brut (sentinelle
// 'server-provided' incluse) et AUCUN x-google-token → le proxy rejetait en
// 401 (resolveProxyIdentity, anti-relais CRIT-2/4) → catch silencieux → la
// compression ne fonctionnait pour personne. Ces tests verrouillent le
// passage par buildAiHeaders (C9).

// 25 messages × 20 000 chars ≈ 131k tokens estimés — franchit largement le
// seuil de 80k ET la condition messages.length > KEEP_RECENT + 2.
function buildHugeConversation() {
  return Array.from({ length: 25 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i} ` + 'x'.repeat(20_000),
  }))
}

// Réponse SSE minimale du proxy (le résumé passe en stream:true — audit Opus #1 :
// le tee de tracking du proxy ne lit que du SSE, un JSON brut = 0 token facturé).
function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const text of chunks) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n`))
      }
      c.enqueue(enc.encode('data: {"type":"message_stop"}\n'))
      c.close()
    },
  })
}

function mockProxyOk(): Mock {
  const fetchMock = vi.fn().mockImplementation(async () => ({
    ok: true,
    body: sseBody(['Résumé : montant 12 340 €, ', 'décision X.']),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('compressIfNeeded — auth headers (BUG 25 + anti-relais)', () => {
  beforeEach(() => {
    mockGoogle.mockReset(); mockTrial.mockReset()
    mockGoogle.mockResolvedValue('gtok'); mockTrial.mockReturnValue(null)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("sentinelle 'server-provided' → PAS de x-api-key, x-google-token présent", async () => {
    const fetchMock = mockProxyOk()
    const result = await compressIfNeeded(buildHugeConversation(), undefined, 'server-provided')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers['x-google-token']).toBe('gtok')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    // stream:true obligatoire — le tracking usage/wallet du proxy est SSE-only.
    expect(JSON.parse(String(init.body)).stream).toBe(true)
    // La compression a bien eu lieu (résumé + assistant + 20 récents),
    // texte SSE réassemblé depuis les deltas.
    expect(result.length).toBe(22)
    expect(String(result[0]!.content)).toContain('Résumé : montant 12 340 €, décision X.')
  })

  it('signal déjà aborté (stop utilisateur) → messages originaux', async () => {
    mockProxyOk()
    const messages = buildHugeConversation()
    const ctrl = new AbortController()
    ctrl.abort()
    const result = await compressIfNeeded(messages, undefined, 'sk-key', ctrl.signal)
    expect(result).toBe(messages)
  })

  it('vraie clé BYOK → x-api-key transmise ET x-google-token (anti-relais)', async () => {
    const fetchMock = mockProxyOk()
    await compressIfNeeded(buildHugeConversation(), undefined, 'sk-ant-real-key')

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-real-key')
    expect(headers['x-google-token']).toBe('gtok')
  })

  it('échec proxy (401) → messages originaux, jamais de throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    vi.stubGlobal('fetch', fetchMock)
    const messages = buildHugeConversation()
    const result = await compressIfNeeded(messages, undefined, 'server-provided')
    expect(result).toBe(messages)
  })

  it('sous le seuil → aucun appel réseau', async () => {
    const fetchMock = mockProxyOk()
    const messages = [{ role: 'user', content: 'court' }]
    const result = await compressIfNeeded(messages, undefined, 'sk-key')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toBe(messages)
  })
})
