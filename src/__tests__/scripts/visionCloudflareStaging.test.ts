// @vitest-environment node
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest as apiMiddleware } from '../../../functions/api/_middleware'
import { validateOpenAIVisionPayload } from '../../../functions/api/_lib/openaiVision'
import { validateOpenAIVisionStream } from '../../../functions/api/_lib/openaiVisionStream'
// @ts-expect-error Le générateur exécutable reste volontairement en ESM natif.
import {
  buildFixture,
  drainSuccess,
  inspectPng,
  paddedPng,
  parseArgs,
  requestHeadersForPath,
  runScenario,
  validateExecuteOptions,
  validateProtocolMatrix,
  verifyAccessBoundary,
  writeReport,
} from '../../../scripts/bench-vision-cloudflare-staging.mjs'

function bodyStream(body: string, chunkBytes = 64 * 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(body)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const end = Math.min(bytes.length, offset + chunkBytes)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

const ACCESS_ENV = {
  ARTY_A11_GOOGLE_TOKEN: 'google-test-token',
  ARTY_A11_CF_ACCESS_CLIENT_ID: 'access-id',
  ARTY_A11_CF_ACCESS_CLIENT_SECRET: 'access-secret',
}

function sseResponse(promptTokens = 455): Response {
  return new Response([
    'data: {"model":"gpt-5.6-terra","choices":[{"delta":{"content":"ok"}}]}',
    '',
    `data: {"model":"gpt-5.6-terra","choices":[],"usage":{"prompt_tokens":${promptTokens},"completion_tokens":1}}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n'), { status: 200 })
}

describe('générateur staging Cloudflare A11', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('produit la charge exacte de 4 × 4 Mio, décodable et acceptée par les deux validateurs', async () => {
    const fixture = buildFixture()
    expect(fixture.imageCount).toBe(4)
    expect(fixture.imageBytes).toBe(4 * 1024 * 1024)
    expect(fixture.bodyBytes).toBeLessThan(24 * 1024 * 1024)
    expect(fixture.imagePatchTokens).toBe(4)
    expect(fixture.inspections).toHaveLength(4)
    expect(fixture.inspections).toEqual(expect.arrayContaining([
      expect.objectContaining({ width: 32, height: 32, decodedBytes: 1056 }),
    ]))

    const payload = JSON.parse(fixture.body) as unknown
    expect(validateOpenAIVisionPayload(payload)).toMatchObject({
      ok: true,
      imageCount: 4,
      totalBytes: 16 * 1024 * 1024,
      validatedImageTokens: 4,
    })
    const streamed = await validateOpenAIVisionStream(bodyStream(fixture.body), 24 * 1024 * 1024)
    expect(streamed).toMatchObject({
      ok: true,
      imageCount: 4,
      totalBytes: 16 * 1024 * 1024,
      requestBytes: fixture.bodyBytes,
      validatedImageTokens: 4,
      maxCompletionTokens: 1,
    })
    if (streamed.ok) expect(streamed.validatedInputTokens).toBeLessThan(1_000)
  }, 30_000)

  it('contrôle CRC, structure et décompression du PNG avant envoi', () => {
    const bytes = paddedPng(128 * 1024, 7, 32) as Buffer
    expect(inspectPng(bytes)).toMatchObject({ width: 32, height: 32, colorType: 0 })

    const corrupted = Buffer.from(bytes)
    corrupted[corrupted.length - 1] ^= 0x01
    expect(() => inspectPng(corrupted)).toThrow(/CRC/)
  })

  it('refuse les hôtes prod/preview partagé et exige l’acquittement staging', () => {
    const base = {
      ...parseArgs([]),
      execute: true,
      mode: 'campaign',
      endpoint: 'https://a1b2c3d4.arty-vision-a11-staging.pages.dev/api/ai/openai-proxy',
      deploymentSha: 'a'.repeat(40),
      deploymentId: 'deployment-id-a11',
      deploymentShortId: 'a1b2c3d4',
      window: 'W1',
      acknowledge: 'arty-vision-a11-staging',
      reportFile: 'artifacts/vision-a11/W1-server-c1.json',
    }
    expect(validateExecuteOptions(base, ACCESS_ENV).hostname)
      .toBe('a1b2c3d4.arty-vision-a11-staging.pages.dev')
    expect(() => validateExecuteOptions({
      ...base,
      endpoint: 'https://agent-vision-a11.appfacade.pages.dev/api/ai/openai-proxy',
    }, ACCESS_ENV)).toThrow(/isolated|production|shared-preview/)
    expect(() => validateExecuteOptions({
      ...base,
      endpoint: 'https://a1b2c3d4.vision-a11.attacker.example/api/ai/openai-proxy',
    }, ACCESS_ENV)).toThrow(/atomic A11/)
    expect(() => validateExecuteOptions({
      ...base,
      endpoint: 'https://a11.arty-vision-a11-staging.pages.dev/api/ai/openai-proxy',
    }, ACCESS_ENV)).toThrow(/atomic A11/)
    expect(() => validateExecuteOptions({ ...base, acknowledge: 'yes' }, ACCESS_ENV))
      .toThrow(/acknowledge/)
    expect(validateExecuteOptions({
      ...base,
      endpoint: undefined,
      mode: 'sentinel',
      path: 'byok-direct',
      concurrencies: [1],
      accepted: 1,
      fixtureDimension: 4096,
      reportFile: 'artifacts/vision-a11/W1-sentinel-byok-direct-4k.json',
    }, { ARTY_A11_OPENAI_BYOK_KEY: 'sk-test' }).hostname).toBe('api.openai.com')
    expect(() => writeReport({}, '../outside.json')).toThrow(/artifacts\/vision-a11/)
  })

  it('fige la matrice de coût et distingue campagne, pilote et sentinelle', () => {
    const campaign = {
      ...parseArgs([]), mode: 'campaign', path: 'server', window: 'W2',
      accepted: 33, concurrencies: [4], fixtureDimension: 32, rpm: 30,
      reportFile: 'artifacts/vision-a11/W2-server-c4.json',
    }
    expect(() => validateProtocolMatrix(campaign)).not.toThrow()
    expect(() => validateProtocolMatrix({ ...campaign, accepted: 330 })).toThrow(/campaign matrix/)
    expect(() => validateProtocolMatrix({
      ...campaign, reportFile: 'artifacts/vision-a11/redo.json',
    })).toThrow(/canonical name/)
    expect(() => validateProtocolMatrix({ ...campaign, concurrencies: [1, 2, 4] })).toThrow(/one --concurrency/)
    expect(() => validateProtocolMatrix({
      ...campaign, mode: 'sentinel', fixtureDimension: 4096, accepted: 1,
    })).toThrow(/sentinel matrix/)
    expect(() => parseArgs([
      '--report-file=artifacts/vision-a11/W1-server-c1.json',
    ])).toThrow(/reserved for an executed/)
  })

  it('envoie une Origin acceptée par le middleware réel sans élargir son allowlist', async () => {
    const headers = requestHeadersForPath('server', ACCESS_ENV)
    expect(headers.origin).toBe('https://tryarty.com')
    const request = new Request(
      'https://a1b2c3d4.arty-vision-a11-staging.pages.dev/api/ai/openai-proxy',
      { method: 'POST', headers, body: '{}' },
    )
    const response = await apiMiddleware({
      request,
      next: async () => new Response('ok', { status: 200 }),
    } as never)
    expect(response.status).toBe(200)
  })

  it('vérifie Access sans exposer les secrets et conserve un échec partiel borné', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(sseResponse(2_001))
    vi.stubGlobal('fetch', fetchMock)
    const endpoint = new URL('https://a1b2c3d4.arty-vision-a11-staging.pages.dev/api/ai/openai-proxy')
    await expect(verifyAccessBoundary(endpoint, ACCESS_ENV, 5_000)).resolves.toEqual({
      unauthenticatedStatus: 302,
      serviceTokenStatus: 200,
    })
    const fixture = buildFixture()
    const scenario = await runScenario({
      options: {
        ...parseArgs([]), mode: 'pilot', path: 'server', window: 'PILOT', accepted: 5,
      },
      concurrency: 1,
      endpoint,
      fixture,
      env: ACCESS_ENV,
    })
    expect(scenario).toMatchObject({
      verdict: 'failed', requested: 1, accepted: 0, failureCode: 'provider_usage_cap_exceeded',
    })
    expect(JSON.stringify(scenario)).not.toContain(ACCESS_ENV.ARTY_A11_GOOGLE_TOKEN)
  }, 30_000)

  it('compte exactement les 200, récupère un vision_busy et borne les tentatives', async () => {
    const fixture = buildFixture()
    const endpoint = new URL('https://a1b2c3d4.arty-vision-a11-staging.pages.dev/api/ai/openai-proxy')
    const options = {
      ...parseArgs([]), mode: 'campaign', path: 'server', window: 'W1',
      accepted: 2, rpm: 1_000_000_000,
    }
    const responses = [
      Response.json({ error: 'vision_busy' }, { status: 429 }),
      sseResponse(),
      sseResponse(),
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(responses.shift())))
    await expect(runScenario({
      options, concurrency: 2, endpoint, fixture, env: ACCESS_ENV,
    })).resolves.toMatchObject({
      verdict: 'measurement_ready', requested: 3, accepted: 2, busy: 1, maxRequests: 4,
    })

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      Response.json({ error: 'vision_busy' }, { status: 429 }),
    )))
    await expect(runScenario({
      options, concurrency: 2, endpoint, fixture, env: ACCESS_ENV,
    })).resolves.toMatchObject({
      verdict: 'failed', requested: 4, accepted: 0, busy: 4,
      failureCode: 'hard_request_cap_exhausted',
    })
  }, 30_000)

  it('draine le SSE complet sans conserver le texte du modèle', async () => {
    const response = sseResponse()
    await expect(drainSuccess(response)).resolves.toMatchObject({
      model: 'gpt-5.6-terra',
      usage: { promptTokens: 455, completionTokens: 1 },
    })
  })
})
