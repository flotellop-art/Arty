// Bug live APK (14 juillet 2026) — « Planifie un RDV demain 14h » : la réponse
// complète s'affichait mais « Arty écrit… » + bouton Stop tournaient pour
// toujours. Cause : parseSSEStream ne sortait de sa boucle de lecture QUE sur
// la fermeture TCP (`done`), jamais sur l'event terminal `message_stop`
// d'Anthropic, et sans aucun timeout d'inactivité. Sur un réseau mobile qui
// meurt en silence (connexion half-open, pas de RST), reader.read() pendait
// indéfiniment → ni onDone ni onError → stream fantôme éternel.
// Ces tests simulent la connexion half-open avec un ReadableStream qui
// n'appelle JAMAIS controller.close().
import { describe, expect, it } from 'vitest'
import { parseSSEStream } from '../../services/anthropicClient'

const encoder = new TextEncoder()

/** Réponse SSE dont la connexion ne se ferme jamais (half-open simulé). */
function neverClosingResponse(lines: string[], onCancel?: () => void): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (lines.length > 0) {
        controller.enqueue(encoder.encode(lines.join('\n') + '\n'))
      }
      // Pas de controller.close() — c'est le point du test.
    },
    cancel() {
      onCancel?.()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
}

const FULL_MESSAGE_LINES = [
  'event: message_start',
  'data: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"C\'est fait."}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
]

describe('parseSSEStream — terminaison sans fermeture TCP', () => {
  it('se termine sur message_stop même si la connexion ne se ferme jamais', async () => {
    let cancelled = false
    const response = neverClosingResponse(FULL_MESSAGE_LINES, () => { cancelled = true })

    const tokens: string[] = []
    // Timeout d'inactivité volontairement court : si message_stop ne coupait
    // pas la boucle, ce test échouerait en « stalled » au lieu de résoudre.
    const result = await parseSSEStream(response, (t) => tokens.push(t), 5_000)

    // Rien n'est perdu : message_stop arrive APRÈS message_delta et tous les
    // content_block_stop (BUG 52 — aucun bloc droppé, usage complet).
    expect(tokens.join('')).toBe("C'est fait.")
    expect(result.contentBlocks).toEqual([{ type: 'text', text: "C'est fait." }])
    expect(result.outputTokens).toBe(7)
    expect(result.servedModel).toBe('claude-sonnet-5')
    // La socket half-open est libérée (reader.cancel), pas juste abandonnée.
    expect(cancelled).toBe(true)
  })

  it('rejette via le watchdog d\'inactivité quand le flux meurt avant message_stop', async () => {
    // Texte partiel puis silence total — mort réseau en plein stream.
    const response = neverClosingResponse([
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partiel"}}',
      '',
    ])

    // L'erreur doit être une Error ORDINAIRE (pas un AbortError) : le catch de
    // runWithTools ignore les AbortError — un timeout déguisé en abort ne
    // déclencherait jamais onError et reproduirait le spinner éternel.
    const promise = parseSSEStream(response, () => {}, 50)
    await expect(promise).rejects.toThrow()
    await expect(promise).rejects.not.toMatchObject({ name: 'AbortError' })
  })

  it('reste inchangé sur une fermeture normale de connexion (done)', async () => {
    // Sans message_stop : la sortie historique par `done` doit marcher.
    const response = new Response(
      [
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
      ].join('\n') + '\n',
      { headers: { 'content-type': 'text/event-stream' } }
    )

    const result = await parseSSEStream(response, () => {}, 5_000)
    expect(result.contentBlocks).toEqual([{ type: 'text', text: 'ok' }])
  })
})
