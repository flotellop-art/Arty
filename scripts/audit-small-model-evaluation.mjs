import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

const same = (a, b) => typeof b === 'number' ? typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) < 1e-8
  : Array.isArray(b) ? Array.isArray(a) && a.length === b.length && b.every((v, i) => same(a[i], v))
  : b && typeof b === 'object' ? !!a && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(k => same(a[k], b[k])) : a === b
const fieldSame = (a, b, key) => key === 'sourceIds' && Array.isArray(a) && Array.isArray(b) ? same([...new Set(a)].sort(), [...new Set(b)].sort()) : same(a, b)
function recover(text) {
  try { return { answer: JSON.parse(text), strict: true } } catch {}
  // A Python example before the JSON answer is prose, not a JSON answer.
  // Recover a unique explicitly JSON (or unlabelled) object; never cherry-pick
  // between multiple contradictory JSON objects. Strict scores are untouched.
  const blocks = [...text.matchAll(/^```([^\r\n`]*)\r?\n([\s\S]*?)^```[ \t]*(?:\r?\n|$)/gm)].map(m => ({ language: m[1].trim().toLowerCase(), text: m[2] }))
  const explicit = blocks.filter(b => b.language === 'json')
  const candidates = explicit.length ? explicit : blocks.filter(b => b.language === '')
  let answer = null
  if (candidates.length === 1) try {
    const a = JSON.parse(candidates[0].text)
    if (a && typeof a === 'object' && !Array.isArray(a)) answer = a
  } catch {}
  return { answer, strict: false }
}
if (process.argv.includes('--self-check')) {
  assert.deepEqual(recover('```python\nprint(1)\n```\n```json\n{"n":1}\n```').answer, { n: 1 })
  assert.equal(recover('```json\n{"n":1}\n```\n```json\n{"n":2}\n```').answer, null)
  assert.equal(recover('```json\n{"n":1}\n```\n```json\nbroken\n```').answer, null)
  assert.equal(recover('```json\n{"n":1}\n```').strict, false)
  console.log('Secondary JSON recovery self-checks passed.'); process.exit(0)
}
const out = path.resolve(process.argv[2] ?? '.playwright-mcp/competence-20261008/run')
const protocol = JSON.parse(fs.readFileSync(path.join(out, 'protocol.json'), 'utf8'))
const original = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'))
const rawText = fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8')
function auditedUsage(calls, m) {
  let input = 0, output = 0, cached = 0, created = 0, thinking = 0, estimatedUSD = 0, uncachedUSD = 0
  for (const { raw, httpStatus } of calls) {
    const u = raw.usage ?? raw.usageMetadata
    if (!u || httpStatus !== 200) throw new Error('Cost audit requires complete successful supplier usage')
    const read = u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.cachedContentTokenCount ?? 0
    const write = m.provider === 'openai' ? u.prompt_tokens_details?.cache_write_tokens : (u.cache_creation_input_tokens ?? 0)
    const inTokens = m.provider === 'anthropic' ? u.input_tokens + read + write : (u.prompt_tokens ?? u.promptTokenCount)
    const outTokens = u.output_tokens ?? u.completion_tokens ?? ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0))
    const ordinary = inTokens - read - write
    if (![inTokens, outTokens, ordinary, read, write].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Missing or inconsistent token accounting')
    const created1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const multiplier = m.id === 'claude-haiku-5-5' && inTokens > 100000 ? 5 : 1
    estimatedUSD += (ordinary * m.input + read * m.cacheRead + (write - created1h) * m.cacheWrite + created1h * m.input * 2 + outTokens * m.output) * multiplier / 1e6
    uncachedUSD += (inTokens * m.input + outTokens * m.output) * multiplier / 1e6
    input += inTokens; output += outTokens; cached += read; created += write
    thinking += u.output_tokens_details?.thinking_tokens ?? u.completion_tokens_details?.reasoning_tokens ?? u.thoughtsTokenCount ?? 0
  }
  return { inputTokens: input, outputTokens: output, cachedTokens: cached, cacheCreationTokens: created, reportedThinkingTokens: thinking, estimatedUSD, uncachedProjectionUSD: uncachedUSD }
}
const rows = rawText.trim().split('\n').map(JSON.parse).map(r => {
  const c = protocol.cases.find(x => x.id === r.caseId), m = protocol.models.find(x => x.id === r.model)
  const { answer, strict } = recover(r.text ?? '')
  const errors = [], critical = []
  const normal = { anthropic: 'end_turn', openai: 'stop', gemini: 'STOP' }[m.provider]
  if (!r.calls.length || r.calls.some(x => x.httpStatus !== 200) || r.errorCode || r.incomplete || r.finishReason !== normal || !m.acceptedResponseIds.includes(r.servedModel)) errors.push('transport_identity_or_completion')
  const toolCalls = r.calls.flatMap(({ raw }) => raw.content ? raw.content.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, args: b.input }))
    : raw.choices ? (raw.choices[0]?.message?.tool_calls ?? []).map(b => { try { return { name: b.function.name, args: JSON.parse(b.function.arguments) } } catch { return { name: b.function.name, args: null } } })
      : (raw.candidates?.[0]?.content?.parts ?? []).filter(b => b.functionCall).map(b => b.functionCall))
  if (toolCalls.some((t, i) => !c.tool || i > 0 || t.name !== c.tool.required || !same(t.args, c.tool.args))) { errors.push('unauthorized_tool'); critical.push('unauthorized_tool') }
  if (c.tool && !toolCalls.some(t => t.name === c.tool.required && same(t.args, c.tool.args))) errors.push('required_tool_missing')
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) errors.push('unparseable_answer')
  else {
    for (const [k, v] of Object.entries(c.expected)) if (!fieldSame(answer[k], v, k)) { errors.push(k); if (c.criticalKeys.includes(k) && k !== 'sourceIds') critical.push(k) }
    if (Object.keys(answer).some(k => !(k in c.expected))) errors.push('extraneous_keys')
    const provided = new Set(c.prompt.match(/\bS\d+\b/g) ?? [])
    if (Array.isArray(answer.sourceIds) && answer.sourceIds.some(x => !provided.has(x))) critical.push('fabricated_source_ids')
  }
  const semanticPass = !errors.length && !critical.length
  const strictPass = semanticPass && strict
  if (strictPass !== r.strictPass) throw new Error('Unexpected change of strict score')
  return { model: r.model, caseId: r.caseId, cohort: r.cohort, repetition: r.repetition, strictPass, semanticPass, changedSemanticScore: semanticPass !== r.semanticPass, jsonOnly: strict, errors, critical, answer, latencyMs: r.latencyMs, originalUsage: r.usage, usage: auditedUsage(r.calls, m) }
})
const summarize = rs => ({ cells: rs.length, strictPasses: rs.filter(r => r.strictPass).length, semanticPasses: rs.filter(r => r.semanticPass).length, jsonOnly: rs.filter(r => r.jsonOnly).length, criticalCells: rs.filter(r => r.critical.length).length })
const summary = protocol.models.map(m => {
  const own = rows.filter(r => r.model === m.id), primary = own.filter(r => r.cohort !== 'legacy_ambiguous')
  const runtime = original.summary.find(r => r.model === m.id)
  return { model: m.id, overall: summarize(own), primary: summarize(primary), stablePrimaryContentCases: protocol.cases.filter(c => c.cohort !== 'legacy_ambiguous' && primary.filter(r => r.caseId === c.id && r.semanticPass).length === protocol.repeats).length, stablePrimaryStrictCases: runtime.stablePrimaryCases,
    cohorts: Object.fromEntries([...new Set(own.map(r => r.cohort))].map(k => [k, summarize(own.filter(r => r.cohort === k))])), runtime: runtime.overall,
    costs: Object.fromEntries(['inputTokens', 'outputTokens', 'cachedTokens', 'cacheCreationTokens', 'reportedThinkingTokens', 'estimatedUSD', 'uncachedProjectionUSD'].map(k => [k, own.reduce((s, r) => s + r.usage[k], 0)])),
    failures: own.filter(r => !r.semanticPass).map(({ caseId, repetition, cohort, errors, critical, answer }) => ({ caseId, repetition, cohort, errors, critical, answer })) }
})
const audited = { auditedAt: new Date().toISOString(), note: 'Secondary uniform audit recovering a unique JSON fence after other code fences. Frozen strict scores and raw outputs unchanged. Content scores cover requested fields, not surrounding prose. Numeric epsilon 1e-8; sourceIds as sets; raw tool requests rechecked. OpenAI cache writes repriced at 1.25x ordinary input, Anthropic thinking detail recovered. Initial runtime costs preserved separately.', rawSha256: crypto.createHash('sha256').update(rawText).digest('hex'), estimatedUSD: summary.reduce((s, m) => s + m.costs.estimatedUSD, 0), semanticChanges: rows.filter(r => r.changedSemanticScore).map(({ model, caseId, repetition }) => ({ model, caseId, repetition })), summary, rows }
fs.writeFileSync(path.join(out, process.argv[3] ?? 'audited.json'), JSON.stringify(audited, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ semanticChanges: audited.semanticChanges, summary }))
