import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { arch, platform, release } from 'node:os'
import process from 'node:process'
import { createServer } from 'node:net'
import { deflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { build, version as esbuildVersion } from 'esbuild'
import { Miniflare, NoOpLog } from 'miniflare'

const require = createRequire(import.meta.url)
const MIB = 1024 * 1024
const WORKERS_MEMORY_LIMIT_BYTES = 128 * MIB
const DEFAULT_GATE_BYTES = 96 * MIB
const DEFAULT_CONCURRENCIES = [1, 2, 4]
const DEFAULT_PATHS = ['byok', 'server']
const DEFAULT_REPETITIONS = 5
const MAX_IMAGE_BYTES = 4 * MIB
const MAX_BODY_BYTES = 24 * MIB
const COMPATIBILITY_DATE = '2026-07-01'
const EXPECTED_NODE_MAJOR = 22
const INSPECTOR_COMMAND_TIMEOUT_MS = 10_000
const SCENARIO_TIMEOUT_MS = 30_000

const debug = (...values) => {
  if (process.env.VISION_BENCH_DEBUG === '1') console.error('[vision-preflight]', ...values)
}

function positiveNumber(raw, label) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`)
  return value
}

function parseArgs(argv) {
  const options = {
    concurrencies: DEFAULT_CONCURRENCIES,
    paths: DEFAULT_PATHS,
    repetitions: DEFAULT_REPETITIONS,
    imageBytes: MAX_IMAGE_BYTES,
    gateBytes: DEFAULT_GATE_BYTES,
    sampleDuring: true,
    allowNodeMismatch: false,
  }
  for (const arg of argv) {
    if (arg.startsWith('--concurrency=')) {
      const values = arg.slice('--concurrency='.length).split(',').map((value) => Number.parseInt(value, 10))
      if (values.length === 0 || values.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new Error('--concurrency expects positive integers, for example 1,2,4')
      }
      options.concurrencies = [...new Set(values)]
    } else if (arg.startsWith('--path=')) {
      const values = arg.slice('--path='.length).split(',')
      if (values.length === 0 || values.some((value) => !DEFAULT_PATHS.includes(value))) {
        throw new Error('--path expects byok, server, or both')
      }
      options.paths = [...new Set(values)]
    } else if (arg.startsWith('--repeat=')) {
      const value = Number.parseInt(arg.slice('--repeat='.length), 10)
      if (!Number.isInteger(value) || value <= 0) throw new Error('--repeat expects a positive integer')
      options.repetitions = value
    } else if (arg.startsWith('--image-mib=')) {
      options.imageBytes = Math.floor(positiveNumber(arg.slice('--image-mib='.length), '--image-mib') * MIB)
    } else if (arg.startsWith('--gate-mib=')) {
      options.gateBytes = Math.floor(positiveNumber(arg.slice('--gate-mib='.length), '--gate-mib') * MIB)
    } else if (arg === '--no-sampling') {
      options.sampleDuring = false
    } else if (arg === '--allow-node-mismatch') {
      options.allowNodeMismatch = true
    } else if (arg === '--help') {
      console.log([
        'Usage: npm run bench:vision:workerd -- [options]',
        '',
        '  --concurrency=1,2,4      Scenarios to run (default: 1,2,4)',
        '  --path=byok,server       Proxy paths to run (default: both)',
        '  --repeat=5               Fresh-isolate runs per scenario (default: 5)',
        '  --image-mib=4            Encoded bytes per image (default/max: 4)',
        '  --gate-mib=96            Conservative local preflight threshold',
        '  --no-sampling            Debug only: measure before/after requests',
        '  --allow-node-mismatch    Diagnostic only; canonical runs require Node 22',
      ].join('\n'))
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function withTimeout(promise, timeoutMs, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function writeU32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  return crc >>> 0
})

function crc32(...parts) {
  let crc = 0xffffffff
  for (const part of parts) {
    for (const value of part) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.allocUnsafe(12 + data.length)
  writeU32(chunk, 0, data.length)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  writeU32(chunk, 8 + data.length, crc32(typeBytes, data))
  return chunk
}

/** Build a valid, decodable 4096² grayscale PNG and pad it to an exact size. */
function pngFixture(byteLength, fill) {
  const width = 4096
  const height = 4096
  const rowBytes = width + 1
  const raw = Buffer.alloc(rowBytes * height, fill)
  for (let row = 0; row < height; row += 1) raw[row * rowBytes] = 0

  const ihdr = Buffer.alloc(13)
  writeU32(ihdr, 0, width)
  writeU32(ihdr, 4, height)
  ihdr.set([8, 0, 0, 0, 0], 8)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
  ])
  const iend = pngChunk('IEND', Buffer.alloc(0))
  const paddingBytes = byteLength - header.length - iend.length - 12
  if (paddingBytes < 1) throw new Error(`--image-mib is too small for the valid PNG fixture (${header.length + iend.length + 13} bytes minimum)`)
  const padding = Buffer.alloc(paddingBytes, fill)
  const result = Buffer.concat([header, pngChunk('arTy', padding), iend])
  if (result.length !== byteLength) throw new Error('PNG fixture size mismatch')
  return result.toString('base64')
}

function buildImages(imageBytes) {
  return [1, 2, 3, 4].map((fill) => pngFixture(imageBytes, fill))
}

function visionPayload(images, nonce) {
  return JSON.stringify({
    model: 'gpt-5.6-terra',
    messages: [{
      role: 'user',
      content: [
        ...images.map((base64) => ({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${base64}`, detail: 'original' },
        })),
        { type: 'text', text: `Compare ces quatre photos. [${nonce}]` },
      ],
    }],
    max_completion_tokens: 4096,
    stream: true,
    stream_options: { include_usage: true },
  })
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to allocate inspector port')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function bundleProxyWorker() {
  const entry = `
    import { onRequestPost } from './functions/api/ai/openai-proxy.ts';
    export default {
      fetch(request, env, ctx) {
        return onRequestPost({
          request,
          env,
          waitUntil: (promise) => ctx.waitUntil(promise),
          next: () => Promise.resolve(new Response('Not found', { status: 404 })),
          params: {},
          data: {},
        });
      },
    };
  `
  const result = await build({
    stdin: {
      contents: entry,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'vision-workerd-memory-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  })
  const output = result.outputFiles[0]
  if (!output) throw new Error('esbuild produced no Worker bundle')
  return output.text
}

class InspectorClient {
  constructor(socket, targetId) {
    this.socket = socket
    this.targetId = targetId
    this.nextId = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    })
  }

  command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Inspector ${method} timed out`))
      }, INSPECTOR_COMMAND_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Inspector closed'))
    }
    this.pending.clear()
    this.socket.close()
  }
}

async function connectInspector(port) {
  const targets = await withTimeout(
    fetch(`http://127.0.0.1:${port}/json`).then((response) => {
      if (!response.ok) throw new Error(`Inspector discovery failed: ${response.status}`)
      return response.json()
    }),
    INSPECTOR_COMMAND_TIMEOUT_MS,
    'Inspector discovery',
  )
  const target = targets.find((candidate) => candidate.id === 'core:user:')
  if (!target?.webSocketDebuggerUrl) throw new Error('Exact core:user: Worker inspector target missing')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await withTimeout(new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  }), INSPECTOR_COMMAND_TIMEOUT_MS, 'Inspector WebSocket')
  return new InspectorClient(socket, target.id)
}

