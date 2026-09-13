import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const rawDir = resolve('.playwright-mcp/factcheck-20260913')
const parser = join(rawDir, 'parser.mjs')
await build({ stdin: { contents: "export { evidenceClaims, parseFactObject } from './functions/api/_lib/factCheckEvidence'; export { normalizeVerdictContent } from './functions/api/ai/fact-check';", resolveDir: process.cwd() }, outfile: parser, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { evidenceClaims, parseFactObject, normalizeVerdictContent } = await import(pathToFileURL(parser).href)
const protocol = JSON.parse(readFileSync(join(rawDir, 'protocol.json'), 'utf8'))
const rows = readFileSync(join(rawDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
if (rows.length !== 56 || new Set(rows.map(r => `${r.caseId}:${r.requestedModel}`)).size !== 56) throw new Error('Incomplete or duplicate campaign')
const scored = rows.map(row => {
  const c = protocol.cases.find(c => c.id === row.caseId)
  const normalized = normalizeVerdictContent([{ type: 'text', text: row.text || '' }])
  const claims = evidenceClaims(normalized.at(-1)?.text || '')
  const object = parseFactObject(normalized.at(-1)?.text || '')
  const complete = ['end_turn', 'STOP', 'stop'].includes(row.finish)
  let pass = complete && !!claims?.length
  if (pass && c.expected === 'wrong') {
    pass = claims.some(claim => {
      if (claim.verdict !== 'wrong' || !claim.originalText || !c.answer.includes(claim.originalText)) return false
      const correction = (claim.correction || '').replaceAll('**', '')
      if (c.id === 'F03') return /299\s*792\s*458\s*m\/s|299\s*792[,.]458\s*km\/s/.test(correction)
      return correction.includes(c.correctionMustContain)
    }) && !claims.some(claim => claim.verdict === 'verified' && claim.claim.includes(c.originalMustContain))
  } else if (pass) pass = claims.every(claim => claim.verdict === c.expected)
  return { ...row, acceptedByArtyParser: !!claims, complete, pass, normalizedClaims: claims, confidenceConflict: claims?.some(c => c.verdict === 'wrong') && object?.overall_confidence === 'high', failure: pass ? null : !complete ? 'incomplete_output' : !claims?.length ? 'invalid_or_empty_claims' : 'unwanted_correction_or_wrong_verdict' }
})
const median = list => { const a = [...list].sort((a, b) => a - b); return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 }
const summary = protocol.models.map(m => {
  const r = scored.filter(r => r.requestedModel === m.id)
  return { model: m.id, passed: r.filter(r => r.pass).length, total: r.length, medianMsAllAttempts: median(r.map(r => r.elapsedMs)), estimatedUncachedUsd: r.reduce((s, r) => s + (r.estimatedUncachedUsd || 0), 0), parserAccepted: r.filter(r => r.acceptedByArtyParser && r.complete).length, rawJson: r.filter(r => r.status === 'completed').length, confidenceConflicts: r.filter(r => r.confidenceConflict).length, servedModels: [...new Set(r.map(r => r.servedModel))] }
})
const report = { scope: protocol.mode, protocol: '2026-09-13-factcheck-protocol.json', run: JSON.parse(readFileSync(join(rawDir, 'started.json'), 'utf8')), completed: JSON.parse(readFileSync(join(rawDir, 'complete.json'), 'utf8')), scoring: 'Fixed expected outcomes; real Arty parser permits fenced JSON and removes meaningless correction fields on verified/uncertain claims. A truncated output or empty claim list fails. No provider retry or fallback. Times include the complete HTTP response, not UI streaming. Costs use current standard rates without cache discounts and are not invoices.', summary, results: scored }
writeFileSync('docs/evaluations/2026-09-13-factcheck-models.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
