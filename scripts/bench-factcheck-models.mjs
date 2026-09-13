import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

// Offline protocol is frozen before the first real provider call. A completed
// or interrupted run cannot be overwritten or silently retried.
const protocolPath = resolve('docs/evaluations/2026-09-13-factcheck-protocol.json')
const protocolText = readFileSync(protocolPath, 'utf8'), protocol = JSON.parse(protocolText)
const output = resolve(process.argv[2] || '.playwright-mcp/factcheck-20260913')
const configPath = process.argv[3]
if (!configPath) throw new Error('Pass the existing local provider config path; secrets are never printed.')
mkdirSync(output, { recursive: true })
const lock = join(output, 'started.json')
if (existsSync(lock)) throw new Error('Run already started. Preserve results; no automatic retries.')
const source = readFileSync('functions/api/ai/fact-check.ts', 'utf8')
const system = source.match(/const SYSTEM_PROMPT = `([\s\S]*?)`\r?\n/)?.[1]
if (!system) throw new Error('Fact-check system prompt not found')
const config = readFileSync(configPath, 'utf8').split('[env.production.vars]')[1]?.split(/^\[/m)[0]
if (!config) throw new Error('Missing production provider configuration section')
const keys = {}
for (const [p, name] of Object.entries({ anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' })) {
  keys[p] = config.match(new RegExp('^' + name + '\\s*=\\s*"([^"\\r\\n]+)"', 'm'))?.[1]
  if (!keys[p]) throw new Error('Missing provider configuration: ' + p)
}
const hash = s => createHash('sha256').update(s).digest('hex')
writeFileSync(lock, JSON.stringify({ startedAt: new Date().toISOString(), protocolSha256: hash(protocolText), systemSha256: hash(system), maxCells: protocol.models.length * protocol.cases.length, maxReservedUsd: protocol.maxReservedUsd }, null, 2))
writeFileSync(join(output, 'system-prompt.txt'), system)
writeFileSync(join(output, 'protocol.json'), protocolText)
let reserved = 0
const disabled = new Set()
const jobs = protocol.cases.flatMap((c, i) => protocol.models.map((_, j) => ({ c, m: protocol.models[(j + i) % protocol.models.length] })))
for (const { c, m } of jobs) {
  if (disabled.has(m.id)) {
    appendFileSync(join(output, 'results.jsonl'), JSON.stringify({ caseId: c.id, requestedModel: m.id, status: 'skipped_provider_unavailable' }) + '\n'); continue
  }
  const evidence = c.sources.map(k => protocol.sources[k])
  const user = `QUESTION : ${c.question}\n\nRÉPONSE À VÉRIFIER :\n${c.answer}\n\nSOURCES CONSULTÉES (dossiers fixes, résumés de pages lus le ${protocol.date}, pas de recherche autonome) :\n${JSON.stringify(evidence)}\n${c.extraEvidence || ''}`
  const cap = (Buffer.byteLength(system + user) * m.input + protocol.maxOutputTokens * m.output) / 1e6
  if (reserved + cap > protocol.maxReservedUsd) throw new Error('Conservative evaluation reservation cap reached')
  reserved += cap
  const body = m.provider === 'anthropic'
    ? { model: m.id, max_tokens: protocol.maxOutputTokens, system, messages: [{ role: 'user', content: user }] }
    : m.provider === 'gemini'
    ? { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: protocol.maxOutputTokens, responseMimeType: 'application/json' } }
    : { model: m.id, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_completion_tokens: protocol.maxOutputTokens, reasoning_effort: 'none', service_tier: 'default' }
  const url = m.provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : m.provider === 'gemini'
    ? `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent` : 'https://api.openai.com/v1/chat/completions'
  const headers = { 'content-type': 'application/json', ...(m.provider === 'anthropic' ? { 'x-api-key': keys[m.provider], 'anthropic-version': '2023-06-01' } : m.provider === 'gemini' ? { 'x-goog-api-key': keys[m.provider] } : { authorization: `Bearer ${keys[m.provider]}` }) }
  const start = performance.now(), result = { caseId: c.id, requestedModel: m.id, provider: m.provider, startedAt: new Date().toISOString(), inputSha256: hash(user), reservedUsd: cap }
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
    const raw = await response.json(); result.elapsedMs = Math.round(performance.now() - start); result.httpStatus = response.status
    if (!response.ok) {
      result.status = 'provider_error'; result.errorCode = String(raw.error?.type || raw.error?.status || raw.error?.code || 'unknown').slice(0, 100)
      if ([401, 403, 404].includes(response.status)) disabled.add(m.id)
    } else {
      result.status = 'completed'; result.servedModel = raw.model || raw.modelVersion || null
      result.finish = raw.stop_reason || raw.candidates?.[0]?.finishReason || raw.choices?.[0]?.finish_reason
      result.usage = raw.usage || raw.usageMetadata
      result.text = m.provider === 'anthropic' ? raw.content?.filter(b => b.type === 'text').map(b => b.text).join('\n')
        : m.provider === 'gemini' ? raw.candidates?.[0]?.content?.parts?.filter(b => !b.thought).map(b => b.text || '').join('\n') : raw.choices?.[0]?.message?.content
      try { result.verdict = JSON.parse(result.text) } catch { result.status = 'invalid_json' }
      const u = result.usage || {}
      const input = m.provider === 'anthropic' ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : m.provider === 'gemini' ? u.promptTokenCount : u.prompt_tokens
      const out = m.provider === 'gemini' ? (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) : m.provider === 'anthropic' ? u.output_tokens : u.completion_tokens
      result.inputTokens = input; result.outputTokens = out
      // Conservative non-cached list-price estimate, not a provider invoice.
      result.estimatedUncachedUsd = Number.isFinite(input) && Number.isFinite(out) ? (input * m.input + out * m.output) / 1e6 : null
    }
  } catch (e) { result.status = 'transport_error'; result.errorCode = e?.name || 'Error'; result.elapsedMs = Math.round(performance.now() - start) }
  appendFileSync(join(output, 'results.jsonl'), JSON.stringify(result) + '\n')
  console.log(`${c.id} ${m.id}: ${result.status}, ${result.elapsedMs} ms`)
}
writeFileSync(join(output, 'complete.json'), JSON.stringify({ completedAt: new Date().toISOString(), reservedUsd: reserved, cells: jobs.length }, null, 2))