function accountedBytes(heap) {
  const values = [heap.usedSize, heap.embedderHeapUsedSize, heap.backingStorageSize]
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Unexpected Runtime.getHeapUsage payload: ${JSON.stringify(heap)}`)
  }
  return values.reduce((sum, value) => sum + value, 0)
}

function mib(bytes) {
  return Math.round((bytes / MIB) * 100) / 100
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function createRuntime(script) {
  const inspectorPort = await freePort()
  let upstreamBytes = 0
  let upstreamCalls = 0
  let activeUpstreams = 0
  let maxActiveUpstreams = 0
  let notifyFirstUpstream
  let releaseUpstreams
  const firstUpstream = new Promise((resolve) => { notifyFirstUpstream = resolve })
  const upstreamBarrier = new Promise((resolve) => { releaseUpstreams = resolve })

  const miniflare = new Miniflare({
    log: new NoOpLog(),
    modules: true,
    script,
    compatibilityDate: COMPATIBILITY_DATE,
    bindings: {
      GOOGLE_CLIENT_ID: 'workerd-benchmark-client',
      OPENAI_VISION_ENABLED: 'true',
      OPENAI_API_KEY: 'sk-server-benchmark',
      ALLOWED_EMAILS: 'vision-workerd@example.test',
    },
    inspectorPort,
    outboundService: async (request) => {
      const url = new URL(request.url)
      if (url.hostname === 'oauth2.googleapis.com') {
        return Response.json({ aud: 'workerd-benchmark-client' })
      }
      if (url.hostname === 'www.googleapis.com') {
        return Response.json({
          email: 'vision-workerd@example.test',
          verified_email: true,
          id: 'vision-workerd-sub',
        })
      }
      if (url.hostname === 'api.openai.com') {
        const body = await request.arrayBuffer()
        upstreamBytes += body.byteLength
        upstreamCalls += 1
        activeUpstreams += 1
        maxActiveUpstreams = Math.max(maxActiveUpstreams, activeUpstreams)
        notifyFirstUpstream()
        await upstreamBarrier
        activeUpstreams -= 1
        return new Response([
          'data: {"choices":[],"usage":{"prompt_tokens":65536,"completion_tokens":1},"model":"gpt-5.6-terra"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return new Response(`Unexpected outbound host: ${url.hostname}`, { status: 502 })
    },
  })

  try {
    await withTimeout(miniflare.ready, SCENARIO_TIMEOUT_MS, 'Miniflare ready')
    const inspector = await connectInspector(inspectorPort)
    return {
      miniflare,
      inspector,
      firstUpstream,
      releaseUpstreams,
      stats: () => ({ upstreamBytes, upstreamCalls, maxActiveUpstreams }),
    }
  } catch (error) {
    releaseUpstreams()
    await miniflare.dispose()
    throw error
  }
}

async function runScenario({ runtime, makePayload, concurrency, pathName, gateBytes, sampleDuring }) {
  const baseline = await runtime.inspector.command('Runtime.getHeapUsage')
  let peak = baseline
  let monitoring = true
  const monitor = sampleDuring ? (async () => {
    while (monitoring) {
      const sample = await runtime.inspector.command('Runtime.getHeapUsage')
      if (accountedBytes(sample) > accountedBytes(peak)) peak = sample
      await sleep(2)
    }
  })() : Promise.resolve()

  const statuses = []
  let settled = 0
  let payloadBytes = 0
  const startedAt = performance.now()
  try {
    const requests = Array.from({ length: concurrency }, (_, requestIndex) => (async () => {
      const payload = makePayload(requestIndex)
      const bytes = Buffer.byteLength(payload)
      if (payloadBytes === 0) payloadBytes = bytes
      else if (payloadBytes !== bytes) throw new Error('Concurrent payload sizes differ')
      const response = await runtime.miniflare.dispatchFetch('https://tryarty.com/api/ai/openai-proxy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(bytes),
          'x-google-token': 'workerd-benchmark-token',
          'x-arty-vision': '1',
          ...(pathName === 'byok' ? { 'x-openai-key': 'sk-local-benchmark' } : {}),
        },
        body: payload,
      })
      const responseBody = await response.text()
      statuses.push(response.status)
      if (response.status !== 200 && response.status !== 429) {
        throw new Error(`Proxy returned ${response.status}: ${responseBody.slice(0, 300)}`)
      }
    })().finally(() => { settled += 1 }))

    await withTimeout(runtime.firstUpstream, SCENARIO_TIMEOUT_MS, 'First OpenAI upstream')
    const expectedBusy = concurrency - 1
    await withTimeout((async () => {
      while (settled < expectedBusy) await sleep(5)
    })(), 5_000, 'Fail-fast concurrent refusals')
    runtime.releaseUpstreams()
    await withTimeout(Promise.all(requests), SCENARIO_TIMEOUT_MS, 'Scenario requests')

    if (!sampleDuring) {
      const after = await runtime.inspector.command('Runtime.getHeapUsage')
      if (accountedBytes(after) > accountedBytes(peak)) peak = after
    }
  } finally {
    runtime.releaseUpstreams()
    monitoring = false
    await monitor
  }

  const orderedStatuses = statuses.toSorted((left, right) => left - right)
  const expectedStatuses = [200, ...Array.from({ length: concurrency - 1 }, () => 429)]
    .toSorted((left, right) => left - right)
  const stats = runtime.stats()
  const contractPassed =
    JSON.stringify(orderedStatuses) === JSON.stringify(expectedStatuses) &&
    stats.upstreamCalls === 1 &&
    stats.upstreamBytes === payloadBytes &&
    stats.maxActiveUpstreams === 1
  return {
    statuses: orderedStatuses,
    durationMs: Math.round(performance.now() - startedAt),
    payloadBytes,
    baselineBytes: accountedBytes(baseline),
    peakBytes: accountedBytes(peak),
    peakDeltaBytes: Math.max(0, accountedBytes(peak) - accountedBytes(baseline)),
    heap: peak,
    ...stats,
    contractPassed,
    localPreflightPassed: contractPassed && accountedBytes(peak) <= gateBytes,
  }
}

function percentile(values, quantile) {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]
}

function aggregateRuns(runs) {
  const peaks = runs.map((run) => run.peakBytes)
  return {
    repetitions: runs.length,
    peakAccountedMiB: {
      min: mib(Math.min(...peaks)),
      median: mib(percentile(peaks, 0.5)),
      p95: mib(percentile(peaks, 0.95)),
      max: mib(Math.max(...peaks)),
    },
    durationMs: {
      median: percentile(runs.map((run) => run.durationMs), 0.5),
      max: Math.max(...runs.map((run) => run.durationMs)),
    },
    localPreflightPassed: runs.every((run) => run.localPreflightPassed),
    runs: runs.map((run) => ({
      statuses: run.statuses,
      durationMs: run.durationMs,
      baselineMiB: mib(run.baselineBytes),
      peakAccountedMiB: mib(run.peakBytes),
      peakDeltaMiB: mib(run.peakDeltaBytes),
      upstreamMiB: mib(run.upstreamBytes),
      upstreamCalls: run.upstreamCalls,
      maxActiveUpstreams: run.maxActiveUpstreams,
      contractPassed: run.contractPassed,
      localPreflightPassed: run.localPreflightPassed,
    })),
  }
}

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version
  } catch {
    return 'unknown'
  }
}

function gitCommit() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (nodeMajor !== EXPECTED_NODE_MAJOR && !options.allowNodeMismatch) {
    throw new Error(`Canonical preflight requires Node ${EXPECTED_NODE_MAJOR}; current ${process.versions.node}. Use --allow-node-mismatch for diagnostics only.`)
  }
  if (options.imageBytes > MAX_IMAGE_BYTES) throw new Error('--image-mib cannot exceed the Arty limit of 4 MiB')
  if (options.gateBytes >= WORKERS_MEMORY_LIMIT_BYTES) throw new Error('--gate-mib must stay below the 128 MiB Workers limit')

  debug('building four distinct valid PNG fixtures')
  const images = buildImages(options.imageBytes)
  const samplePayload = visionPayload(images, 'sample'.padEnd(40, '0'))
  const samplePayloadBytes = Buffer.byteLength(samplePayload)
  if (samplePayloadBytes > MAX_BODY_BYTES) throw new Error('Fixture exceeds the 24 MiB vision transport limit')
  const script = await bundleProxyWorker()

  const scenarios = []
  for (const pathName of options.paths) {
    for (const concurrency of options.concurrencies) {
      const runs = []
      for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
        debug('run', { pathName, concurrency, repetition: repetition + 1 })
        const runtime = await createRuntime(script)
        try {
          runs.push(await runScenario({
            runtime,
            concurrency,
            pathName,
            gateBytes: options.gateBytes,
            sampleDuring: options.sampleDuring,
            makePayload: (requestIndex) => visionPayload(
              images,
              `${pathName}-${String(concurrency).padStart(2, '0')}-${String(repetition).padStart(3, '0')}-${String(requestIndex).padStart(3, '0')}`.padEnd(40, '0'),
            ),
          }))
        } finally {
          runtime.releaseUpstreams()
          runtime.inspector.close()
          await runtime.miniflare.dispose()
        }
      }
      scenarios.push({ path: pathName, concurrency, ...aggregateRuns(runs) })
    }
  }

  const localPreflightPassed = scenarios.every((scenario) => scenario.localPreflightPassed)
  const report = {
    verdict: 'local_preflight_only',
    localPreflightPassed,
    runtime: {
      node: process.version,
      expectedNodeMajor: EXPECTED_NODE_MAJOR,
      nodeMatchesCi: nodeMajor === EXPECTED_NODE_MAJOR,
      os: `${platform()} ${release()} ${arch()}`,
      miniflare: packageVersion('miniflare'),
      workerd: packageVersion('workerd'),
      esbuild: esbuildVersion,
      compatibilityDate: COMPATIBILITY_DATE,
      commit: gitCommit(),
      inspectorTarget: 'core:user:',
      isolateMode: 'fresh-cold-isolate-per-run',
    },
    fixture: {
      format: 'valid 4096x4096 grayscale PNG with distinct pixels and ancillary padding',
      imageCount: images.length,
      imageBytes: options.imageBytes,
      samplePayloadBytes,
    },
    policy: {
      workersMemoryLimitMiB: mib(WORKERS_MEMORY_LIMIT_BYTES),
      conservativeLocalThresholdMiB: mib(options.gateBytes),
      admittedVisionRequestsPerIsolate: 1,
      concurrentPolicy: 'one HTTP 200; remaining requests HTTP 429 without upstream forwarding',
    },
    scenarios,
    caveat: 'Runtime.getHeapUsage is a repeatable local regression signal, not the Cloudflare production limit metric. Activation still requires isolated staging P999 memory and zero exceededMemory/1102 events.',
  }
  console.log(JSON.stringify(report, null, 2))
  if (!localPreflightPassed) process.exitCode = 1
  return report
}

export { aggregateRuns, crc32, main, percentile, pngFixture, visionPayload }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
