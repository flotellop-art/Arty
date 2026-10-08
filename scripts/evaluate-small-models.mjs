import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

// Direct-provider synthetic evaluation. Never executes real application tools.
// Inputs, scoring and configuration are frozen before calls. No retry/fallback.
const sha = x => crypto.createHash('sha256').update(x).digest('hex')
const same = (a, b) => {
  if (typeof b === 'number') return typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) < 1e-8
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v, i) => same(a[i], v))
  if (b && typeof b === 'object') return !!a && typeof a === 'object' && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(k => same(a[k], b[k]))
  return a === b
}
const fieldSame = (a, b, k) => k === 'sourceIds' && Array.isArray(a) && Array.isArray(b)
  ? same([...new Set(a)].sort(), [...new Set(b)].sort()) : same(a, b)
const recover = text => {
  try { return { answer: JSON.parse(text), strict: true } } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) try { return { answer: JSON.parse(fence[1]), strict: false } } catch {}
  return { answer: null, strict: false }
}
function usageFor(raw, m) {
  const u = raw.usage ?? raw.usageMetadata
  if (!u) return { known: false, estimatedUSD: null }
  let input, output, cached, created = 0, cost
  if (m.provider === 'anthropic') {
    input = u.input_tokens; output = u.output_tokens
    cached = u.cache_read_input_tokens ?? 0; created = u.cache_creation_input_tokens ?? 0
    const totalInput = input + cached + created
    const long = totalInput > 100000 && m.id === 'claude-haiku-5-5'
    const multiplier = long ? 5 : 1
    const created1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
    cost = (input * m.input + cached * m.cacheRead + (created - created1h) * m.cacheWrite + created1h * m.input * 2 + output * m.output) * multiplier / 1e6
    input = totalInput
  } else {
    input = m.provider === 'openai' ? u.prompt_tokens : u.promptTokenCount
    output = m.provider === 'openai' ? u.completion_tokens : (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
    cached = m.provider === 'openai' ? (u.prompt_tokens_details?.cached_tokens ?? 0) : (u.cachedContentTokenCount ?? 0)
    created = m.provider === 'openai' ? u.prompt_tokens_details?.cache_write_tokens : 0
    cost = ((input - cached - created) * m.input + cached * m.cacheRead + created * m.cacheWrite + output * m.output) / 1e6
  }
  const known = [input, output, cached, created, cost].every(v => Number.isFinite(v) && v >= 0) && input >= cached + created
  return { known, inputTokens: input, outputTokens: output, cachedTokens: cached, cacheCreationTokens: created,
    thinkingTokens: u.output_tokens_details?.thinking_tokens ?? u.thoughtsTokenCount ?? u.completion_tokens_details?.reasoning_tokens ?? null,
    estimatedUSD: known ? cost : null }
}
const servedMatches = (served, m) => m.acceptedResponseIds.includes(served)

if (process.argv.includes('--self-check')) {
  assert.equal(same(28.27, 28.26), false)
  assert.equal(same(28.26000000001, 28.26), true)
  assert.equal(same({ b: 2, a: 1 }, { a: 1, b: 2 }), true)
  assert.equal(fieldSame(['S6', 'S5'], ['S5', 'S6'], 'sourceIds'), true)
  assert.equal(fieldSame(['L3', 'L1'], ['L1', 'L3'], 'included'), false)
  assert.equal(recover('```json\n{"ok":true}\n```').strict, false)
  assert.equal(recover('{"ok":true}').strict, true)
  const m = { provider: 'anthropic', id: 'claude-haiku-5-5', input: .1, output: .5, cacheRead: .01, cacheWrite: .125 }
  assert.ok(Math.abs(usageFor({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 40 } }, m).estimatedUSD - .0000255) < 1e-10)
  assert.equal(usageFor({}, m).known, false)
  assert.ok(Math.abs(usageFor({ usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 40 } } }, { ...m, provider: 'openai' }).estimatedUSD - .0000165) < 1e-10)
  console.log('Scoring, structural tool arguments, strict JSON and cache accounting self-checks passed.')
  process.exit(0)
}

