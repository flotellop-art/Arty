import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { deflateSync, inflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const MIB = 1024 * 1024
const MAX_IMAGE_BYTES = 4 * MIB
const MAX_BODY_BYTES = 24 * MIB
const MAX_RESPONSE_BYTES = 2 * MIB
const DEFAULT_DIMENSION = 32
const DEFAULT_ACCEPTED = 34
const DEFAULT_RPM = 30
const MAX_RPM = 60
const DEFAULT_TIMEOUT_MS = 150_000
const MAX_TIMEOUT_MS = 180_000
const PROMPT_TOKEN_CAPS = new Map([[32, 2_000], [4096, 70_000]])
const COMPLETION_TOKEN_CAP = 1
const REQUIRED_ACK = 'arty-vision-a11-staging'
const A11_PROJECT = 'arty-vision-a11-staging'
const A11_PROJECT_HOST_SUFFIX = `.${A11_PROJECT}.pages.dev`
const A11_REQUEST_ORIGIN = 'https://tryarty.com'
const PRODUCTION_HOSTS = new Set([
  'tryarty.com',
  'www.tryarty.com',
  'appfacade.pages.dev',
  'arty.pages.dev',
  'app.arty.fr',
])

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  }
  return crc >>> 0
})

function crc32(...parts) {
  let crc = 0xffffffff
  for (const part of parts) {
    for (const value of part) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeU32(bytes, offset, value) {
  bytes.writeUInt32BE(value >>> 0, offset)
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

function deterministicBytes(length, seed) {
  const bytes = Buffer.allocUnsafe(length)
  let state = (0x9e3779b9 ^ seed) >>> 0
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }
  return bytes
}

/**
 * PNG gris valide, de petites dimensions, rembourré par un chunk privé
 * ancillary. Les octets/base64 exercent le pire transport du proxy sans faire
 * facturer 65 536 patches image par requête au fournisseur.
 */
function paddedPng(byteLength = MAX_IMAGE_BYTES, seed = 1, dimension = DEFAULT_DIMENSION) {
  if (!Number.isInteger(byteLength) || byteLength <= 0) throw new Error('invalid PNG byte length')
  if (!Number.isInteger(dimension) || dimension <= 0) throw new Error('invalid PNG dimension')

  const rowBytes = dimension + 1
  const raw = Buffer.allocUnsafe(rowBytes * dimension)
  for (let y = 0; y < dimension; y += 1) {
    const row = y * rowBytes
    raw[row] = 0 // filtre PNG None
    for (let x = 0; x < dimension; x += 1) {
      raw[row + x + 1] = (x * 13 + y * 29 + seed * 47) & 0xff
    }
  }

  const ihdr = Buffer.alloc(13)
  writeU32(ihdr, 0, dimension)
  writeU32(ihdr, 4, dimension)
  ihdr.set([8, 0, 0, 0, 0], 8) // 8-bit grayscale, no interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const prefix = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
  ])
  const iend = pngChunk('IEND', Buffer.alloc(0))
  const paddingLength = byteLength - prefix.length - iend.length - 12
  if (paddingLength < 1) throw new Error('requested PNG size is too small')

  const result = Buffer.concat([
    prefix,
    // a=ancillary, r=private, T=reserved bit valid, y=safe-to-copy.
    pngChunk('arTy', deterministicBytes(paddingLength, seed)),
    iend,
  ])
  if (result.length !== byteLength) throw new Error('PNG fixture size mismatch')
  return result
}

