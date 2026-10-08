import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

// Reuse frozen synthetic dossiers, not private conversations or production data.
const [previousArg, targetArg] = process.argv.slice(2)
if (!previousArg || !targetArg) throw new Error('Usage: node prepare-small-model-retest.mjs previous-evidence-directory target-protocol.json')
const previous = path.resolve(previousArg)
const sha = x => crypto.createHash('sha256').update(x).digest('hex')
const priorText = fs.readFileSync(path.join(previous, 'run/protocol.json'), 'utf8')
const clarifiedText = fs.readFileSync(path.join(previous, 'clarified/protocol.json'), 'utf8')
const p = JSON.parse(priorText), q = JSON.parse(clarifiedText)
if (p.systemHash !== q.systemHash || sha(p.system) !== p.systemHash) throw new Error('Previous system identity mismatch')
const models = p.models.map(m => ({ ...m, acceptedResponseIds: [m.id], cacheRead: m.input / 10, cacheWrite: m.input * 1.25 }))
models.splice(1, 0, { id: 'claude-haiku-5-5', provider: 'anthropic', input: .1, output: .5, cacheRead: .01, cacheWrite: .125, acceptedResponseIds: ['claude-haiku-5-5'], config: { max_tokens: 4096, thinking: { type: 'adaptive' }, output_config: { effort: 'low' } } })
const cases = [...p.cases.map(c => ({ ...c, cohort: /^(citation|units|conflict)-/.test(c.id) ? 'legacy_ambiguous' : 'original_unambiguous' })), ...q.cases.map(c => ({ ...c, cohort: 'clarified' }))]
const protocol = { version: 3, date: '2026-10-08', workspaceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), previousSystemCandidate: p.candidate,
  previousProtocolHashes: { original: sha(priorText), clarified: sha(clarifiedText) }, system: p.system, systemHash: p.systemHash, models, cases, schemas: p.schemas,
  repeats: 2, concurrency: 2, maxTurns: 2, timeoutMs: 30000, maxReservedUSD: 6, retries: 0, fallback: false,
  scorePolicy: { numericTolerance: 1e-8, sourceIds: 'unordered set', toolArguments: 'structural equality', strict: 'JSON object only, exact expected fields, normal completion, correct served identity, required authorized tools', semantic: 'same content checks; fenced JSON recovered separately', primary: '20 unambiguous or clarified cases, repeated twice per model', diagnostic: '6 legacy ambiguous cases, separately reported' },
  limitations: ['Direct APIs; no authenticated Arty, proxy, quotas, deployment or Android test', 'Fixed supplied synthetic evidence; no autonomous web search', 'Arithmetic without code_execution; not Arty calculator performance', 'Two repetitions of 26 dossiers are correlated, not 52 independent tasks', 'Different low-cost model settings; not matched reasoning budgets', 'Whole request/cell latency, no streaming TTFT', 'Listed-rate token cost with reported cache; not supplier invoice'],
  pricingSources: ['https://platform.claude.com/docs/en/models/haiku-5-5/overview', 'https://platform.claude.com/docs/en/models/haiku-4-5/overview', 'https://developers.openai.com/api/docs/models/gpt-5.6-luna', 'https://developers.openai.com/api/docs/models/gpt-6-luna', 'https://ai.google.dev/gemini-api/docs/pricing'],
  changesFromPrevious: ['Haiku 5.5 added, adaptive low effort, no sampling parameters', 'All models replayed twice; no selective retry', 'Gemini parametersJsonSchema transport fixed', 'Last-turn tool requests always recorded before cutoff', 'Strict numeric equality and structured argument equality', 'Response identity and normal stop allowlists enforced', 'Cache and reasoning usage included; unknown usage remains unknown', 'Ambiguous original prompts reported separately from primary cases'] }
fs.mkdirSync(path.dirname(path.resolve(targetArg)), { recursive: true })
const text = JSON.stringify(protocol, null, 2)
fs.writeFileSync(targetArg, text, { flag: 'wx' })
console.log(JSON.stringify({ frozen: true, protocolSha256: sha(text), cases: cases.length, primaryCases: cases.filter(c => c.cohort !== 'legacy_ambiguous').length, models: models.map(m => m.id), repeats: protocol.repeats, maxReservedUSD: protocol.maxReservedUSD }))