const [protocolArg, outputArg, configArg] = process.argv.slice(2)
if (!protocolArg || !outputArg || !configArg) throw new Error('Usage: node evaluate-small-models.mjs protocol.json output-directory existing-provider-config.toml')
const serialized = fs.readFileSync(protocolArg, 'utf8'), protocol = JSON.parse(serialized)
const out = path.resolve(outputArg)
fs.mkdirSync(out, { recursive: true })
if (fs.existsSync(path.join(out, 'started.json'))) throw new Error('Run already started; preserve evidence and never repeat automatically.')
if (sha(protocol.system) !== protocol.systemHash) throw new Error('System hash mismatch')
const configText = fs.readFileSync(configArg, 'utf8')
const section = configText.split('[env.production.vars]')[1]?.split(/\r?\n\[/)[0] ?? ''
const keys = Object.fromEntries(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'].map(name => [name, section.match(new RegExp('^' + name + '\\s*=\\s*"([^"\\r\\n]+)"', 'm'))?.[1]]))
if (Object.values(keys).some(v => !v || v.includes('your-'))) throw new Error('Provider configuration incomplete; no secrets printed.')
const started = { startedAt: new Date().toISOString(), protocolHash: sha(serialized), runnerHash: sha(fs.readFileSync(new URL(import.meta.url))), cells: protocol.cases.length * protocol.models.length * protocol.repeats }
fs.writeFileSync(path.join(out, 'started.json'), JSON.stringify(started, null, 2), { flag: 'wx' })
fs.writeFileSync(path.join(out, 'protocol.json'), serialized, { flag: 'wx' })
let reserved = 0
const disabled = new Map(), records = []

async function request(m, body, row) {
  const outputCap = m.config.max_tokens ?? m.config.max_completion_tokens ?? m.config.maxOutputTokens
  // Byte count bounds token count for these synthetic text requests. Cache writes
  // are not requested; input reserve uses the greater regular/write rate.
  const reserve = (Buffer.byteLength(JSON.stringify(body)) * Math.max(m.input, m.cacheWrite ?? 0) + outputCap * m.output) / 1e6
  if (reserved + reserve > protocol.maxReservedUSD) throw Object.assign(new Error('budget_exhausted'), { code: 'budget_exhausted' })
  reserved += reserve
  const headers = { 'content-type': 'application/json' }
  let url
  if (m.provider === 'anthropic') { url = 'https://api.anthropic.com/v1/messages'; headers['x-api-key'] = keys.ANTHROPIC_API_KEY; headers['anthropic-version'] = '2023-06-01' }
  if (m.provider === 'openai') { url = 'https://api.openai.com/v1/chat/completions'; headers.Authorization = `Bearer ${keys.OPENAI_API_KEY}` }
  if (m.provider === 'gemini') { url = `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent`; headers['x-goog-api-key'] = keys.GEMINI_API_KEY }
  const start = performance.now()
  row.requestAttempts++
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(protocol.timeoutMs) })
  const raw = await response.json()
  row.calls.push({ httpStatus: response.status, latencyMs: Math.round(performance.now() - start), raw })
  if (!response.ok) {
    if ([400, 401, 403, 404, 429].includes(response.status)) disabled.set(m.id, `http_${response.status}`)
    throw Object.assign(new Error(`http_${response.status}`), { code: `http_${response.status}` })
  }
  return raw
}