function inspectPng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < signature.length || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error('invalid PNG signature')
  }

  let offset = 8
  let width
  let height
  let bitDepth
  let colorType
  let ancillaryBytes = 0
  let sawIend = false
  const idat = []
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('truncated PNG chunk')
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error('PNG chunk exceeds fixture')
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const storedCrc = bytes.readUInt32BE(offset + 8 + length)
    if (storedCrc !== crc32(typeBytes, data)) throw new Error('invalid PNG chunk CRC')
    const type = typeBytes.toString('ascii')
    if (type === 'IHDR') {
      if (data.length !== 13 || width !== undefined) throw new Error('invalid PNG IHDR')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('unsupported PNG compression/filter/interlace')
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'arTy') {
      ancillaryBytes += data.length
    } else if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) throw new Error('invalid terminal PNG IEND')
      sawIend = true
    }
    offset = end
  }

  if (!sawIend || offset !== bytes.length || !width || !height || idat.length === 0) {
    throw new Error('incomplete PNG fixture')
  }
  if (bitDepth !== 8 || colorType !== 0) throw new Error('unexpected PNG pixel format')
  const decoded = inflateSync(Buffer.concat(idat))
  if (decoded.length !== (width + 1) * height) throw new Error('unexpected decoded PNG length')
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (width + 1)] !== 0) throw new Error('unexpected PNG row filter')
  }
  return { width, height, bitDepth, colorType, ancillaryBytes, decodedBytes: decoded.length }
}