async function run(m, c, repetition) {
  const row = { model: m.id, caseId: c.id, cohort: c.cohort, repetition, requestAttempts: 0, calls: [], toolTrace: [], criticalFailures: [], mismatches: [] }
  const begin = performance.now()
  try {
    if (disabled.has(m.id)) throw Object.assign(new Error('model_disabled'), { code: disabled.get(m.id) })
    let messages = [{ role: 'user', content: c.prompt }], contents = [{ role: 'user', parts: [{ text: c.prompt }] }]
    let finalText = ''
    for (let turn = 0; turn < protocol.maxTurns; turn++) {
      const body = m.provider === 'anthropic' ? { model: m.id, system: protocol.system, messages, ...m.config, ...(c.tool ? { tools: protocol.schemas.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}) }
        : m.provider === 'openai' ? { model: m.id, messages: [{ role: 'system', content: protocol.system }, ...messages], ...m.config, ...(c.tool ? { tools: protocol.schemas.map(t => ({ type: 'function', function: t })) } : {}) }
          : { systemInstruction: { parts: [{ text: protocol.system }] }, contents, generationConfig: m.config, ...(c.tool ? { tools: [{ functionDeclarations: protocol.schemas.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] } : {}) }
      const raw = await request(m, body, row)
      let tools = [], text = '', assistant, finish, served
      if (m.provider === 'anthropic') {
        text = (raw.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''); finish = raw.stop_reason; served = raw.model
        tools = (raw.content ?? []).filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input }))
        assistant = { role: 'assistant', content: raw.content }
      } else if (m.provider === 'openai') {
        assistant = raw.choices?.[0]?.message; text = assistant?.content ?? ''; finish = raw.choices?.[0]?.finish_reason; served = raw.model
        tools = (assistant?.tool_calls ?? []).map(b => ({ id: b.id, name: b.function.name, args: JSON.parse(b.function.arguments) }))
      } else {
        const candidate = raw.candidates?.[0]; assistant = candidate?.content
        text = (assistant?.parts ?? []).filter(b => b.text && !b.thought).map(b => b.text).join(''); finish = candidate?.finishReason; served = raw.modelVersion
        tools = (assistant?.parts ?? []).filter(b => b.functionCall).map(b => ({ name: b.functionCall.name, args: b.functionCall.args }))
      }
      row.finishReason = finish; row.servedModel = served
      if (!servedMatches(served, m)) { row.identityMismatch = true; throw Object.assign(new Error('unexpected_served_model'), { code: 'unexpected_served_model' }) }
      if (!tools.length) { finalText = text; break }
      const results = tools.map(t => {
        const allowed = !!c.tool && t.name === c.tool.required && same(t.args, c.tool.args) && row.toolTrace.length === 0
        if (!allowed) row.criticalFailures.push(`unauthorized_or_wrong_tool:${t.name}`)
        const result = allowed ? c.tool.result : { ok: false, errorCode: 'blocked_by_fixture' }
        row.toolTrace.push({ ...t, turn, allowed, result }); return { ...t, result }
      })
      if (turn + 1 === protocol.maxTurns) { row.incomplete = true; break }
      // Preserve Anthropic thinking/signatures and Gemini thought signatures.
      if (m.provider === 'anthropic') messages.push(assistant, { role: 'user', content: results.map(t => ({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(t.result) })) })
      else if (m.provider === 'openai') messages.push(assistant, ...results.map(t => ({ role: 'tool', tool_call_id: t.id, content: JSON.stringify(t.result) })))
      else contents.push(assistant, { role: 'user', parts: results.map(t => ({ functionResponse: { name: t.name, response: t.result } })) })
    }
    row.text = finalText
    const normal = { anthropic: 'end_turn', openai: 'stop', gemini: 'STOP' }[m.provider]
    if (row.finishReason !== normal) row.incomplete = true
    const { answer, strict } = recover(finalText)
    row.answer = answer; row.formatConforming = strict && !!answer && typeof answer === 'object' && !Array.isArray(answer)
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) row.mismatches.push('unparseable_answer')
    else {
      for (const [k, v] of Object.entries(c.expected)) {
        if (!fieldSame(answer[k], v, k)) { row.mismatches.push(k); if (c.criticalKeys.includes(k) && k !== 'sourceIds') row.criticalFailures.push(k) }
      }
      if (Object.keys(answer).some(k => !(k in c.expected))) row.mismatches.push('extraneous_keys')
      const provided = new Set(c.prompt.match(/\bS\d+\b/g) ?? [])
      if (Array.isArray(answer.sourceIds) && answer.sourceIds.some(id => !provided.has(id))) row.criticalFailures.push('fabricated_source_ids')
    }
    if (c.tool && !row.toolTrace.some(t => t.allowed)) row.mismatches.push('required_tool_missing')
    row.semanticPass = !row.incomplete && !row.mismatches.length && !row.criticalFailures.length
    row.strictPass = row.semanticPass && row.formatConforming
    row.status = row.incomplete ? 'incomplete' : row.strictPass ? 'pass' : row.semanticPass ? 'format_failure' : 'fail'
  } catch (e) {
    row.status = row.calls.length && row.calls.at(-1).httpStatus === 200 ? 'invalid_response' : 'transport_error'
    row.errorCode = e.code ?? e.name; row.semanticPass = false; row.strictPass = false; row.formatConforming = false
  }
  row.latencyMs = Math.round(performance.now() - begin)
  row.callUsages = row.calls.map(call => usageFor(call.raw, m))
  const known = row.calls.length === row.requestAttempts && row.callUsages.every(u => u.known)
  row.usage = { known, inputTokens: row.callUsages.reduce((s, u) => s + (u.inputTokens ?? 0), 0), outputTokens: row.callUsages.reduce((s, u) => s + (u.outputTokens ?? 0), 0), estimatedUSD: known ? row.callUsages.reduce((s, u) => s + u.estimatedUSD, 0) : null }
  records.push(row); fs.appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(row) + '\n')
  console.log(JSON.stringify({ completed: records.length, model: row.model, case: row.caseId, repetition, status: row.status, mismatches: row.mismatches, ms: row.latencyMs }))
}

const jobs = Array.from({ length: protocol.repeats }, (_, rep) => protocol.cases.flatMap((c, i) => protocol.models.map((_, j) => [protocol.models[(j + i + rep) % protocol.models.length], c, rep + 1]))).flat()
let next = 0
await Promise.all(Array.from({ length: protocol.concurrency }, async () => { while (next < jobs.length) await run(...jobs[next++]) }))
const summarize = rows => {
  const timings = rows.filter(r => r.calls.length && !['transport_error', 'invalid_response'].includes(r.status)).map(r => r.latencyMs).sort((a, b) => a - b)
  const totalCost = rows.every(r => r.usage.known) ? rows.reduce((s, r) => s + r.usage.estimatedUSD, 0) : null
  return { cells: rows.length, strictPasses: rows.filter(r => r.strictPass).length, semanticPasses: rows.filter(r => r.semanticPass).length, formatConforming: rows.filter(r => r.formatConforming).length, criticalCells: rows.filter(r => r.criticalFailures.length).length,
    transportErrors: rows.filter(r => r.status === 'transport_error').length, incomplete: rows.filter(r => r.incomplete).length, estimatedUSD: totalCost, medianMs: timings[Math.floor(timings.length / 2)] ?? null, p95Ms: timings[Math.ceil(timings.length * .95) - 1] ?? null }
}
const summary = protocol.models.map(m => {
  const rows = records.filter(r => r.model === m.id)
  const primary = rows.filter(r => r.cohort !== 'legacy_ambiguous')
  return { model: m.id, overall: summarize(rows), primary: summarize(primary), cohorts: Object.fromEntries([...new Set(rows.map(r => r.cohort))].map(k => [k, summarize(rows.filter(r => r.cohort === k))])), servedModels: [...new Set(rows.map(r => r.servedModel).filter(Boolean))], stablePrimaryCases: protocol.cases.filter(c => c.cohort !== 'legacy_ambiguous' && primary.filter(r => r.caseId === c.id && r.strictPass).length === protocol.repeats).length,
    failures: rows.filter(r => !r.strictPass).map(r => ({ caseId: r.caseId, cohort: r.cohort, repetition: r.repetition, status: r.status, mismatches: r.mismatches, critical: r.criticalFailures, answer: r.answer, error: r.errorCode })) }
})
const result = { ...started, endedAt: new Date().toISOString(), reservedUSD: reserved, providerCalls: records.reduce((s, r) => s + r.calls.length, 0), providerRequestsStarted: records.reduce((s, r) => s + r.requestAttempts, 0), estimatedUSD: records.every(r => r.usage.known) ? records.reduce((s, r) => s + r.usage.estimatedUSD, 0) : null, summary }
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify(result))