function visionPayload(images, nonce, maxCompletionTokens = 1) {
  return JSON.stringify({
    model: 'gpt-5.6-terra',
    messages: [{
      role: 'user',
      content: [
        ...images.map((base64) => ({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${base64}`, detail: 'original' },
        })),
        { type: 'text', text: `Décris en un mot la différence entre ces images. [${nonce}]` },
      ],
    }],
    max_completion_tokens: maxCompletionTokens,
    stream: true,
    stream_options: { include_usage: true },
  })
}

function buildFixture({ imageBytes = MAX_IMAGE_BYTES, dimension = DEFAULT_DIMENSION } = {}) {
  const pngs = [1, 2, 3, 4].map((seed) => paddedPng(imageBytes, seed, dimension))
  const inspections = pngs.map(inspectPng)
  const images = pngs.map((bytes) => bytes.toString('base64'))
  const body = visionPayload(images, 'a11-transport'.padEnd(40, '0'))
  const bodyBytes = Buffer.byteLength(body)
  if (bodyBytes > MAX_BODY_BYTES) throw new Error('A11 fixture exceeds the 24 MiB proxy cap')
  return {
    body,
    bodyBytes,
    bodySha256: createHash('sha256').update(body).digest('hex'),
    imageBytes,
    imageCount: pngs.length,
    dimension,
    imagePatchTokens: pngs.length * Math.ceil(dimension / 32) ** 2,
    inspections,
  }
}

function positiveInteger(raw, label) {
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return value
}

function parseArgs(argv) {
  const options = {
    execute: false,
    path: 'server',
    concurrencies: [1],
    accepted: DEFAULT_ACCEPTED,
    rpm: DEFAULT_RPM,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    fixtureDimension: DEFAULT_DIMENSION,
  }
  for (const arg of argv) {
    if (arg === '--execute') options.execute = true
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length)
    else if (arg.startsWith('--endpoint=')) options.endpoint = arg.slice('--endpoint='.length)
    else if (arg.startsWith('--deployment-sha=')) options.deploymentSha = arg.slice('--deployment-sha='.length)
    else if (arg.startsWith('--deployment-id=')) options.deploymentId = arg.slice('--deployment-id='.length)
    else if (arg.startsWith('--deployment-short-id=')) options.deploymentShortId = arg.slice('--deployment-short-id='.length).toLowerCase()
    else if (arg.startsWith('--window=')) options.window = arg.slice('--window='.length)
    else if (arg.startsWith('--report-file=')) options.reportFile = arg.slice('--report-file='.length)
    else if (arg.startsWith('--acknowledge=')) options.acknowledge = arg.slice('--acknowledge='.length)
    else if (arg.startsWith('--path=')) options.path = arg.slice('--path='.length)
    else if (arg.startsWith('--accepted=')) options.accepted = positiveInteger(arg.slice('--accepted='.length), '--accepted')
    else if (arg.startsWith('--fixture-dimension=')) {
      options.fixtureDimension = positiveInteger(arg.slice('--fixture-dimension='.length), '--fixture-dimension')
      if (![32, 4096].includes(options.fixtureDimension)) {
        throw new Error('--fixture-dimension only supports 32 or 4096')
      }
    }
    else if (arg.startsWith('--rpm=')) options.rpm = positiveInteger(arg.slice('--rpm='.length), '--rpm')
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = positiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms')
    else if (arg.startsWith('--concurrency=')) {
      const values = arg.slice('--concurrency='.length).split(',').map((value) => positiveInteger(value, '--concurrency'))
      if (values.some((value) => ![1, 2, 4].includes(value))) throw new Error('--concurrency only supports 1,2,4')
      options.concurrencies = [...new Set(values)]
    } else if (arg === '--help') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!['server', 'byok-proxy', 'byok-direct'].includes(options.path)) {
    throw new Error('--path expects server, byok-proxy, or byok-direct')
  }
  if (!options.execute && options.reportFile) {
    throw new Error('--report-file is reserved for an executed A11 cell')
  }
  if (options.rpm > MAX_RPM) throw new Error(`--rpm cannot exceed ${MAX_RPM}`)
  if (options.timeoutMs > MAX_TIMEOUT_MS) throw new Error(`--timeout-ms cannot exceed ${MAX_TIMEOUT_MS}`)
  return options
}

function helpText() {
  return [
    'Usage: npm run bench:vision:cloudflare -- [options]',
    '',
    'Sans --execute, construit et vérifie la fixture sans aucun appel réseau.',
    'L’exécution exige un projet Pages A11 isolé et protégé par Access.',
    '',
    '  --execute',
    '  --mode=pilot|campaign|sentinel',
    '  --endpoint=https://<hash>.arty-vision-a11-staging.pages.dev/api/ai/openai-proxy',
    '  --deployment-sha=<40-hex>',
    '  --deployment-id=<id Cloudflare vérifié>',
    '  --deployment-short-id=<8 caractères, hôte atomique>',
    '  --window=PILOT|W1|W2|W3',
    '  --report-file=artifacts/vision-a11/<nom>.json',
    `  --acknowledge=${REQUIRED_ACK}`,
    '  --path=server|byok-proxy|byok-direct (défaut: server)',
    '  --concurrency=1|2|4            (une cellule par invocation)',
    '  --fixture-dimension=32|4096     (défaut: 32 ; 4096 = sentinelle)',
    `  --accepted=${DEFAULT_ACCEPTED}                 (W1: 34, W2/W3: 33)`,
    `  --rpm=${DEFAULT_RPM}                       (maximum: ${MAX_RPM})`,
    `  --timeout-ms=${DEFAULT_TIMEOUT_MS}`,
    '',
    'Secrets lus uniquement depuis l’environnement :',
    '  ARTY_A11_GOOGLE_TOKEN',
    '  ARTY_A11_CF_ACCESS_CLIENT_ID',
    '  ARTY_A11_CF_ACCESS_CLIENT_SECRET',
    '  ARTY_A11_OPENAI_BYOK_KEY       (chemins byok-proxy/byok-direct)',
  ].join('\n')
}

function validateReportTarget(reportFile) {
  if (!reportFile) return
  if (isAbsolute(reportFile)) throw new Error('--report-file must be relative to the repository')
  const allowedRoot = resolve(process.cwd(), 'artifacts', 'vision-a11')
  const target = resolve(process.cwd(), reportFile)
  if (dirname(target).toLowerCase() !== allowedRoot.toLowerCase() ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(basename(target))) {
    throw new Error('--report-file must be a direct JSON child of artifacts/vision-a11')
  }
  mkdirSync(allowedRoot, { recursive: true })
  if (realpathSync.native(allowedRoot).toLowerCase() !== allowedRoot.toLowerCase()) {
    throw new Error('artifacts/vision-a11 must not be a symbolic link or junction')
  }
  if (existsSync(target)) throw new Error('refusing to overwrite an existing A11 report')
  return target
}

function writeReport(report, reportFile) {
  if (!reportFile) return
  const target = validateReportTarget(reportFile)
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

function validateProtocolMatrix(options) {
  if (!['pilot', 'campaign', 'sentinel'].includes(options.mode)) {
    throw new Error('--mode expects pilot, campaign, or sentinel')
  }
  if (!options.reportFile) throw new Error('--report-file is required with --execute')
  if (options.concurrencies.length !== 1) {
    throw new Error('exactly one --concurrency cell is required per execution')
  }
  const concurrency = options.concurrencies[0]
  let expectedReportName
  if (options.mode === 'pilot') {
    if (options.window !== 'PILOT' || !['server', 'byok-proxy'].includes(options.path) ||
        options.fixtureDimension !== 32 || concurrency !== 1 || options.accepted !== 5) {
      throw new Error('pilot matrix requires PILOT, server|byok-proxy, 32px, concurrency 1, accepted 5')
    }
    expectedReportName = `PILOT-${options.path}.json`
  } else if (options.mode === 'campaign') {
    const expectedAccepted = options.window === 'W1' ? 34 : 33
    if (!/^W[123]$/.test(options.window || '') || options.path !== 'server' ||
        options.fixtureDimension !== 32 || ![1, 2, 4].includes(concurrency) ||
        options.accepted !== expectedAccepted || options.rpm !== DEFAULT_RPM) {
      throw new Error('campaign matrix requires W1=34 or W2/W3=33, server, 32px, one concurrency cell, 30 rpm')
    }
    expectedReportName = `${options.window}-server-c${concurrency}.json`
  } else if (!/^W[123]$/.test(options.window || '') ||
      !['server', 'byok-direct'].includes(options.path) || options.fixtureDimension !== 4096 ||
      concurrency !== 1 || options.accepted !== 1) {
    throw new Error('sentinel matrix requires W1|W2|W3, server|byok-direct, 4096px, concurrency 1, accepted 1')
  } else {
    expectedReportName = `${options.window}-sentinel-${options.path}-4k.json`
  }
  if (basename(options.reportFile) !== expectedReportName) {
    throw new Error(`--report-file must use the canonical name ${expectedReportName}`)
  }
}

function validateExecuteOptions(options, env = process.env) {
  if (!/^[0-9a-f]{40}$/i.test(options.deploymentSha || '')) {
    throw new Error('--deployment-sha must be the exact 40-character deployed SHA')
  }
  if (!/^(?:PILOT|W[123])$/.test(options.window || '')) {
    throw new Error('--window expects PILOT, W1, W2, or W3')
  }
  if (options.acknowledge !== REQUIRED_ACK) {
    throw new Error(`--acknowledge must equal ${REQUIRED_ACK}`)
  }
  validateProtocolMatrix(options)
  if (options.path === 'byok-direct') {
    if (options.endpoint) throw new Error('--endpoint must be omitted for --path=byok-direct')
    if (!env.ARTY_A11_OPENAI_BYOK_KEY) {
      throw new Error('ARTY_A11_OPENAI_BYOK_KEY is required for --path=byok-direct')
    }
    if (options.concurrencies.some((value) => value !== 1)) {
      throw new Error('--path=byok-direct only supports --concurrency=1')
    }
    return new URL('https://api.openai.com/v1/chat/completions')
  }

  if (!options.endpoint) throw new Error('--endpoint is required with --execute')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.deploymentId || '')) {
    throw new Error('--deployment-id must be copied from the verified Cloudflare deployment')
  }
  if (!/^[a-z0-9]{8}$/.test(options.deploymentShortId || '')) {
    throw new Error('--deployment-short-id must be the verified 8-character Cloudflare short_id')
  }
  const endpoint = new URL(options.endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/api/ai/openai-proxy' ||
      endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash) {
    throw new Error('endpoint must be the HTTPS A11 openai-proxy route')
  }
  const hostname = endpoint.hostname.toLowerCase()
  if (PRODUCTION_HOSTS.has(hostname) || hostname.endsWith('.appfacade.pages.dev')) {
    throw new Error('refusing to run A11 against a production or shared-preview host')
  }
  if (hostname !== `${options.deploymentShortId}${A11_PROJECT_HOST_SUFFIX}`) {
    throw new Error('endpoint must use the verified atomic A11 deployment URL, never an alias')
  }
  for (const name of [
    'ARTY_A11_GOOGLE_TOKEN',
    'ARTY_A11_CF_ACCESS_CLIENT_ID',
    'ARTY_A11_CF_ACCESS_CLIENT_SECRET',
  ]) {
    if (!env[name]) throw new Error(`${name} is required with --execute`)
  }
  if (options.path === 'byok-proxy' && !env.ARTY_A11_OPENAI_BYOK_KEY) {
    throw new Error('ARTY_A11_OPENAI_BYOK_KEY is required for --path=byok-proxy')
  }
  return endpoint
}

function verifyLocalCheckout(options, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  const head = git('rev-parse', 'HEAD')
  if (head.toLowerCase() !== options.deploymentSha.toLowerCase()) {
    throw new Error('local HEAD does not match --deployment-sha')
  }
  if (git('status', '--porcelain=v1', '--untracked-files=all')) {
    throw new Error('local checkout must be completely clean before execution')
  }
  return head
}

function requestHeadersForPath(path, env) {
  if (path === 'byok-direct') {
    return { authorization: `Bearer ${env.ARTY_A11_OPENAI_BYOK_KEY}` }
  }
  return {
    origin: A11_REQUEST_ORIGIN,
    'x-google-token': env.ARTY_A11_GOOGLE_TOKEN,
    'x-arty-vision': '1',
    'CF-Access-Client-Id': env.ARTY_A11_CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': env.ARTY_A11_CF_ACCESS_CLIENT_SECRET,
    ...(path === 'byok-proxy' ? { 'x-openai-key': env.ARTY_A11_OPENAI_BYOK_KEY } : {}),
  }
}

async function readBoundedText(response, maxBytes = 64 * 1024) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error('error response exceeded local diagnostic cap')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (error) {
    try { await reader.cancel('a11_error_response_rejected') } catch { /* already closed */ }
    throw error
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }
}

async function drainSuccess(response) {
  if (!response.body) throw new Error('successful response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let responseBytes = 0
  let carry = ''
  let sawDone = false
  let model
  let usage
  const consumeLine = (line) => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (data === '[DONE]') {
      sawDone = true
      return
    }
    if (!data) return
    try {
      const event = JSON.parse(data)
      if (typeof event.model === 'string') model = event.model
      if (event.usage && typeof event.usage === 'object') {
        const promptTokens = Number(event.usage.prompt_tokens)
        const completionTokens = Number(event.usage.completion_tokens)
        if (![promptTokens, completionTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) {
          throw new Error('invalid usage in staging SSE')
        }
        usage = {
          promptTokens,
          completionTokens,
        }
      }
    } catch {
      throw new Error('malformed SSE event from staging')
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      responseBytes += value.byteLength
      if (responseBytes > MAX_RESPONSE_BYTES) throw new Error('response exceeded local A11 cap')
      carry += decoder.decode(value, { stream: true })
      const lines = carry.split('\n')
      carry = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    }
    carry += decoder.decode()
    if (carry) consumeLine(carry)
  } catch (error) {
    try { await reader.cancel('a11_success_stream_rejected') } catch { /* already closed */ }
    throw error
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }
  if (!sawDone) throw new Error('successful stream ended without [DONE]')
  if (!model?.startsWith('gpt-5.6-terra')) throw new Error(`unexpected served model: ${model || 'missing'}`)
  if (!usage) throw new Error('successful stream omitted usage')
  return { responseBytes, model, usage }
}

function stableFailureCode(error) {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'TimeoutError' || name === 'AbortError') return 'request_timeout_or_abort'
  if (/Cloudflare Access/.test(message)) return 'access_boundary_failure'
  if (/response exceeded|diagnostic cap/.test(message)) return 'response_size_cap_exceeded'
  if (/SSE|stream|served model|usage/.test(message)) return 'invalid_provider_stream'
  if (/fetch|network|socket|connect/i.test(message)) return 'network_failure'
  return 'unexpected_local_failure'
}

async function sendRequest({ endpoint, body, headers, timeoutMs }) {
  const started = performance.now()
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      ...headers,
    },
    body,
  })
  const cfRay = response.headers.get('cf-ray') || undefined
  if (response.status === 200) {
    const stream = await drainSuccess(response)
    return { status: 200, durationMs: Math.round(performance.now() - started), cfRay, ...stream }
  }
  const diagnostic = await readBoundedText(response)
  let error
  try {
    const parsed = JSON.parse(diagnostic)
    const candidate = typeof parsed.error === 'string' ? parsed.error : parsed.error?.code
    error = typeof candidate === 'string' && /^[a-z0-9_]{1,64}$/i.test(candidate)
      ? candidate
      : 'unclassified_remote_error'
  } catch {
    error = 'non_json_error'
  }
  return {
    status: response.status,
    durationMs: Math.round(performance.now() - started),
    cfRay,
    error: error || 'unknown_error',
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function verifyAccessBoundary(endpoint, env, timeoutMs) {
  const root = new URL('/', endpoint)
  const fetchRoot = (headers = {}) => fetch(root, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
    headers,
  })
  const denied = await fetchRoot()
  const deniedStatus = denied.status
  try { await denied.body?.cancel('a11_access_denial_checked') } catch { /* no body */ }
  if (![302, 401, 403].includes(deniedStatus)) {
    throw new Error('Cloudflare Access did not reject the unauthenticated staging probe')
  }

  const granted = await fetchRoot({
    'CF-Access-Client-Id': env.ARTY_A11_CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': env.ARTY_A11_CF_ACCESS_CLIENT_SECRET,
  })
  const grantedStatus = granted.status
  try { await granted.body?.cancel('a11_access_grant_checked') } catch { /* no body */ }
  if (grantedStatus !== 200) {
    throw new Error('Cloudflare Access did not accept the staging service token')
  }
  return { unauthenticatedStatus: deniedStatus, serviceTokenStatus: grantedStatus }
}

async function runScenario({ options, concurrency, endpoint, fixture, env }) {
  const maxRequests = options.mode === 'campaign' ? options.accepted * concurrency : options.accepted
  const commonHeaders = requestHeadersForPath(options.path, env)
  let requested = 0
  let accepted = 0
  let busy = 0
  let burst = 0
  let nextBurstAt = 0
  let failureCode
  const startedAt = new Date().toISOString()
  const observations = []
  try {
    while (accepted < options.accepted) {
      const capacity = maxRequests - requested
      if (capacity <= 0) {
        failureCode = 'hard_request_cap_exhausted'
        break
      }
      const burstSize = Math.min(concurrency, options.accepted - accepted, capacity)
      const waitMs = Math.max(0, nextBurstAt - Date.now())
      if (waitMs > 0) await sleep(waitMs)
      const burstStartedAt = new Date().toISOString()
      nextBurstAt = Date.now() + Math.ceil(60_000 * burstSize / options.rpm)
      burst += 1
      const settled = await Promise.allSettled(Array.from({ length: burstSize }, () => sendRequest({
        endpoint,
        body: fixture.body,
        headers: commonHeaders,
        timeoutMs: options.timeoutMs,
      })))
      const results = settled.map((result) => result.status === 'fulfilled'
        ? result.value
        : { status: 0, error: stableFailureCode(result.reason) })
      requested += results.length
      for (const result of results) {
        if (result.status === 200) {
          const promptCap = PROMPT_TOKEN_CAPS.get(fixture.dimension)
          if (!promptCap || result.usage.promptTokens > promptCap ||
              result.usage.completionTokens > COMPLETION_TOKEN_CAP) {
            failureCode ||= 'provider_usage_cap_exceeded'
          } else {
            accepted += 1
          }
        }
        else if (options.path !== 'byok-direct' && result.status === 429 && result.error === 'vision_busy') busy += 1
        else failureCode ||= result.status === 0 ? result.error : 'unexpected_remote_response'
      }
      const observation = {
        burst,
        startedAt: burstStartedAt,
        requested,
        accepted,
        busy,
        results,
      }
      observations.push(observation)
      console.error(JSON.stringify(observation))
      if (failureCode) break
    }
  } catch (error) {
    failureCode = stableFailureCode(error)
  }
  return {
    concurrency,
    verdict: !failureCode && accepted === options.accepted ? 'measurement_ready' : 'failed',
    startedAt,
    endedAt: new Date().toISOString(),
    requested,
    accepted,
    busy,
    maxRequests,
    admissionCollisionObserved: busy > 0,
    ...(failureCode ? { failureCode } : {}),
    observations,
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(helpText())
    return { verdict: 'help' }
  }
  const fixture = buildFixture({ dimension: options.fixtureDimension })
  const baseReport = {
    fixture: {
      format: `four valid ${fixture.dimension}x${fixture.dimension} grayscale PNGs with deterministic private ancillary padding`,
      imageCount: fixture.imageCount,
      imageBytes: fixture.imageBytes,
      bodyBytes: fixture.bodyBytes,
      bodyMiB: Number((fixture.bodyBytes / MIB).toFixed(2)),
      bodySha256: fixture.bodySha256,
      imagePatchTokens: fixture.imagePatchTokens,
      inspections: fixture.inspections,
    },
    policy: {
      maxBodyMiB: MAX_BODY_BYTES / MIB,
      maxRpm: MAX_RPM,
      promptTokenCapPerRequest: PROMPT_TOKEN_CAPS.get(fixture.dimension),
      completionTokenCapPerRequest: COMPLETION_TOKEN_CAP,
      productionHostsRejected: true,
      redirectsRejected: true,
      automaticRetryOnUnknownOutcome: false,
    },
  }
  if (!options.execute) {
    const report = { verdict: 'dry_run_only', ...baseReport }
    writeReport(report, options.reportFile)
    console.log(JSON.stringify(report, null, 2))
    return report
  }

  const endpoint = validateExecuteOptions(options, env)
  verifyLocalCheckout(options)
  validateReportTarget(options.reportFile)
  const scenarios = []
  let accessBoundary
  let executionFailureCode
  try {
    if (options.path !== 'byok-direct') {
      accessBoundary = await verifyAccessBoundary(endpoint, env, options.timeoutMs)
    }
    for (const concurrency of options.concurrencies) {
      scenarios.push(await runScenario({ options, concurrency, endpoint, fixture, env }))
    }
  } catch (error) {
    executionFailureCode = stableFailureCode(error)
  }
  const measurementReady = !executionFailureCode && scenarios.length === 1 &&
    scenarios.every((scenario) => scenario.verdict === 'measurement_ready')
  const successVerdict = options.mode === 'campaign'
    ? 'traffic_complete_metrics_pending'
    : `${options.mode}_complete`
  const report = {
    verdict: measurementReady ? successVerdict : 'traffic_failed',
    mode: options.mode,
    deploymentSha: options.deploymentSha,
    ...(options.path !== 'byok-direct' ? {
      deploymentId: options.deploymentId,
      deploymentShortId: options.deploymentShortId,
      endpointHost: endpoint.hostname,
      accessBoundary,
    } : {}),
    window: options.window,
    path: options.path,
    acceptedTargetPerScenario: options.accepted,
    rpm: options.rpm,
    ...baseReport,
    scenarios,
    ...(executionFailureCode ? { failureCode: executionFailureCode } : {}),
    nextGate: options.mode === 'campaign'
      ? 'Cloudflare P999 <= 100663296 bytes and zero exceededMemory/exceededResources/1102 on the exact interval'
      : 'functional evidence only; this result cannot satisfy the A11 memory campaign gate',
  }
  writeReport(report, options.reportFile)
  console.log(JSON.stringify(report, null, 2))
  if (!measurementReady) process.exitCode = 2
  return report
}

export {
  buildFixture,
  crc32,
  drainSuccess,
  inspectPng,
  main,
  paddedPng,
  parseArgs,
  requestHeadersForPath,
  runScenario,
  validateExecuteOptions,
  validateProtocolMatrix,
  validateReportTarget,
  verifyAccessBoundary,
  verifyLocalCheckout,
  visionPayload,
  writeReport,
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
